. "$PSScriptRoot\windows-portable-common.ps1"

$envMap = Get-PortableEnvForProcess

Stop-PidFileProcess -Name "worker" -PidFile (Join-Path $Script:PidRoot "worker.pid")
Stop-PidFileProcess -Name "web" -PidFile (Join-Path $Script:PidRoot "web.pid")
