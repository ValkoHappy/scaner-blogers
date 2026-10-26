param(
  [string]$OutputPath = "dist-windows-portable/ScanerBlogers-Windows-Portable.zip"
)

$ErrorActionPreference = "Stop"

$AppRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$PackageName = "ScanerBlogers-Windows-Portable"
$DistRoot = Join-Path $AppRoot "dist-windows-portable"
$CacheRoot = Join-Path $AppRoot ".cache-portable"
$TempRoot = Join-Path $AppRoot ".tmp-windows-portable-package"
$PackageRoot = Join-Path $TempRoot $PackageName

if ([System.IO.Path]::IsPathRooted($OutputPath)) {
  $ResolvedOutput = $OutputPath
} else {
  $ResolvedOutput = Join-Path $AppRoot $OutputPath
}

function Assert-InsideApp {
  param([string]$PathToCheck)

  $resolved = [System.IO.Path]::GetFullPath($PathToCheck)
  $root = [System.IO.Path]::GetFullPath($AppRoot)
  if (-not $resolved.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to operate outside app root: $resolved"
  }
}

function Copy-Directory {
  param(
    [string]$Source,
    [string]$Destination,
    [string[]]$ExcludeDirs = @(),
    [string[]]$ExcludeFiles = @()
  )

  New-Item -ItemType Directory -Force -Path $Destination | Out-Null
  $args = @($Source, $Destination, "/E", "/R:1", "/W:1", "/NFL", "/NDL", "/NJH", "/NJS", "/NP")
  foreach ($dir in $ExcludeDirs) {
    $args += @("/XD", (Join-Path $Source $dir))
  }
  foreach ($file in $ExcludeFiles) {
    $args += @("/XF", $file)
  }
  & robocopy @args | Out-Null
  if ($LASTEXITCODE -gt 7) {
    throw "robocopy failed from $Source to $Destination with exit code $LASTEXITCODE"
  }
}

function Remove-DirectoryRobust {
  param([string]$PathToRemove)

  if (-not (Test-Path -LiteralPath $PathToRemove)) {
    return
  }

  Assert-InsideApp $PathToRemove

  try {
    Remove-Item -LiteralPath $PathToRemove -Recurse -Force -ErrorAction Stop
    return
  } catch {
    Write-Host "Regular cleanup failed, retrying with robocopy mirror: $PathToRemove"
  }

  $emptyDir = Join-Path $CacheRoot "empty-delete"
  Assert-InsideApp $emptyDir
  if (Test-Path -LiteralPath $emptyDir) {
    Remove-Item -LiteralPath $emptyDir -Recurse -Force -ErrorAction SilentlyContinue
  }
  New-Item -ItemType Directory -Force -Path $emptyDir | Out-Null

  & robocopy $emptyDir $PathToRemove /MIR /R:1 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -gt 7) {
    throw "robocopy cleanup failed for $PathToRemove with exit code $LASTEXITCODE"
  }

  Remove-Item -LiteralPath $PathToRemove -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $emptyDir -Recurse -Force -ErrorAction SilentlyContinue
}

function Copy-FileIfExists {
  param(
    [string]$Source,
    [string]$Destination
  )

  if (Test-Path -LiteralPath $Source) {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Destination) | Out-Null
    Copy-Item -LiteralPath $Source -Destination $Destination -Force
  }
}

function Find-NodeRoot {
  $nodeExe = (Get-Command node.exe -ErrorAction Stop).Source
  return Split-Path -Parent $nodeExe
}

function Find-PythonRoot {
  $pythonExe = (Get-Command python.exe -ErrorAction Stop).Source
  return Split-Path -Parent $pythonExe
}

Assert-InsideApp $DistRoot
Assert-InsideApp $CacheRoot
Assert-InsideApp $TempRoot
Assert-InsideApp $ResolvedOutput

Set-Location $AppRoot
New-Item -ItemType Directory -Force -Path $DistRoot, $CacheRoot | Out-Null

Write-Host "Building ScanerBlogers..."
npm.cmd run build
if ($LASTEXITCODE -ne 0) {
  throw "npm build failed"
}

if (Test-Path -LiteralPath $TempRoot) {
  Remove-DirectoryRobust $TempRoot
}
New-Item -ItemType Directory -Force -Path $PackageRoot | Out-Null

$excludeDirs = @(
  ".cache-portable",
  ".git",
  ".instagram",
  ".next",
  ".tmp",
  ".tmp-copy-debug",
  ".tmp-portable-smoke",
  ".tmp-portable-package",
  ".tmp-windows-portable-package",
  ".venv-instagram",
  ".vk",
  ".vk-browser",
  "backups",
  "data",
  "dist-portable",
  "dist-windows-portable",
  "logs",
  "playwright-report",
  "runtime",
  "test-results",
  "apps\web\.next\cache",
  "apps\web\.next\dev",
  "node_modules\@scaner-blogers\web\.next"
)
$excludeFiles = @(
  ".env",
  ".env.local",
  ".env.portable-test",
  "*.log",
  "*.out",
  "*.err",
  "*.tsbuildinfo",
  "inject*.js",
  "debug_*.py",
  "creative*.html",
  "dashboard-screenshot.png",
  "mobile-detail-screenshot.png",
  "chrome-extension.zip"
)

Write-Host "Copying app files..."
Copy-Directory -Source $AppRoot -Destination $PackageRoot -ExcludeDirs $excludeDirs -ExcludeFiles $excludeFiles

Write-Host "Copying Node runtime..."
$nodeRoot = Find-NodeRoot
Copy-Directory -Source $nodeRoot -Destination (Join-Path $PackageRoot "runtime\node")

Write-Host "Copying Python runtime..."
$pythonRoot = Find-PythonRoot
Copy-Directory -Source $pythonRoot -Destination (Join-Path $PackageRoot "runtime\python")
$sitePackages = Join-Path $AppRoot ".venv-instagram\Lib\site-packages"
if (Test-Path -LiteralPath $sitePackages) {
  Copy-Directory -Source $sitePackages -Destination (Join-Path $PackageRoot "runtime\python\Lib\site-packages")
}

Write-Host "Copying Playwright browsers..."
$browserRoot = Join-Path $env:LOCALAPPDATA "ms-playwright"
$targetBrowserRoot = Join-Path $PackageRoot "runtime\ms-playwright"
New-Item -ItemType Directory -Force -Path $targetBrowserRoot | Out-Null
foreach ($browserDir in @("chromium-1223", "chromium_headless_shell-1223", "ffmpeg-1011")) {
  $source = Join-Path $browserRoot $browserDir
  if (Test-Path -LiteralPath $source) {
    Copy-Directory -Source $source -Destination (Join-Path $targetBrowserRoot $browserDir)
  }
}

New-Item -ItemType Directory -Force -Path (Join-Path $PackageRoot "runtime\data"), (Join-Path $PackageRoot "runtime\pids"), (Join-Path $PackageRoot "logs") | Out-Null

if (Test-Path -LiteralPath $ResolvedOutput) {
  Remove-Item -LiteralPath $ResolvedOutput -Force
}
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $ResolvedOutput) | Out-Null

Write-Host "Compressing portable ZIP..."
$tar = (Get-Command tar.exe -ErrorAction Stop).Source
& $tar -a -cf $ResolvedOutput -C $TempRoot (Split-Path -Leaf $PackageRoot)
if ($LASTEXITCODE -ne 0) {
  throw "tar.exe failed to create portable ZIP with exit code $LASTEXITCODE"
}
Remove-DirectoryRobust $TempRoot

Write-Host "Windows portable archive created:"
Write-Host $ResolvedOutput
Write-Host "On another PC: unzip, open $PackageName, run start.bat"
