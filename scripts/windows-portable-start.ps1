. "$PSScriptRoot\windows-portable-common.ps1"

Set-Location $Script:AppRoot
New-Item -ItemType Directory -Force -Path $Script:LogsRoot, $Script:DataRoot, $Script:PidRoot | Out-Null

$createdEnv = Write-PortableEnvIfMissing
$envMap = Get-PortableEnvForProcess
Set-ProcessEnvironment $envMap

$webPort = [int](Get-PortableValue $envMap "WEB_PORT" "3200")
$npm = Join-Path $Script:RuntimeRoot "node\npm.cmd"

if (-not (Test-Path -LiteralPath $npm)) {
  throw "Node runtime is missing: $npm"
}

Write-Host "Preparing SQLite database..."
& $npm run prisma:migrate:deploy
if ($LASTEXITCODE -ne 0) {
  throw "SQLite migrations failed."
}

$webLog = Join-Path $Script:LogsRoot "web.log"
$workerLog = Join-Path $Script:LogsRoot "worker.log"
$webPid = Join-Path $Script:PidRoot "web.pid"
$workerPid = Join-Path $Script:PidRoot "worker.pid"

$webArgs = "/c `"`"$npm`" --workspace apps/web run start -- --hostname 127.0.0.1 --port $webPort >> `"$webLog`" 2>>&1`""
$workerArgs = "/c `"`"$npm`" --workspace apps/worker run start >> `"$workerLog`" 2>>&1`""

Start-LoggedProcess -Name "web" -Command "cmd.exe" -Arguments $webArgs -EnvMap $envMap -PidFile $webPid -LogFile $webLog
Start-LoggedProcess -Name "worker" -Command "cmd.exe" -Arguments $workerArgs -EnvMap $envMap -PidFile $workerPid -LogFile $workerLog

Write-Host ""
Write-Host "ScanerBlogers is starting."
Write-Host "Open: http://127.0.0.1:$webPort"
Write-Host "Logs: $Script:LogsRoot"
if ($createdEnv) {
  Write-Host "Login/password were printed above and saved in .env"
} else {
  Write-Host "Login/password are in .env: ADMIN_EMAIL and ADMIN_PASSWORD"
}
