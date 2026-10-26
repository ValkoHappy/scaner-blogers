import { resolve } from "node:path";
import { runInstagramCollector } from "../apps/worker/src/instagram-collector";
import { runVkCollector } from "../apps/worker/src/vk-collector";
import { runYouTubeCollector } from "../apps/worker/src/youtube-collector";
import { loadDotEnv, loadVkTokenCache } from "./social-smoke-env";
import { diagnoseSmokeFailure, sanitizeSecretText, sanitizeSmokeData } from "./social-smoke-output";
import { buildSmokePreflight, planSmokeExecution, selectSmokePlatforms, type SmokePlatform, type SmokePreflight } from "./social-smoke-plan";

loadDotEnv(".env.local", process.env, { override: true });
loadDotEnv(".env");
loadVkTokenCacheForSmoke();

const requestedPlatform = (process.env.SOCIAL_SMOKE_PLATFORM ?? "all").toLowerCase();
const dryRun = process.env.SOCIAL_SMOKE_DRY_RUN === "true";
const timeoutMs = Number(process.env.SOCIAL_SMOKE_TIMEOUT_MS || 120_000);
const strictPreflight = process.env.SOCIAL_SMOKE_STRICT_PREFLIGHT === "true";
const platforms = selectSmokePlatforms(requestedPlatform);

if (!platforms.length) {
  console.log(JSON.stringify({
    status: "error",
    message: "SOCIAL_SMOKE_PLATFORM must be one of: all, instagram, vk, youtube"
  }, null, 2));
  process.exitCode = 1;
} else if (dryRun) {
  const preflight = buildSmokePreflight(platforms, process.env);
  console.log(JSON.stringify({
    status: "dry_run",
    platforms,
    preflight,
    checks: platforms.map((platform) => ({ platform, mode: "loginCheck", timeoutMs }))
  }, null, 2));
} else {
  const results = [];
  const preflight = buildSmokePreflight(platforms, process.env);
  const executionPlan = planSmokeExecution(platforms, preflight, strictPreflight);
  for (const step of executionPlan) {
    if (step.action === "fail") {
      results.push({
        platform: step.platform,
        status: "failed",
        preflight: step.preflight,
        message: step.message
      });
      continue;
    }
    results.push(await runPlatformSmoke(step.platform, step.preflight));
  }

  const hasFailures = results.some((result) => result.status === "failed");
  console.log(JSON.stringify({ status: hasFailures ? "failed" : "ok", preflight, results }, null, 2));
  if (hasFailures) process.exitCode = 1;
}

async function runPlatformSmoke(platform: SmokePlatform, preflight?: SmokePreflight) {
  try {
    const result = platform === "instagram"
      ? await runInstagramCollector({ loginCheck: true, timeoutMs })
      : platform === "vk"
      ? await runVkCollector({ loginCheck: true, timeoutMs })
      : await runYouTubeCollector({ loginCheck: true, timeoutMs });

    return {
      platform,
      status: "ok",
      preflight,
      events: result.events.map((row) => ({
        level: row.event.level,
        code: row.event.code,
        message: row.event.message,
        data: sanitizeSmokeData(row.event.data)
      }))
    };
  } catch (error) {
    const message = sanitizeSecretText(error instanceof Error ? error.message : String(error));
    return {
      platform,
      status: "failed",
      preflight,
      message,
      diagnosis: diagnoseSmokeFailure(platform, message)
    };
  }
}

function loadVkTokenCacheForSmoke() {
  loadVkTokenCache(process.env.VK_TOKEN_FILE || resolve(process.cwd(), ".vk", "token.json"));
}
