param(
  [string]$OutputPath = "dist-portable/scaner-blogers-portable.zip"
)

$ErrorActionPreference = "Stop"

$AppRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$TempRoot = Join-Path $AppRoot ".tmp-portable-package"
$TempApp = Join-Path $TempRoot "app"

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

Assert-InsideApp $TempRoot
Assert-InsideApp $ResolvedOutput

$outputDir = Split-Path -Parent $ResolvedOutput
New-Item -ItemType Directory -Force -Path $outputDir | Out-Null

if (Test-Path -LiteralPath $TempRoot) {
  Remove-Item -LiteralPath $TempRoot -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $TempApp | Out-Null

$excludedDirs = New-Object "System.Collections.Generic.HashSet[string]" ([System.StringComparer]::OrdinalIgnoreCase)
@(
  ".git",
  ".instagram",
  ".next",
  ".tmp",
  ".tmp-portable-package",
  ".venv-instagram",
  ".vk",
  ".vk-browser",
  "backups",
  "dist",
  "dist-portable",
  "node_modules",
  "playwright-report",
  "test-results"
) | ForEach-Object { [void]$excludedDirs.Add($_) }

$excludedFiles = New-Object "System.Collections.Generic.HashSet[string]" ([System.StringComparer]::OrdinalIgnoreCase)
@(
  ".env",
  ".env.local",
  ".env.portable-test"
) | ForEach-Object { [void]$excludedFiles.Add($_) }

function Should-SkipRelativePath {
  param([string]$RelativePath)

  $normalized = $RelativePath.Replace("\", "/")
  $parts = $normalized.Split("/", [System.StringSplitOptions]::RemoveEmptyEntries)
  foreach ($part in $parts) {
    if ($excludedDirs.Contains($part)) {
      return $true
    }
  }

  $name = [System.IO.Path]::GetFileName($RelativePath)
  if ($excludedFiles.Contains($name)) {
    return $true
  }
  if ($name.StartsWith(".tmp", [System.StringComparison]::OrdinalIgnoreCase)) {
    return $true
  }
  if ($name.StartsWith("inject", [System.StringComparison]::OrdinalIgnoreCase) -and $name.EndsWith(".js", [System.StringComparison]::OrdinalIgnoreCase)) {
    return $true
  }
  if ($name.StartsWith("debug_", [System.StringComparison]::OrdinalIgnoreCase) -and $name.EndsWith(".py", [System.StringComparison]::OrdinalIgnoreCase)) {
    return $true
  }
  if ($name.StartsWith("creative", [System.StringComparison]::OrdinalIgnoreCase) -and $name.EndsWith(".html", [System.StringComparison]::OrdinalIgnoreCase)) {
    return $true
  }
  if ($name -eq "chrome-extension.zip") {
    return $true
  }
  if ($name -eq "dashboard-screenshot.png" -or $name -eq "mobile-detail-screenshot.png") {
    return $true
  }
  if ($name.EndsWith(".out", [System.StringComparison]::OrdinalIgnoreCase) -or $name.EndsWith(".err", [System.StringComparison]::OrdinalIgnoreCase)) {
    return $true
  }
  if ($name.EndsWith(".log", [System.StringComparison]::OrdinalIgnoreCase)) {
    return $true
  }
  if ($name.EndsWith(".tsbuildinfo", [System.StringComparison]::OrdinalIgnoreCase)) {
    return $true
  }

  return $false
}

function Get-RelativePathCompat {
  param(
    [string]$BasePath,
    [string]$TargetPath
  )

  $baseFull = [System.IO.Path]::GetFullPath($BasePath)
  if (-not $baseFull.EndsWith([System.IO.Path]::DirectorySeparatorChar)) {
    $baseFull += [System.IO.Path]::DirectorySeparatorChar
  }

  $targetFull = [System.IO.Path]::GetFullPath($TargetPath)
  $baseUri = New-Object System.Uri($baseFull)
  $targetUri = New-Object System.Uri($targetFull)
  $relativeUri = $baseUri.MakeRelativeUri($targetUri)
  return [System.Uri]::UnescapeDataString($relativeUri.ToString()).Replace("/", [System.IO.Path]::DirectorySeparatorChar)
}

Get-ChildItem -LiteralPath $AppRoot -Force -Recurse | ForEach-Object {
  $relative = Get-RelativePathCompat -BasePath $AppRoot -TargetPath $_.FullName
  if (Should-SkipRelativePath $relative) {
    return
  }

  $target = Join-Path $TempApp $relative
  if ($_.PSIsContainer) {
    New-Item -ItemType Directory -Force -Path $target | Out-Null
    return
  }

  $targetDir = Split-Path -Parent $target
  New-Item -ItemType Directory -Force -Path $targetDir | Out-Null
  Copy-Item -LiteralPath $_.FullName -Destination $target -Force
}

if (Test-Path -LiteralPath $ResolvedOutput) {
  Remove-Item -LiteralPath $ResolvedOutput -Force
}

Compress-Archive -Path $TempApp -DestinationPath $ResolvedOutput -Force
Remove-Item -LiteralPath $TempRoot -Recurse -Force

Write-Host "Portable archive created:"
Write-Host $ResolvedOutput
Write-Host ""
Write-Host "On another PC: unzip it, open the app folder, then run:"
Write-Host "powershell -ExecutionPolicy Bypass -File .\scripts\portable-start.ps1"
