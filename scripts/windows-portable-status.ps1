. "$PSScriptRoot\windows-portable-common.ps1"

$envMap = Get-PortableEnvForProcess
$webPort = [int](Get-PortableValue $envMap "WEB_PORT" "3200")
$databaseUrl = Get-PortableValue $envMap "DATABASE_URL" "file:./runtime/data/scaner.db"
$databasePath = $databaseUrl
if ($databasePath.StartsWith("file:")) {
  $databasePath = $databasePath.Substring(5)
}
if (-not [System.IO.Path]::IsPathRooted($databasePath)) {
  $databasePath = Join-Path $Script:AppRoot $databasePath
}

function Show-PidStatus {
  param(
    [string]$Name,
    [string]$PidFile
  )

  if (-not (Test-Path -LiteralPath $PidFile)) {
    Write-Host "${Name}: stopped"
    return
  }

  $pidValue = Get-Content -LiteralPath $PidFile -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($pidValue -and (Get-Process -Id ([int]$pidValue) -ErrorAction SilentlyContinue)) {
    Write-Host "${Name}: running, pid $pidValue"
  } else {
    Write-Host "${Name}: pid file exists, but process is gone"
  }
}

Write-Host "ScanerBlogers portable status"
Write-Host "App root: $Script:AppRoot"
if (Test-Path -LiteralPath $databasePath) {
  $dbFile = Get-Item -LiteralPath $databasePath
  Write-Host "SQLite database: $databasePath ($([Math]::Round($dbFile.Length / 1MB, 2)) MB)"
} else {
  Write-Host "SQLite database: missing ($databasePath)"
}
Write-Host "Web port $webPort open: $(Test-PortOpen -Port $webPort)"
Show-PidStatus -Name "web" -PidFile (Join-Path $Script:PidRoot "web.pid")
Show-PidStatus -Name "worker" -PidFile (Join-Path $Script:PidRoot "worker.pid")
Write-Host "URL: http://127.0.0.1:$webPort"
Write-Host "Logs: $Script:LogsRoot"
