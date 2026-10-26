param(
  [Parameter(Mandatory = $true)]
  [string]$NodePath
)

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot
if (-not $env:DATABASE_URL) {
  $dbPath = [System.IO.Path]::GetFullPath((Join-Path $repoRoot 'data\scaner.db'))
  $env:DATABASE_URL = 'file:' + $dbPath.Replace('\', '/')
}
if (-not $env:WORKER_POLL_INTERVAL_MS) { $env:WORKER_POLL_INTERVAL_MS = '2000' }
& $NodePath 'apps/worker/dist/index.js'
exit $LASTEXITCODE
