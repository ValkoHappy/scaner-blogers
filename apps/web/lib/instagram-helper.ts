import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const WEB_LIB_ROOT = dirname(fileURLToPath(import.meta.url));
const DEFAULT_APP_ROOT = resolve(WEB_LIB_ROOT, "../../..");

export function resolveInstagramHelperAppRoot(options: { cwd?: string; appRootEnv?: string | undefined } = {}) {
  const envRoot = options.appRootEnv?.trim();
  if (envRoot) return envRoot;

  const cwd = options.cwd?.trim();
  if (cwd && /[\\/]app$/i.test(cwd)) return cwd;

  return DEFAULT_APP_ROOT;
}

export function buildInstagramSessionHelperPowerShell(input: {
  appRoot: string;
  defaultLogin: string;
  proxyUrl: string;
}) {
  const appRootBase64 = toUtf8Base64(input.appRoot);
  const defaultLogin = toPowerShellLiteral(input.defaultLogin);
  const proxyUrl = toPowerShellLiteral(input.proxyUrl);

  return String.raw`param()

$ErrorActionPreference = "Stop"
$env:PYTHONIOENCODING = "utf-8"
$env:PYTHONUTF8 = "1"

$projectRoot = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${appRootBase64}'))
$helperScriptPath = Join-Path $projectRoot 'collectors\instagram\session_helper.py'
$preferredWindowsPython = Join-Path $projectRoot '.venv-instagram\Scripts\python.exe'
$preferredUnixPython = Join-Path $projectRoot '.venv-instagram\bin\python'
$defaultLogin = '${defaultLogin}'
$proxyUrl = '${proxyUrl}'
$outputPath = Join-Path ([Environment]::GetFolderPath('Desktop')) 'instagram-session.json'

function Get-PythonCommand {
  if (Test-Path -LiteralPath $preferredWindowsPython) {
    return @{ Command = $preferredWindowsPython; Arguments = @() }
  }

  if (Test-Path -LiteralPath $preferredUnixPython) {
    return @{ Command = $preferredUnixPython; Arguments = @() }
  }

  if (Get-Command py.exe -ErrorAction SilentlyContinue) {
    return @{ Command = 'py.exe'; Arguments = @('-3') }
  }

  if (Get-Command python.exe -ErrorAction SilentlyContinue) {
    return @{ Command = 'python.exe'; Arguments = @() }
  }

  throw 'Python 3 was not found. Install Python or restore app/.venv-instagram before running this helper.'
}

if (-not (Test-Path -LiteralPath $helperScriptPath)) {
  throw "Instagram helper entrypoint was not found: $helperScriptPath"
}

$python = Get-PythonCommand
$args = @($helperScriptPath, '--default-login', $defaultLogin, '--output', $outputPath)
if ($proxyUrl) {
  $args += @('--proxy', $proxyUrl)
}

Write-Host 'Starting Instagram helper...'
Write-Host ''
& $python.Command @($python.Arguments) @($args)
$exitCode = $LASTEXITCODE

Write-Host ''
if ($exitCode -eq 0) {
  Write-Host 'Done. Upload instagram-session.json back into ScanerBlogers.'
} else {
  Write-Host "Helper finished with error code $exitCode."
}

Read-Host 'Press Enter to close'
exit $exitCode
`;
}

function toPowerShellLiteral(value: string) {
  return value.replace(/'/g, "''");
}

function toUtf8Base64(value: string) {
  return Buffer.from(value, "utf8").toString("base64");
}
