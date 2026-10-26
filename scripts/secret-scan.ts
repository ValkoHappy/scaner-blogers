import { readFileSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface SecretScanFile {
  path: string;
  content: string;
}

export interface SecretLeak {
  path: string;
  line: number;
  kind: string;
  valuePreview: string;
}

export interface RuntimeDriftIssue {
  path: string;
  line: number;
  marker: string;
}

const ignoredPathParts = new Set([
  ".git",
  ".instagram",
  ".next",
  ".tmp",
  ".venv-instagram",
  ".vk",
  ".vk-browser",
  "dist",
  "node_modules",
  "test-results",
  "vendor"
]);

const ignoredFileNames = new Set([
  ".env",
  ".env.local"
]);

const requiredRuntimeIgnoreRules = {
  ".gitignore": [".env.local", ".instagram", ".vk", ".vk-browser", ".tmp-*"],
  ".dockerignore": [".env.local", ".instagram", ".vk", ".vk-browser", ".tmp-*"]
};

const scannedExtensions = new Set([
  ".cjs",
  ".css",
  ".env",
  ".example",
  ".html",
  ".js",
  ".json",
  ".md",
  ".mjs",
  ".py",
  ".tsx",
  ".ts",
  ".txt",
  ".yml",
  ".yaml"
]);

const allowedPlaceholderValues = [
  "",
  "...",
  "***",
  "test-secret",
  "change-me",
  "ig-session-secret",
  "csrf-secret",
  "ig-session-secret-value",
  "csrf-secret-value",
  "user:pass@host:port",
  "your_google_api_key",
  "test_account_password",
  "env-password",
  "http://user:pass@host:port",
  "socks5://user:pass@host:port",
  "px:secret@198.51.100.10:8000",
  "http://env-proxy.local:8000",
  "generate-a-64-char-random-secret",
  "generate-a-long-unique-password",
  "TestOnly!ChangeInCi2026"
];

const runtimeDriftIgnorePathPrefixes = [
  "docs/superpowers/plans/"
];

const runtimeDriftIgnorePaths = new Set([
  "scripts/secret-scan.ts",
  "tests/secret-scan.test.ts"
]);

const forbiddenRuntimeMarkers = [
  { marker: "PostgreSQL", pattern: /\bPostgreSQL\b/g },
  { marker: "postgresql://", pattern: /postgresql:\/\//gi },
  { marker: "POSTGRES_PASSWORD", pattern: /\bPOSTGRES_PASSWORD\b/g },
  { marker: "docker compose up postgres", pattern: /\bdocker\s+compose\s+up\s+postgres\b/gi },
  { marker: "postgres-test", pattern: /\bpostgres-test\b/g },
  { marker: "image: postgres", pattern: /\bimage:\s*postgres(?::|\b)/gi }
];

const secretPatterns = [
  { kind: "VK_ACCESS_TOKEN", pattern: /\bvk1\.a\.[A-Za-z0-9._-]{12,}/g },
  { kind: "GOOGLE_API_KEY", pattern: /\bAIza[0-9A-Za-z_-]{20,}/g },
  { kind: "AUTHORIZATION_HEADER", pattern: /\bauthorization\s*[:=]\s*(?:bearer|basic)\s+([A-Za-z0-9._~+/-]+=*)/gi },
  { kind: "INSTAGRAM_SESSION_COOKIE", pattern: /\b(?:sessionid|csrftoken|ds_user_id|mid|ig_did)\s*(?::|=(?!=))\s*["']?([^"'`\s;,)\]]+)["']?/gi },
  { kind: "PROXY_CREDENTIAL_URL", pattern: /\b(?:socks5h?|https?):\/\/([^:@/"'`\s)|]+:[^@/"'`\s)|]+@[^/"'`\s),|]+)/gi },
  { kind: "SECRET_ENV_VALUE", pattern: /\b(AUTH_SECRET|ADMIN_PASSWORD|INSTAGRAM_PASSWORD|INSTAGRAM_PROXY_URL|VK_ACCESS_TOKEN|VK_SERVER_TOKEN|VK_SERVICE_TOKEN|YOUTUBE_API_KEY)\s*[:=]\s*["']?([^"'\s]+)["']?/g }
];

export function shouldScanSecretPath(filePath: string) {
  const normalized = filePath.replace(/\\/g, "/");
  const parts = normalized.split("/");
  if (parts.some((part) => ignoredPathParts.has(part))) return false;
  const name = parts.at(-1) ?? "";
  if (ignoredFileNames.has(name)) return false;
  if (name.endsWith(".local")) return false;
  if (name.endsWith(".log")) return false;
  return scannedExtensions.has(path.extname(name)) || name === ".env.example" || name === ".env.test.example";
}

export function findSecretLeaks(files: SecretScanFile[]) {
  const leaks: SecretLeak[] = [];
  for (const file of files) {
    if (!shouldScanSecretPath(file.path)) continue;
    const lines = file.content.split(/\r?\n/);
    for (const [index, line] of lines.entries()) {
      for (const rule of secretPatterns) {
        rule.pattern.lastIndex = 0;
        for (const match of line.matchAll(rule.pattern)) {
          const rawValue = match[2] ?? match[1] ?? match[0];
          const value = rawValue.trim().replace(/^["']|["']$/g, "");
          if (isAllowedPlaceholder(value)) continue;
          if (/\.test\.[cm]?[jt]sx?$/.test(file.path) && /^(?:123|42|browser-session|session-id-value|(?:pool|resting|ready|test|first|second|blocked|env)-session-id)$/.test(value)) continue;
          if (rule.kind === "SECRET_ENV_VALUE" && specificTokenKind(value)) continue;
          if (!isSensitivePatternRule(rule.kind) && !specificTokenKind(value) && isCodeOrEnvReference(value)) continue;
          leaks.push({
            path: file.path,
            line: index + 1,
            kind: rule.kind,
            valuePreview: maskSecret(value)
          });
        }
      }
    }
  }
  return dedupeLeaks(leaks);
}

export function findForbiddenRuntimeMarkers(files: SecretScanFile[]) {
  const issues: RuntimeDriftIssue[] = [];
  for (const file of files) {
    if (!shouldCheckRuntimeDrift(file.path)) continue;
    const lines = file.content.split(/\r?\n/);
    for (const [index, line] of lines.entries()) {
      for (const rule of forbiddenRuntimeMarkers) {
        rule.pattern.lastIndex = 0;
        if (rule.pattern.test(line)) {
          issues.push({
            path: file.path,
            line: index + 1,
            marker: rule.marker
          });
        }
      }
    }
  }
  return dedupeRuntimeDriftIssues(issues);
}

export function findMissingRuntimeIgnoreRules(readText: (fileName: string) => string) {
  const missing: string[] = [];
  for (const [fileName, rules] of Object.entries(requiredRuntimeIgnoreRules)) {
    const lines = new Set(readText(fileName)
      .split(/\r\n|\n|\r/)
      .map((line) => line.trim().replace(/\/$/, ""))
      .filter(Boolean));
    for (const rule of rules) {
      const normalizedRule = rule.replace(/\/$/, "");
      if (!lines.has(normalizedRule)) {
        missing.push(`${fileName} missing ${rule}`);
      }
    }
  }
  return missing;
}

async function main() {
  const root = process.cwd();
  const files = await readScannableFiles(root);
  const leaks = findSecretLeaks(files);
  const runtimeDriftIssues = findForbiddenRuntimeMarkers(files);
  const missingRuntimeIgnoreRules = await findMissingRuntimeIgnoreRulesOnDisk(root);
  if (leaks.length === 0 && runtimeDriftIssues.length === 0 && missingRuntimeIgnoreRules.length === 0) {
    console.log(`secret-scan: ok, scanned ${files.length} files`);
    return;
  }

  console.error(`secret-scan: found ${leaks.length} possible secret leak(s), ${runtimeDriftIssues.length} runtime drift issue(s), and ${missingRuntimeIgnoreRules.length} runtime ignore issue(s)`);
  for (const leak of leaks) {
    console.error(`${leak.path}:${leak.line} ${leak.kind} ${leak.valuePreview}`);
  }
  for (const issue of runtimeDriftIssues) {
    console.error(`runtime-drift ${issue.path}:${issue.line} ${issue.marker}`);
  }
  for (const issue of missingRuntimeIgnoreRules) {
    console.error(`runtime-ignore ${issue}`);
  }
  process.exitCode = 1;
}

async function findMissingRuntimeIgnoreRulesOnDisk(root: string) {
  return findMissingRuntimeIgnoreRules((fileName) => {
    try {
      return readFileSyncText(path.join(root, fileName));
    } catch {
      return "";
    }
  });
}

async function readScannableFiles(root: string, current = root): Promise<SecretScanFile[]> {
  const entries = await readdir(current, { withFileTypes: true });
  const result: SecretScanFile[] = [];
  for (const entry of entries) {
    const absolute = path.join(current, entry.name);
    const relative = path.relative(root, absolute) || entry.name;
    if (entry.isDirectory()) {
      if (!shouldScanDirectory(relative)) continue;
      result.push(...await readScannableFiles(root, absolute));
      continue;
    }
    if (!entry.isFile() || !shouldScanSecretPath(relative)) continue;
    result.push({
      path: relative.replace(/\\/g, "/"),
      content: await readFile(absolute, "utf8")
    });
  }
  return result;
}

function shouldScanDirectory(dirPath: string) {
  const normalized = dirPath.replace(/\\/g, "/");
  return !normalized.split("/").some((part) => ignoredPathParts.has(part));
}

function shouldCheckRuntimeDrift(filePath: string) {
  const normalized = filePath.replace(/\\/g, "/");
  if (runtimeDriftIgnorePaths.has(normalized)) return false;
  return !runtimeDriftIgnorePathPrefixes.some((prefix) => normalized.startsWith(prefix));
}

function isAllowedPlaceholder(value: string) {
  if (allowedPlaceholderValues.includes(value) || /^generate-[a-z0-9-]+$/i.test(value)) return true;
  if (/^user:pass@(?:host|(?:\d{1,3}\.){3}\d{1,3}):\d+$/i.test(value)) return true;
  if (/^user:pa%3Ass@(?:host|(?:\d{1,3}\.){3}\d{1,3}):\d+$/i.test(value)) return true;
  if (/^user:pass@example\.com:\d+$/i.test(value)) return true;
  return false;
}

function isCodeOrEnvReference(value: string) {
  if (value === "=" || /^\{[A-Za-z_]\w*\}$/.test(value)) return true;
  if (/^[A-Za-z_$][\w$]*\[$/.test(value)) return true;
  if (value.startsWith("${") || value.startsWith("process.env.")) return true;
  if (value.includes("(") || value.includes(")")) return true;
  if (/^[A-Za-z_$][\w$]*(?:(?:\.|\?\.)[A-Za-z_$][\w$]*|\[["'][\w$]+["']\])*[\]);,]*$/.test(value)) return true;
  return false;
}

function specificTokenKind(value: string) {
  if (/^vk1\.a\.[A-Za-z0-9._-]{12,}$/.test(value)) return "VK_ACCESS_TOKEN";
  if (/^AIza[0-9A-Za-z_-]{20,}$/.test(value)) return "GOOGLE_API_KEY";
  return null;
}

function isSensitivePatternRule(kind: string) {
  return kind === "AUTHORIZATION_HEADER";
}

function maskSecret(value: string) {
  if (value.length <= 8) return "***";
  return `${value.slice(0, 4)}***${value.slice(-4)}`;
}

function dedupeLeaks(leaks: SecretLeak[]) {
  const seen = new Set<string>();
  return leaks.filter((leak) => {
    const key = `${leak.path}:${leak.line}:${leak.kind}:${leak.valuePreview}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function dedupeRuntimeDriftIssues(issues: RuntimeDriftIssue[]) {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = `${issue.path}:${issue.line}:${issue.marker}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function readFileSyncText(filePath: string) {
  return readFileSync(filePath, "utf8");
}

const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === thisFile) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
