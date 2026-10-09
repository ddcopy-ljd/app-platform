# =====================================================================
# upgrade_helper.ps1 - Platform self-upgrade helper (runs OUTSIDE python)
#
# Spawned by platform/app/platform_upgrade.py as a DETACHED process.
# Sequence: wait for HTTP response flush -> stop current instance
# (nssm service if present, else kill by PID) -> apply new files
# (never touches data/.venv/logs/_upgrade/_backup) -> pip install
# (best effort) -> restart (service or scripts\start_platform.bat).
#
# NOTE: keep this file ASCII-only (PowerShell 5.1 friendly).
# =====================================================================
param(
    [int]$ProcId = 0,
    [string]$Root = "",
    [string]$NewDir = "",
    [string]$LogFile = ""
)

$ErrorActionPreference = 'Continue'

function Log($msg) {
    $line = "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
    Add-Content -Path $LogFile -Value $line -Encoding UTF8
}

Log "=== platform upgrade started ==="
Log "root=$Root"
Log "new=$NewDir"
Log "procid=$ProcId"

# --- 0) let the HTTP response reach the client before killing anything ---
Start-Sleep -Seconds 2

# --- 1) stop current instance ---
$svc = Get-Service -Name 'YizhenPlatform' -ErrorAction SilentlyContinue
if ($svc) {
    Log "service YizhenPlatform detected -> Stop-Service"
    try { Stop-Service -Name 'YizhenPlatform' -Force -ErrorAction Stop } catch { Log "Stop-Service: $($_.Exception.Message)" }
} else {
    Log "no YizhenPlatform service -> will kill process $ProcId"
}
if ($ProcId -gt 0) {
    try { Stop-Process -Id $ProcId -Force -ErrorAction Stop } catch { Log "Stop-Process: $($_.Exception.Message)" }
}
# wait until the old python is really gone (max 10s)
$deadline = (Get-Date).AddSeconds(10)
while ($ProcId -gt 0 -and (Get-Date) -lt $deadline) {
    if (-not (Get-Process -Id $ProcId -ErrorAction SilentlyContinue)) { break }
    Start-Sleep -Milliseconds 500
}
Start-Sleep -Seconds 1
Log "old instance stopped"

# --- 2) apply new files ---
$exclude = @('data', '.venv', 'logs', '_upgrade', '_backup', '__pycache__')
$platNew = Join-Path $NewDir 'platform'
if (Test-Path $platNew) {
    Get-ChildItem -Path $platNew | ForEach-Object {
        $name = $_.Name
        if ($exclude -contains $name) { Log "skip platform/$name"; return }
        $dest = Join-Path $Root "platform\$name"
        try {
            if ($_.PSIsContainer) { Copy-Item -Path $_.FullName -Destination $dest -Recurse -Force }
            else { Copy-Item -Path $_.FullName -Destination $dest -Force }
            Log "copied platform/$name"
        } catch { Log "FAIL copy platform/$name : $($_.Exception.Message)" }
    }
    # clean stale bytecode
    Get-ChildItem -Path (Join-Path $Root 'platform\app') -Recurse -Directory -Filter '__pycache__' -ErrorAction SilentlyContinue |
        Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
}
# root-level items (requirements.txt / scripts\ / *.md)
Get-ChildItem -Path $NewDir | Where-Object { $_.Name -ne 'platform' } | ForEach-Object {
    $dest = Join-Path $Root $_.Name
    try {
        if ($_.PSIsContainer) { Copy-Item -Path $_.FullName -Destination $dest -Recurse -Force }
        else { Copy-Item -Path $_.FullName -Destination $dest -Force }
        Log "copied root/$($_.Name)"
    } catch { Log "FAIL copy root/$($_.Name) : $($_.Exception.Message)" }
}
Log "files applied"

# --- 3) pip install new dependencies (best effort) ---
$py = Join-Path $Root '.venv\Scripts\python.exe'
$req = Join-Path $Root 'requirements.txt'
if ((Test-Path $py) -and (Test-Path $req)) {
    Log "pip install -r requirements.txt"
    $out = & $py -m pip install -r $req -i https://pypi.tuna.tsinghua.edu.cn/simple 2>&1 | Out-String
    Add-Content -Path $LogFile -Value $out -Encoding UTF8
    Log "pip done (exit $LASTEXITCODE)"
} else {
    Log "venv python or requirements.txt missing -> skip pip"
}

# --- 4) restart ---
if ($svc) {
    Log "Start-Service YizhenPlatform"
    try { Start-Service -Name 'YizhenPlatform' -ErrorAction Stop } catch { Log "Start-Service: $($_.Exception.Message)" }
} else {
    Log "start scripts\start_platform.bat"
    Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', "`"$Root\scripts\start_platform.bat`"" -WorkingDirectory $Root -WindowStyle Minimized
}
Log "=== platform upgrade finished ==="
