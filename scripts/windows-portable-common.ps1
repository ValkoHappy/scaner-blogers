$ErrorActionPreference = "Stop"

$Script:AppRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$Script:RuntimeRoot = Join-Path $Script:AppRoot "runtime"
$Script:LogsRoot = Join-Path $Script:AppRoot "logs"
$Script:DataRoot = Join-Path $Script:RuntimeRoot "data"
$Script:PidRoot = Join-Path $Script:RuntimeRoot "pids"
$Script:EnvPath = Join-Path $Script:AppRoot ".env"

function New-PortableSecret {
  param([int]$Bytes = 32)

  $buffer = New-Object byte[] $Bytes
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $rng.GetBytes($buffer)
  } finally {
    $rng.Dispose()
  }
  return [Convert]::ToBase64String($buffer).TrimEnd("=").Replace("+", "-").Replace("/", "_")
}

function Read-PortableEnv {
  param([string]$Path = $Script:EnvPath)

  $envMap = @{}
  if (-not (Test-Path -LiteralPath $Path)) {
    return $envMap
  }

  foreach ($line in Get-Content -LiteralPath $Path) {
    $trimmed = $line.Trim()
    if (-not $trimmed -or $trimmed.StartsWith("#")) {
      continue
    }
    $index = $trimmed.IndexOf("=")
    if ($index -lt 1) {
      continue
    }
    $key = $trimmed.Substring(0, $index).Trim()
    $value = $trimmed.Substring($index + 1).Trim().Trim('"')
    $envMap[$key] = $value
  }
  return $envMap
}

function Write-PortableEnvIfMissing {
  if (Test-Path -LiteralPath $Script:EnvPath) {
    return $false
  }

  New-Item -ItemType Directory -Force -Path $Script:RuntimeRoot | Out-Null
  $authSecret = New-PortableSecret 64
  $adminPassword = "ScanerAdmin_" + (New-PortableSecret 24)
  $databaseUrl = "file:./runtime/data/scaner.db"

  $envContent = @(
    "WEB_PORT=3200",
    "DATABASE_URL=$databaseUrl",
    "",
    "AUTH_SECRET=$authSecret",
    "AUTH_COOKIE_SECURE=false",
    "ADMIN_EMAIL=admin@scaner.local",
    "ADMIN_PASSWORD=$adminPassword",
    "",
    "SCANER_APP_ROOT=$Script:AppRoot",
    "INSTAGRAM_PYTHON_BIN=$Script:RuntimeRoot\python\python.exe",
    "VK_PYTHON_BIN=$Script:RuntimeRoot\python\python.exe",
    "YOUTUBE_PYTHON_BIN=$Script:RuntimeRoot\python\python.exe",
    "PLAYWRIGHT_BROWSERS_PATH=$Script:RuntimeRoot\ms-playwright",
    "",
    "INSTAGRAM_USERNAME=",
    "INSTAGRAM_PASSWORD=",
    "INSTAGRAM_SESSION_FILE=.instagram/session.json",
    "INSTAGRAM_PROXY_URL=",
    "",
    "VK_ACCESS_TOKEN=",
    "YOUTUBE_API_KEY=",
    "",
    "COLLECTION_CRON=0 3 * * *",
    "WORKER_CONCURRENCY=2",
    "WORKER_POLL_INTERVAL_MS=15000",
    "SOCIAL_KNOWN_PROFILE_SKIP_LIMIT=5000",
    "SOCIAL_PLATFORM_CONCURRENCY_INSTAGRAM=1",
    "SOCIAL_PLATFORM_CONCURRENCY_VK=1",
    "SOCIAL_PLATFORM_CONCURRENCY_YOUTUBE=1",
    "NEXT_PUBLIC_APP_NAME=ScanerBlogers"
  )

  Set-Content -LiteralPath $Script:EnvPath -Value $envContent -Encoding UTF8
  Write-Host "Created .env"
  Write-Host "Admin login: admin@scaner.local"
  Write-Host "Admin password: $adminPassword"
  return $true
}

function Get-PortableEnvForProcess {
  $envMap = Read-PortableEnv
  $databaseUrl = Get-PortableValue $envMap "DATABASE_URL" "file:./runtime/data/scaner.db"
  if ($databaseUrl.StartsWith("file:")) {
    $databasePath = $databaseUrl.Substring(5)
    if ($databasePath -ne ":memory:" -and -not [System.IO.Path]::IsPathRooted($databasePath)) {
      $absoluteDatabasePath = [System.IO.Path]::GetFullPath((Join-Path $Script:AppRoot $databasePath))
      $envMap["DATABASE_URL"] = "file:" + $absoluteDatabasePath.Replace("\", "/")
    }
  }
  $envMap["NODE_ENV"] = "production"
  $envMap["PATH"] = "$Script:RuntimeRoot\node;$Script:RuntimeRoot\python;$($env:PATH)"
  $envMap["SCANER_APP_ROOT"] = "$Script:AppRoot"
  $envMap["INSTAGRAM_PYTHON_BIN"] = "$Script:RuntimeRoot\python\python.exe"
  $envMap["VK_PYTHON_BIN"] = "$Script:RuntimeRoot\python\python.exe"
  $envMap["YOUTUBE_PYTHON_BIN"] = "$Script:RuntimeRoot\python\python.exe"
  $envMap["PLAYWRIGHT_BROWSERS_PATH"] = "$Script:RuntimeRoot\ms-playwright"
  return $envMap
}

function Set-ProcessEnvironment {
  param([hashtable]$EnvMap)

  foreach ($key in $EnvMap.Keys) {
    [Environment]::SetEnvironmentVariable($key, [string]$EnvMap[$key], "Process")
  }
}

function Get-PortableValue {
  param(
    [hashtable]$EnvMap,
    [string]$Key,
    [string]$DefaultValue
  )

  if ($EnvMap.ContainsKey($Key) -and -not [string]::IsNullOrWhiteSpace([string]$EnvMap[$Key])) {
    return [string]$EnvMap[$Key]
  }
  return $DefaultValue
}

function Test-PortOpen {
  param(
    [string]$HostName = "127.0.0.1",
    [int]$Port
  )

  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $iar = $client.BeginConnect($HostName, $Port, $null, $null)
    if (-not $iar.AsyncWaitHandle.WaitOne(500, $false)) {
      return $false
    }
    $client.EndConnect($iar)
    return $true
  } catch {
    return $false
  } finally {
    $client.Close()
  }
}

function Start-LoggedProcess {
  param(
    [string]$Name,
    [string]$Command,
    [string]$Arguments,
    [hashtable]$EnvMap,
    [string]$PidFile,
    [string]$LogFile
  )

  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $PidFile) | Out-Null
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $LogFile) | Out-Null

  if (Test-Path -LiteralPath $PidFile) {
    $oldPid = (Get-Content -LiteralPath $PidFile -ErrorAction SilentlyContinue | Select-Object -First 1)
    if ($oldPid -and (Get-Process -Id ([int]$oldPid) -ErrorAction SilentlyContinue)) {
      Write-Host "$Name is already running, pid $oldPid"
      return
    }
  }

  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $Command
  $psi.Arguments = $Arguments
  $psi.WorkingDirectory = $Script:AppRoot
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  foreach ($key in $EnvMap.Keys) {
    $psi.Environment[$key] = [string]$EnvMap[$key]
  }

  $process = [System.Diagnostics.Process]::Start($psi)
  Set-Content -LiteralPath $PidFile -Value $process.Id -Encoding ASCII
  Add-Content -LiteralPath $LogFile -Value "[$(Get-Date -Format s)] started $Name pid $($process.Id): $Command $Arguments"
  Write-Host "Started $Name, pid $($process.Id)"
}

function Stop-PidFileProcess {
  param(
    [string]$Name,
    [string]$PidFile
  )

  if (-not (Test-Path -LiteralPath $PidFile)) {
    Write-Host "$Name is not running"
    return
  }

  $pidValue = Get-Content -LiteralPath $PidFile -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($pidValue) {
    $process = Get-Process -Id ([int]$pidValue) -ErrorAction SilentlyContinue
    if ($process) {
      & taskkill.exe /PID $process.Id /T /F | Out-Null
      Write-Host "Stopped $Name, pid $pidValue"
    } else {
      Write-Host "$Name pid file existed, but process is gone"
    }
  }
  Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
}
