param(
  [string]$EnvPath = ".env",
  [switch]$NoStart
)

$ErrorActionPreference = "Stop"

$AppRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $AppRoot

if ([System.IO.Path]::IsPathRooted($EnvPath)) {
  $ResolvedEnvPath = $EnvPath
} else {
  $ResolvedEnvPath = Join-Path $AppRoot $EnvPath
}

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

function Read-EnvValue {
  param(
    [string]$Path,
    [string]$Key,
    [string]$DefaultValue = ""
  )

  if (-not (Test-Path -LiteralPath $Path)) {
    return $DefaultValue
  }

  $escaped = [Regex]::Escape($Key)
  $line = Get-Content -LiteralPath $Path | Where-Object { $_ -match "^\s*$escaped\s*=" } | Select-Object -First 1
  if (-not $line) {
    return $DefaultValue
  }

  $value = $line -replace "^\s*$escaped\s*=\s*", ""
  return $value.Trim().Trim('"')
}

if (-not (Test-Path -LiteralPath $ResolvedEnvPath)) {
  $authSecret = New-PortableSecret 64
  $adminPassword = "ScanerAdmin_" + (New-PortableSecret 24)

  $envContent = @(
    "WEB_PORT=3200",
    "DATABASE_URL=file:./data/scaner.db",
    "",
    "AUTH_SECRET=$authSecret",
    "AUTH_COOKIE_SECURE=false",
    "ADMIN_EMAIL=admin@scaner.local",
    "ADMIN_PASSWORD=$adminPassword",
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

  Set-Content -LiteralPath $ResolvedEnvPath -Value $envContent -Encoding UTF8
  Write-Host "Created $ResolvedEnvPath"
  Write-Host "Admin login: admin@scaner.local"
  Write-Host "Admin password: $adminPassword"
} else {
  Write-Host "Using existing $ResolvedEnvPath"
  Write-Host "Admin login/password are in this env file: ADMIN_EMAIL and ADMIN_PASSWORD"
}

$webPort = Read-EnvValue -Path $ResolvedEnvPath -Key "WEB_PORT" -DefaultValue "3200"
if ([string]::IsNullOrWhiteSpace($webPort)) {
  $webPort = "3200"
}

if ($NoStart) {
  Write-Host "NoStart is enabled. Env file was prepared, Docker was not started."
  exit 0
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  throw "Docker was not found. Install Docker Desktop, start it, then run this script again."
}

docker compose --env-file $ResolvedEnvPath up --build -d
docker compose --env-file $ResolvedEnvPath ps

Write-Host ""
Write-Host "ScanerBlogers is starting."
Write-Host "Open: http://127.0.0.1:$webPort"
Write-Host "If the page is still loading, wait 20-60 seconds while migrations and the first start finish."
