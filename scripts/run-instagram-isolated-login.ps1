$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$appDir = Split-Path -Parent $scriptDir
$python = Join-Path $appDir ".venv-instagram\Scripts\python.exe"
$script = Join-Path $scriptDir "instagram-isolated-login.py"

if (-not (Test-Path $python)) {
    throw "Python executable not found: $python"
}

& $python $script @args
