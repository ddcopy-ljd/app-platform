<#
  Yizhen Platform · 外网部署一键脚本
  =====================================
  Windows Server / Windows 10+ · PowerShell 5.1+ · 以管理员运行（防火墙规则）

  用法：
    1) 解压 yizhen-stack_v*.zip 到目标目录（例：C:\Yizhen）
    2) 右键 Deploy.ps1 → 以管理员身份运行
       或 PowerShell 里：powershell -ExecutionPolicy Bypass -File Deploy.ps1
    3) 按提示回答（全部默认即可走完整流程）

  幂等：已执行过的步骤自动跳过，可重复运行修复环境。
#>

$ErrorActionPreference = "Continue"
$Host.UI.RawUI.WindowTitle = "Yizhen Platform · 外网部署"

# --- 路径锚点：脚本本身在解压目录根 ---
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Venv = Join-Path $Root ".venv"
$VenvPy = Join-Path $Venv "Scripts\python.exe"
$PlatformDir = Join-Path $Root "platform"
$BackupDir = Join-Path $Root "backup"
$DataDir = Join-Path $PlatformDir "data"
$TenantDbs = Join-Path $DataDir "tenant_dbs"

function Step([string]$Name, [scriptblock]$Action) {
    Write-Host ""
    Write-Host "━━━ $Name ━━━" -ForegroundColor Cyan
    try {
        & $Action
        Write-Host "  ✅ 通过" -ForegroundColor Green
    } catch {
        Write-Host "  ❌ 失败：$($_.Exception.Message)" -ForegroundColor Red
        return $false
    }
    return $true
}

function Ask([string]$Prompt, [string]$Default = "n") {
    $v = Read-Host "$Prompt (y/n，默认 $Default)"
    if ([string]::IsNullOrWhiteSpace($v)) { return $Default -eq "y" }
    return $v -match '^[Yy]$'
}

# ================================================================
Write-Host ""
Write-Host "  懿臻珠宝云 · 综合业务应用服务平台 · 外网部署" -ForegroundColor White
Write-Host "  解压目录：$Root" -ForegroundColor Gray
Write-Host "  时间：$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" -ForegroundColor Gray
Write-Host ""

# -------- 预检：必需文件 --------
if (-not (Test-Path (Join-Path $PlatformDir "app\main.py"))) {
    Write-Host "❌ platform\app\main.py 未找到，脚本放在 zip 解压根目录吗？" -ForegroundColor Red
    exit 1
}

# ================================================================
# 阶段 1 · Python
# ================================================================
Step "1. Python 版本检查" {
    $cmd = Get-Command python -ErrorAction SilentlyContinue
    if (-not $cmd) {
        throw "python 不在 PATH 中。请安装 Python 3.11+（www.python.org/downloads/）并勾选 Add to PATH"
    }
    $pyver = python --version 2>&1
    Write-Host "  检测到：$pyver" -ForegroundColor Gray
    $major = [int](($pyver -split '\.')[0] -replace '[^\d]', '')
    if ($major -lt 3) { throw "需要 Python 3.11+，当前是 Python $major" }
}

# ================================================================
# 阶段 2 · venv（幂等：存在则跳过）
# ================================================================
Step "2. 创建/校验虚拟环境 .venv" {
    if (Test-Path $VenvPy) {
        Write-Host "  已存在 $Venv，跳过创建" -ForegroundColor Gray
    } else {
        Push-Location $Root
        python -m venv .venv
        if ($LASTEXITCODE -ne 0) { throw "venv 创建失败" }
        Pop-Location
    }
    & $VenvPy --version
}

# ================================================================
# 阶段 3 · pip 升级 + 依赖安装
# ================================================================
Step "3. 安装 pip 依赖" {
    & $VenvPy -m pip install --upgrade pip 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "pip 升级失败" }

    $req = Join-Path $Root "requirements.txt"
    if (-not (Test-Path $req)) {
        # fallback：用 platform\requirements.txt（build_all.py 已合并两份，应该在根）
        $req = Join-Path $PlatformDir "requirements.txt"
    }
    Write-Host "  requirements: $req" -ForegroundColor Gray
    & $VenvPy -m pip install -r $req 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "依赖安装失败，看上方 pip 输出" }
}

# ================================================================
# 阶段 4 · Windows 防火墙规则（仅管理员）
# ================================================================
Step "4. 防火墙放行 8000 / 8002" {
    $isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    if (-not $isAdmin) {
        Write-Host "  非管理员，跳过防火墙规则（请以管理员重新运行，或手工在高级安全 Windows Defender 防火墙里放行 8000/8002）" -ForegroundColor Yellow
        return
    }
    foreach ($port in @(8000, 8002)) {
        $name = "Yizhen Platform Port $port"
        $exists = netsh advfirewall firewall show rule name=$name 2>&1 | Select-String -Pattern "No rules match" -Quiet
        if (-not $exists) {
            Write-Host "  规则已存在：$name" -ForegroundColor Gray
            continue
        }
        netsh advfirewall firewall add rule name=$name dir=in action=allow protocol=TCP localport=$port > $null
        if ($LASTEXITCODE -ne 0) { throw "添加规则 $name 失败" }
        Write-Host "  + $name" -ForegroundColor Gray
    }
}

# ================================================================
# 阶段 5 · 可选：恢复生产数据库
# ================================================================
if (Test-Path $BackupDir) {
    Write-Host ""
    Write-Host "━━━ 5. 恢复生产数据库（可选）━━━" -ForegroundColor Cyan
    $restore = Ask "zip 内 backup/ 目录有开发数据库备份。恢复吗？(n=全新初始化)" "n"
    if ($restore) {
        # 确保目标目录存在
        foreach ($p in @($DataDir, $TenantDbs)) { New-Item -ItemType Directory -Path $p -Force | Out-Null }

        $copied = 0
        Get-ChildItem -Path $BackupDir -Recurse -Filter "*.sqlite" | ForEach-Object {
            $rel = $_.FullName.Substring($BackupDir.Length + 1)           # 20261009\jewelry\xxx.sqlite
            $parts = $rel -split '\\'
            if ($parts.Length -ge 3 -and $parts[1] -eq "platform") {
                # backup/YYYYMMDD/platform/platform.db → platform\data\platform.db
                $dst = Join-Path $DataDir $_.Name
            } elseif ($parts.Length -ge 3) {
                # backup/YYYYMMDD/jewelry/xxx.sqlite → platform\data\tenant_dbs\jewelry\xxx.sqlite
                $plugin = $parts[1]
                $pluginDir = Join-Path $TenantDbs $plugin
                New-Item -ItemType Directory -Path $pluginDir -Force | Out-Null
                $dst = Join-Path $pluginDir $_.Name
            } else { return }
            Copy-Item -LiteralPath $_.FullName -Destination $dst -Force
            Write-Host "  $($_.Name) → $dst" -ForegroundColor Gray
            $copied++
        }
        Write-Host "  已恢复 $copied 个数据库文件" -ForegroundColor Green
    } else {
        Write-Host "  全新初始化。首次启动会自动创建 admin/admin123（平台）与 admin/123456（插件），" -ForegroundColor Yellow
        Write-Host "  启动后请立即改密码（清单 1.1 / 1.2）。" -ForegroundColor Yellow
    }
}

# ================================================================
# 阶段 6 · 可选：设平台管理员密码（写入用户级环境变量，永久）
# ================================================================
Write-Host ""
Write-Host "━━━ 6. 设置平台管理员密码（可选）━━━" -ForegroundColor Cyan
$setPwd = Ask "现在就设？(y=输入强密码并写入用户环境变量 PLATFORM_ADMIN_PASSWORD，下次启动生效；n=启动后再用 admin123 登录改)" "n"
if ($setPwd) {
    $pwd = Read-Host "输入平台管理员新密码（至少 12 位，含大小写+数字+特殊字符）"
    if ([string]::IsNullOrWhiteSpace($pwd) -or $pwd.Length -lt 8) {
        Write-Host "  ⚠ 密码太短，跳过设置。启动后直接用 admin/admin123 登录改。" -ForegroundColor Yellow
    } else {
        [Environment]::SetEnvironmentVariable("PLATFORM_ADMIN_PASSWORD", $pwd, "User")
        Write-Host "  ✅ 已写入用户环境变量 PLATFORM_ADMIN_PASSWORD（当前 PowerShell 进程要生效请重开窗口）" -ForegroundColor Green
    }
}

# ================================================================
# 阶段 7 · 端口占用检测（不自动 kill，给用户提示）
# ================================================================
Write-Host ""
Write-Host "━━━ 7. 端口占用检测 ━━━" -ForegroundColor Cyan
foreach ($port in @(8000, 8002)) {
    $used = netstat -ano -p tcp | Select-String ":$port " | Select-String "LISTENING"
    if ($used) {
        $pid = ($used -split '\s+')[-1]
        $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$pid" -ErrorAction SilentlyContinue
        Write-Host "  ⚠ 端口 $port 被占用 · PID=$pid · $($proc.CommandLine ?? 'unknown')" -ForegroundColor Yellow
    } else {
        Write-Host "  端口 $port 空闲 ✅" -ForegroundColor Green
    }
}

# ================================================================
# 阶段 8 · 启动
# ================================================================
Write-Host ""
Write-Host "━━━ 8. 启动服务 ━━━" -ForegroundColor Cyan
Write-Host "  下一步将拉起平台（自动注册 jewelry 插件服务）。" -ForegroundColor Gray
Write-Host "  关闭弹出的命令行窗口即停止服务；生产建议用 nssm 注册为 Windows 服务。" -ForegroundColor Gray
Write-Host ""

$go = Ask "现在启动吗？" "y"
if ($go) {
    $bat = Join-Path $Root "start_platform.bat"
    if (-not (Test-Path $bat)) {
        throw "未找到 $bat"
    }
    Write-Host "  启动窗口将在 3 秒后弹出..." -ForegroundColor Gray
    Start-Sleep -Seconds 3
    Start-Process -FilePath "cmd.exe" -ArgumentList "/k `"$bat`""
}

# ================================================================
# 阶段 9 · 健康检查（等服务就绪）
# ================================================================
Write-Host ""
Write-Host "━━━ 9. 健康检查 ━━━" -ForegroundColor Cyan
Write-Host "  等待服务就绪（最长 30 秒）..." -ForegroundColor Gray
$ok = $false
for ($i = 1; $i -le 30; $i++) {
    Start-Sleep -Seconds 1
    try {
        $r = Invoke-WebRequest -Uri "http://localhost:8000/api/auth/login" -Method Head -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
        if ($r.StatusCode -eq 200 -or $r.StatusCode -eq 405 -or $r.StatusCode -eq 404) {
            Write-Host "  ✅ 平台 8000 端口响应正常（状态 $($r.StatusCode)，第 ${i}s 命中）" -ForegroundColor Green
            $ok = $true
            break
        }
    } catch { }
    Write-Host "  $i/30 ..." -NoNewline
}
if (-not $ok) {
    Write-Host ""
    Write-Host "  ❌ 30 秒内未就绪。检查 start_platform.bat 弹出的窗口有没有报错。" -ForegroundColor Red
}

# ================================================================
Write-Host ""
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host "  部署完成。浏览器打开 http://localhost:8000/ " -ForegroundColor White
Write-Host "  详细检查项见 DEPLOY.txt 第 4 节（运行时验证）" -ForegroundColor Gray
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host ""
