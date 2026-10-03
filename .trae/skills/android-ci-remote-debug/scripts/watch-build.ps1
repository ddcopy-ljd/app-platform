# Show the latest GitHub Actions run for ddcopy-ljd/app-platform.
# On failure, print all failure-level check-run annotations (public API, no login).
# Usage:
#   .\watch-build.ps1
#   .\watch-build.ps1 -Proxy ""
#   .\watch-build.ps1 -WaitSeconds 90
param(
    [string]$Repo = "ddcopy-ljd/app-platform",
    [string]$Proxy = "http://127.0.0.1:20891",
    [int]$WaitSeconds = 0
)

if ($WaitSeconds -gt 0) { Start-Sleep -Seconds $WaitSeconds }

$headers = @{ "User-Agent" = "trae-skill" }

function Invoke-GH([string]$url) {
    if ($Proxy) { Invoke-RestMethod -Uri $url -Headers $headers -Proxy $Proxy }
    else { Invoke-RestMethod -Uri $url -Headers $headers }
}

$run = (Invoke-GH "https://api.github.com/repos/$Repo/actions/runs?per_page=1").workflow_runs[0]
if (-not $run) { Write-Error "no runs found"; exit 2 }

Write-Host ("run #{0} sha={1} status={2} conclusion={3}" -f `
    $run.run_number, $run.head_sha.Substring(0, 7), $run.status, $run.conclusion)
Write-Host ("url: {0}" -f $run.html_url)

if ($run.conclusion -ne "failure") { exit 0 }

$jobs = Invoke-GH "https://api.github.com/repos/$Repo/actions/runs/$($run.id)/jobs"
$failed = $jobs.jobs | Where-Object { $_.conclusion -eq "failure" }
foreach ($job in $failed) {
    Write-Host ""
    Write-Host ("==== job: {0} ====" -f $job.name)
    $failedSteps = $job.steps | Where-Object { $_.conclusion -eq "failure" } | ForEach-Object { $_.name }
    Write-Host ("failed steps: {0}" -f ($failedSteps -join ", "))

    $annotations = Invoke-GH "https://api.github.com/repos/$Repo/check-runs/$($job.id)/annotations"
    foreach ($a in ($annotations | Where-Object { $_.annotation_level -eq "failure" })) {
        Write-Host "----"
        Write-Host $a.message
    }
}
exit 1
