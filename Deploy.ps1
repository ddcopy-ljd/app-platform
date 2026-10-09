#Requires -Version 5.1
<#
  Yizhen Platform · One-click deployment script
  =============================================
  Windows Server 2019+ / Windows 10+ · PowerShell 5.1+ · Run as Administrator
  (firewall rules require admin; other steps work with regular user)

  Usage:
    1) Extract yizhen-stack_v*.zip to target dir (e.g. C:\Yizhen)
    2) Right-click Deploy.ps1 -> Run with PowerShell (or Run as Administrator)
       Or open PowerShell and run:
         powershell -ExecutionPolicy Bypass -File Deploy.ps1
    3) Answer prompts (all defaults -> full non-interactive flow)

  Idempotent: already-done steps are skipped; re-runnable.
#>

$ErrorActionPreference = "Continue"
$Host.UI.RawUI.WindowTitle = "Yizhen Platform - Deploy"

# --- Resolve root: this script sits at zip extraction root ---
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Venv = Join-Path $Root ".venv"
$VenvPy = Join-Path $Venv "Scripts\python.exe"
$PlatformDir = Join-Path $Root "platform"
$BackupDir = Join-Path $Root "backup"
$DataDir = Join-Path $PlatformDir "data"
$TenantDbs = Join-Path $DataDir "tenant_dbs"

function Step([string]$Name, [scriptblock]$Action) {
    Write-Host ""
    Write-Host "=== $Name ===" -ForegroundColor Cyan
    try {
        & $Action
        Write-Host "  [OK]" -ForegroundColor Green
    } catch {
        Write-Host "  [FAIL] $($_.Exception.Message)" -ForegroundColor Red
        return $false
    }
    return $true
}

function Ask([string]$Prompt, [string]$Default = "n") {
    $v = Read-Host "$Prompt (y/n, default $Default)"
    if ([string]::IsNullOrWhiteSpace($v)) { return ($Default -eq "y") }
    return ($v -match '^[Yy]$')
}

# ================================================================
Write-Host ""
Write-Host "  Yizhen Jewelry Cloud Platform - One-click Deploy" -ForegroundColor White
Write-Host "  Root:   $Root" -ForegroundColor Gray
Write-Host "  At:     $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" -ForegroundColor Gray
Write-Host ""

# --- Pre-flight: required files exist ---
if (-not (Test-Path (Join-Path $PlatformDir "app\main.py"))) {
    Write-Host "[FAIL] platform\app\main.py not found. Is this script at the zip extraction root?" -ForegroundColor Red
    exit 1
}

# ================================================================
# Stage 1 · Python
# ================================================================
Step "1. Python check" {
    $cmd = Get-Command python -ErrorAction SilentlyContinue
    if (-not $cmd) {
        throw "python is NOT on PATH. Install Python 3.11+ (www.python.org/downloads/) and check 'Add to PATH'."
    }
    $pyver = python --version 2>&1
    Write-Host "  Detected: $pyver" -ForegroundColor Gray
    $major = [int](($pyver -split '\.')[0] -replace '[^\d]', '')
    if ($major -lt 3) { throw "Python 3.11+ required, got Python $major" }
}

# ================================================================
# Stage 2 · venv (idempotent: create only if missing)
# ================================================================
Step "2. venv create/verify" {
    if (Test-Path $VenvPy) {
        Write-Host "  Already exists at $Venv - skip" -ForegroundColor Gray
    } else {
        Push-Location $Root
        python -m venv .venv
        if ($LASTEXITCODE -ne 0) { throw "venv creation failed" }
        Pop-Location
    }
    & $VenvPy --version
}

# ================================================================
# Stage 3 · pip + requirements
# ================================================================
Step "3. pip install dependencies" {
    # Default mirror for China Mainland; pass -i https://pypi.org/simple to override
    $Mirror = "https://pypi.tuna.tsinghua.edu.cn/simple"
    Write-Host "  Using mirror: $Mirror" -ForegroundColor Gray
    Write-Host "  Upgrading pip (first run may take 10-30s on slow links)..." -ForegroundColor Gray
    & $VenvPy -m pip install --upgrade pip -i $Mirror
    if ($LASTEXITCODE -ne 0) { throw "pip upgrade failed" }

    $req = Join-Path $Root "requirements.txt"
    if (-not (Test-Path $req)) { $req = Join-Path $PlatformDir "requirements.txt" }
    if (-not (Test-Path $req)) { throw "requirements.txt not found" }

    Write-Host "  Installing dependencies from $req (download + compile, 1-3 min first run)..." -ForegroundColor Gray
    & $VenvPy -m pip install -r $req -i $Mirror
    if ($LASTEXITCODE -ne 0) { throw "pip install failed; see output above" }
}

# ================================================================
# Stage 4 · Windows Firewall (Administrator required)
# ================================================================
Step "4. Firewall rules 80 / 8002" {
    $isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    if (-not $isAdmin) {
        Write-Host "  Not elevated. Skipping firewall rules. Re-run as admin or add rules manually:" -ForegroundColor Yellow
        Write-Host "    netsh advfirewall firewall add rule name='Yizhen Port 80' dir=in action=allow protocol=TCP localport=80" -ForegroundColor Gray
        Write-Host "    netsh advfirewall firewall add rule name='Yizhen Port 8002' dir=in action=allow protocol=TCP localport=8002" -ForegroundColor Gray
        return
    }
    foreach ($port in @(80, 8002)) {
        $name = "Yizhen Platform Port $port"
        $existing = netsh advfirewall firewall show rule name=$name 2>&1 | Select-String -Pattern "No rules match" -Quiet
        if (-not $existing) {
            Write-Host "  Rule exists: $name" -ForegroundColor Gray
            continue
        }
        netsh advfirewall firewall add rule name=$name dir=in action=allow protocol=TCP localport=$port > $null
        if ($LASTEXITCODE -ne 0) { throw "add rule $name failed" }
        Write-Host "  + $name" -ForegroundColor Gray
    }
}

# ================================================================
# Stage 5 · Optional: restore production database
# ================================================================
if (Test-Path $BackupDir) {
    Write-Host ""
    Write-Host "=== 5. Restore production database (optional) ===" -ForegroundColor Cyan
    $restore = Ask "backup/ dir has dev DB dumps. Restore? (n = fresh init)" "n"
    if ($restore) {
        foreach ($p in @($DataDir, $TenantDbs)) { New-Item -ItemType Directory -Path $p -Force | Out-Null }

        $copied = 0
        Get-ChildItem -Path $BackupDir -Recurse -Filter "*.sqlite" | ForEach-Object {
            $rel = $_.FullName.Substring($BackupDir.Length + 1)
            $parts = $rel -split '\\'
            if ($parts.Length -ge 3 -and $parts[1] -eq "platform") {
                $dst = Join-Path $DataDir $_.Name
            } elseif ($parts.Length -ge 3) {
                $plugin = $parts[1]
                $pluginDir = Join-Path $TenantDbs $plugin
                New-Item -ItemType Directory -Path $pluginDir -Force | Out-Null
                $dst = Join-Path $pluginDir $_.Name
            } else { return }
            Copy-Item -LiteralPath $_.FullName -Destination $dst -Force
            Write-Host "  $($_.Name) -> $dst" -ForegroundColor Gray
            $copied++
        }
        Write-Host "  Restored $copied database files" -ForegroundColor Green
    } else {
        Write-Host "  Fresh init. First start auto-creates admin/admin123 (platform) and admin/123456 (plugin)." -ForegroundColor Yellow
        Write-Host "  Change passwords immediately after first login (deployment checklist 1.1 / 1.2)." -ForegroundColor Yellow
    }
}

# ================================================================
# Stage 6 · Optional: set platform admin password (user env var, permanent)
# ================================================================
Write-Host ""
Write-Host "=== 6. Set platform admin password (optional) ===" -ForegroundColor Cyan
$setPwd = Ask "Set now? (y = strong password written to PLATFORM_ADMIN_PASSWORD user env; n = change after first login with admin123)" "n"
if ($setPwd) {
    $pwd = Read-Host "New password (min 12 chars, upper+lower+digit+special recommended)"
    if ([string]::IsNullOrWhiteSpace($pwd) -or $pwd.Length -lt 8) {
        Write-Host "  Short password - skipping. Use admin123 on first login and change it there." -ForegroundColor Yellow
    } else {
        [Environment]::SetEnvironmentVariable("PLATFORM_ADMIN_PASSWORD", $pwd, "User")
        Write-Host "  Saved to user env PLATFORM_ADMIN_PASSWORD. Re-open PowerShell before next start to pick it up." -ForegroundColor Green
    }
}

# ================================================================
# Stage 7 · Port check (informational, do NOT auto-kill)
# ================================================================
Write-Host ""
Write-Host "=== 7. Port occupancy ===" -ForegroundColor Cyan
foreach ($port in @(80, 8002)) {
    $used = netstat -ano -p tcp | Select-String ":$port " | Select-String "LISTENING"
    if ($used) {
        $pid = ($used -split '\s+')[-1]
        $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$pid" -ErrorAction SilentlyContinue
        $cmdLine = if ($proc) { $proc.CommandLine } else { "unknown" }
        Write-Host "  [WARN] Port $port in use  PID=$pid  $cmdLine" -ForegroundColor Yellow
    } else {
        Write-Host "  Port $port free" -ForegroundColor Green
    }
}

# ================================================================
# Stage 8 · Launch
# ================================================================
Write-Host ""
Write-Host "=== 8. Launch services ===" -ForegroundColor Cyan
Write-Host "  start_platform.bat will be launched; platform auto-registers jewelry service." -ForegroundColor Gray
Write-Host "  Close the opened cmd window to stop. For production, register as Windows service via nssm." -ForegroundColor Gray
Write-Host ""

$go = Ask "Launch now?" "y"
if ($go) {
    $bat = Join-Path $Root "start_platform.bat"
    if (-not (Test-Path $bat)) { throw "start_platform.bat not found at $bat" }
    Write-Host "  Launch in 3 seconds..." -ForegroundColor Gray
    Start-Sleep -Seconds 3
    Start-Process -FilePath "cmd.exe" -ArgumentList "/k `"$bat`""
}

# ================================================================
# Stage 9 · Health check (wait for service)
# ================================================================
Write-Host ""
Write-Host "=== 9. Health check ===" -ForegroundColor Cyan
Write-Host "  Waiting up to 30s for service..." -ForegroundColor Gray
$ok = $false
for ($i = 1; $i -le 30; $i++) {
    Start-Sleep -Seconds 1
    try {
        $resp = Invoke-WebRequest -Uri "http://localhost:80/api/auth/login" -Method Head -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
        if ($resp.StatusCode -in 200, 404, 405) {
            Write-Host "  [OK] Port 80 responding (HTTP $($resp.StatusCode)) at ${i}s" -ForegroundColor Green
            $ok = $true
            break
        }
    } catch { }
    Write-Host "  $i/30 ..." -NoNewline
}
if (-not $ok) {
    Write-Host ""
    Write-Host "  [FAIL] Not ready in 30s. Check the cmd window opened by start_platform.bat for errors." -ForegroundColor Red
}

# ================================================================
Write-Host ""
Write-Host "=======================================================" -ForegroundColor Cyan
Write-Host "  Deploy done. Open http://localhost:80/ in browser." -ForegroundColor White
Write-Host "  Post-deploy checklist -> DEPLOY.txt section 4." -ForegroundColor Gray
Write-Host "=======================================================" -ForegroundColor Cyan
Write-Host ""
