# ========================================================================
# Extract-platform.ps1  —  解压纯平台包，跳过顶层版本目录
#
# 输入：dist\yizhen-platform_v1.0.1.zip  （你自己打出来的）
# 输出：yizhen-platform\                 （目标目录，内容直接落这里）
#
# 原理：zip 里所有 entry 形如 yizhen-platform_v1.0.1/xxx/yyy
#       脚本把顶层那层截掉，直接把 xxx/yyy 落到 yizhen-platform/
#
# 用法：powershell -ExecutionPolicy Bypass -File .\Extract-platform.ps1
#       或右键 → 以 PowerShell 运行
# ========================================================================

$ErrorActionPreference = "Stop"
$zipName = "yizhen-platform_v1.0.1.zip"
$topDir  = "yizhen-platform_v1.0.1"   # zip 里的顶层目录名
$outDir  = "yizhen-platform"          # 解压目标

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$zipPath   = Join-Path $scriptDir "dist\$zipName"
$outPath   = Join-Path $scriptDir $outDir

Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  Extract $zipName  ->  $outDir/" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  zip   : $zipPath"
Write-Host "  output: $outPath"
Write-Host ""

if (-not (Test-Path $zipPath)) {
    Write-Host "[FAIL] zip not found: $zipPath" -ForegroundColor Red
    Write-Host "       Build first:  python platform\build_all.py --platform-only" -ForegroundColor Yellow
    exit 1
}

# 目标已存在？提示但不自动删（怕误清用户数据）
if (Test-Path $outPath) {
    Write-Host "[WARN] Target directory already exists: $outPath" -ForegroundColor Yellow
    $ans = Read-Host "       Overwrite? (Y = merge & overwrite, N = abort) [Y/N]"
    if ($ans -ne "Y" -and $ans -ne "y") {
        Write-Host "Aborted."
        exit 0
    }
    Write-Host "       Merging into existing directory..." -ForegroundColor Gray
}

Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead($zipPath)

$count = 0
$skip  = 0
foreach ($entry in $zip.Entries) {
    # 跳过顶层目录本身（空 entry）
    if ($entry.FullName -eq "$topDir/" -or $entry.FullName -eq "$topDir") { continue }

    # 截掉顶层前缀
    if (-not $entry.FullName.StartsWith("$topDir/")) {
        Write-Host "  [SKIP] entry not under top dir: $($entry.FullName)" -ForegroundColor Gray
        $skip++; continue
    }
    $relPath = $entry.FullName.Substring($topDir.Length + 1)

    if ($relPath -eq "") { continue }

    $targetPath = Join-Path $outPath $relPath
    $targetDir  = Split-Path -Parent $targetPath

    # 目录 entry（以 / 结尾）→ 建目录继续
    if ($entry.FullName.EndsWith("/")) {
        if ($targetDir -and -not (Test-Path $targetDir)) {
            New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
        }
        continue
    }

    # 文件 entry
    if ($targetDir -and -not (Test-Path $targetDir)) {
        New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
    }
    [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $targetPath, $true)
    $count++
}
$zip.Dispose()

Write-Host ""
Write-Host "[OK] Extracted $count files  (skipped $skip)" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:"
Write-Host "  1. cd $outDir"
Write-Host "  2. Deploy.ps1             # Python venv + pip + firewall"
Write-Host "  3. start_platform.bat     # or nssm register_platform_service.bat"
Write-Host ""
