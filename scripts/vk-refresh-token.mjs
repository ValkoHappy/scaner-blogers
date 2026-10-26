import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const appRoot = process.cwd();
const stateDir = path.join(appRoot, ".vk");
const userDataDir = path.join(appRoot, ".vk-browser");
const tokenPath = path.join(stateDir, "token.json");
const envPath = path.join(appRoot, ".env.local");
let appId = "";
let scopes = "groups,wall";

async function loadLocalEnv() {
  let raw = "";
  try {
    raw = await fs.readFile(envPath, "utf8");
  } catch {
    return;
  }
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || process.env[match[1]]) continue;
    const value = match[2].replace(/^(['"])(.*)\1$/, "$2");
    if (value) process.env[match[1]] = value;
  }
}

function buildAuthUrl() {
  const redirectUri = process.env.VK_OAUTH_REDIRECT_URI || "https://oauth.vk.com/blank.html";
  const url = new URL("https://oauth.vk.com/authorize");
  url.searchParams.set("client_id", appId);
  url.searchParams.set("display", "page");
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", scopes);
  url.searchParams.set("response_type", "token");
  url.searchParams.set("v", "5.199");
  return url.toString();
}

function parseTokenFromUrl(url) {
  const parsedUrl = new URL(url);
  const params = new URLSearchParams(parsedUrl.search);
  for (const [key, value] of new URLSearchParams(parsedUrl.hash.replace(/^#/, ""))) params.set(key, value);
  const accessToken = params.get("access_token");
  if (!accessToken) return null;
  const expiresIn = Number(params.get("expires_in") || 0);
  const userId = params.get("user_id");
  const now = Date.now();
  return {
    accessToken,
    userId,
    expiresIn,
    expiresAt: expiresIn > 0 ? new Date(now + expiresIn * 1000).toISOString() : null,
    createdAt: new Date(now).toISOString(),
    appId,
    scopes
  };
}

async function updateEnvFile(token) {
  let raw = "";
  try {
    raw = await fs.readFile(envPath, "utf8");
  } catch {
    // File will be created below.
  }
  raw = raw.replace(/\r\n|\r|\n/g, "\n");
  const line = `VK_ACCESS_TOKEN=${token.accessToken}`;
  if (/^\s*VK_ACCESS_TOKEN\s*=/m.test(raw)) {
    raw = raw.replace(/^\s*VK_ACCESS_TOKEN\s*=.*$/m, line);
  } else {
    raw = raw.endsWith("\n") || !raw ? `${raw}${line}\n` : `${raw}\n${line}\n`;
  }
  if (!/^\s*VK_APP_ID\s*=/m.test(raw)) {
    raw += `VK_APP_ID=${appId}\n`;
  }
  await fs.writeFile(envPath, raw, "utf8");
}

async function main() {
  await loadLocalEnv();
  appId = process.env.VK_APP_ID || "";
  scopes = process.env.VK_OAUTH_SCOPE || "groups,wall";
  if (!appId) {
    throw new Error("vk-token-refresh: VK_APP_ID is required in the shell or .env.local.");
  }
  const authUrl = buildAuthUrl();
  await fs.mkdir(stateDir, { recursive: true });
  const headless = process.env.VK_TOKEN_REFRESH_HEADLESS === "1";
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless,
    viewport: { width: 1200, height: 820 }
  });
  const page = context.pages()[0] || await context.newPage();

  let resolvedToken = null;
  page.on("framenavigated", (frame) => {
    const token = parseTokenFromUrl(frame.url());
    if (token) resolvedToken = token;
  });

  const initialResponse = await page.goto(authUrl, { waitUntil: "domcontentloaded" });
  if (initialResponse && !initialResponse.ok()) {
    const body = await initialResponse.text().catch(() => "");
    let description = "";
    try {
      const payload = JSON.parse(body);
      description = typeof payload?.error_description === "string" ? payload.error_description : "";
    } catch {}
    if (description) {
      await context.close();
      throw new Error(`vk-token-refresh: VK OAuth failed: ${description}`);
    }
  }
  resolvedToken = parseTokenFromUrl(page.url()) || resolvedToken;

  const deadline = Date.now() + 180_000;
  while (!resolvedToken && Date.now() < deadline) {
    await page.waitForTimeout(500);
    resolvedToken = parseTokenFromUrl(page.url()) || resolvedToken;
  }

  const finalUrl = page.url();
  await context.close();

  if (!resolvedToken) {
    const parsed = new URL(finalUrl);
    const params = new URLSearchParams(parsed.search);
    for (const [key, value] of new URLSearchParams(parsed.hash.replace(/^#/, ""))) params.set(key, value);
    const oauthError = params.get("error_description") || params.get("error_reason") || params.get("error");
    throw new Error(oauthError
      ? `vk-token-refresh: VK OAuth failed: ${oauthError}`
      : "vk-token-refresh: token was not received. Log in to VK, allow access, and verify VK_OAUTH_REDIRECT_URI in the app settings.");
  }

  await fs.writeFile(tokenPath, JSON.stringify(resolvedToken, null, 2), "utf8");
  await updateEnvFile(resolvedToken);
  console.log(JSON.stringify({
    ok: true,
    tokenFile: tokenPath,
    envFile: envPath,
    expiresAt: resolvedToken.expiresAt,
    userId: resolvedToken.userId
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
