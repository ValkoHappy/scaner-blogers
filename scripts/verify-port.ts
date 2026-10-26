import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import vm from "node:vm";
import { chromium } from "@playwright/test";

type Check = [name: string, ok: boolean, details?: string];
type VerifyXlsxWorkbook = { SheetNames: string[]; Sheets: Record<string, unknown> };
type VerifyXlsxRuntime = {
  read(input: Buffer, options: { type: "buffer" }): VerifyXlsxWorkbook;
  utils: {
    sheet_to_json(sheet: unknown, options: { header: 1; raw?: boolean }): unknown[][];
  };
};

const DEFAULT_BASE_URL = "http://127.0.0.1:3200";
const REQUIRED_PAGES = ["/keywords", "/candidates", "/health", "/scans", "/export", "/settings"];

loadDotEnv(".env.local");
loadDotEnv(".env");

const baseUrl = (process.env.WEB_VERIFY_URL ?? DEFAULT_BASE_URL).replace(/\/$/, "");
const adminEmail = process.env.ADMIN_EMAIL;
const adminPassword = process.env.ADMIN_PASSWORD;
let cachedXlsx: VerifyXlsxRuntime | undefined;
const cjsRequire = createRequire(import.meta.url);

if (!adminEmail || !adminPassword) {
  throw new Error("ADMIN_EMAIL and ADMIN_PASSWORD are required for verify:port.");
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const consoleErrors: string[] = [];
const failedRequests: string[] = [];
const checks: Check[] = [];

page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text().slice(0, 300));
});
page.on("requestfailed", (request) => {
  const url = request.url();
  const errorText = request.failure()?.errorText ?? "";
  if (url.includes("_rsc=") && errorText.includes("ERR_ABORTED")) return;
  if (url === `${baseUrl}/login` && errorText.includes("ERR_ABORTED")) return;
  if (url.startsWith(`${baseUrl}/candidates`) && errorText.includes("ERR_ABORTED")) return;
  failedRequests.push(`${url} ${errorText}`.trim());
});

try {
  const seededCollectionJobId = await seedLegacyDirtyCollectionEvent();
  const seededScanJobId = await seedLegacyDirtyScanEvent();
  const seededRawSnapshotId = await seedLegacyDirtyRawSnapshot();
  const seededCancelableWork = await seedCancelableWork();
  const seededRetryWork = await seedRetryWork();
  const seededDedupeWork = await seedDedupeWork();
  await seedDirtySocialAccountStatus();
  await seedSpreadsheetFormulaCandidate();
  await seedSpreadsheetFormulaCreative();

  await gotoPath("/login");
  await page.locator('input[name="email"]').fill(adminEmail);
  await page.locator('input[name="password"]').fill(adminPassword);
  await Promise.all([
    page.waitForURL(`${baseUrl}/`, { timeout: 30_000 }),
    page.locator('form.login-card button[type="submit"]').click()
  ]);
  checks.push(["login redirects to dashboard", page.url() === `${baseUrl}/`, page.url()]);

  for (const path of REQUIRED_PAGES) {
    const response = await gotoPath(path);
    const hasHeading = await hasVisibleLocator("h1,.page-title");
    checks.push([`${path} loads`, Boolean(response?.ok() && hasHeading), `status=${response?.status() ?? "none"}`]);
    const readability = await readableMainText();
    checks.push([`${path} UI text is readable`, readability.ok, readability.details]);
    if (path === "/settings") {
      const settingsCopy = await page.locator("main").innerText({ timeout: 10_000 }).catch(() => "");
      checks.push([
        "/settings redacts social account diagnostics",
        (!settingsCopy.includes("verify-port-status-redaction")
          || (
            settingsCopy.includes("Authorization: ***")
            && settingsCopy.includes("sessionid=***")
            && settingsCopy.includes("http://[redacted]@1.2.3.4:8080")
          ))
          && !settingsCopy.includes("abcdefghijklmnopqrstuvwxyz0123456789")
          && !settingsCopy.includes("ig-session-secret")
          && !settingsCopy.includes("user:pass"),
        `length=${settingsCopy.length}`
      ]);
    }
    if (path === "/export") {
      const exportCopy = await page.locator("main").innerText({ timeout: 10_000 }).catch(() => "");
      checks.push([
        "/export is candidate-focused",
        await isVisible('a[href^="/api/export/candidates.csv"]')
          && await isVisible('a[href^="/api/export/candidates.xlsx"]')
          && !(await isVisible('a[href^="/api/export/creatives.csv"]'))
          && exportCopy.includes("Instagram")
          && exportCopy.includes("VK")
          && exportCopy.includes("YouTube"),
        `length=${exportCopy.length}`
      ]);
    }
    if (path === "/keywords") {
      const keywordLayout = await page.evaluate(() => {
        const doc = document.documentElement;
        return {
          hasProTable: Boolean(document.querySelector(".keywords-pro-table")),
          hasOldTable: Boolean(document.querySelector(".keywords-table")),
          hasBulkForm: Boolean(document.querySelector("form#keywords-bulk-form")),
          hasDocOverflow: doc.scrollWidth > doc.clientWidth + 2
        };
      });
      checks.push([
        "/keywords uses current keyword table without document overflow",
        keywordLayout.hasProTable && keywordLayout.hasBulkForm && !keywordLayout.hasOldTable && !keywordLayout.hasDocOverflow,
        JSON.stringify(keywordLayout)
      ]);
    }
  }

  await gotoPath("/candidates");
  checks.push(["candidate platform filter visible", await isVisible('select[name="platform"]')]);
  checks.push(["candidate bulk form visible", await isVisible('form#candidate-bulk-status-form')]);
  checks.push(["candidate exported filter visible", await isVisible('select[name="exported"]')]);
  checks.push(["candidate exported action visible", await isVisible('button[name="intent"][value="mark_exported"]')]);

  await gotoPath("/scans");
  const cancelAllButtonVisible = await isVisible('form#cancel-all-active-work-form button[type="submit"]');
  checks.push(["cancel all active work action visible", cancelAllButtonVisible]);
  if (cancelAllButtonVisible) {
    await page.locator('form#cancel-all-active-work-form button[type="submit"]').click();
    await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => undefined);
  }
  const cancelAllState = await readCancelableWorkState(seededCancelableWork);
  await gotoPath("/scans");
  const cancelAllStatusPills = await page.locator(".scan-status-pill").allInnerTexts().catch(() => []);
  checks.push([
    "cancel all active work action persists ads and social stops",
    cancelAllState.scanQueued?.status === "CANCELED"
      && cancelAllState.scanQueued?.cancelRequested === true
      && Boolean(cancelAllState.scanQueued?.finishedAt)
      && cancelAllState.scanRunning?.status === "RUNNING"
      && cancelAllState.scanRunning?.cancelRequested === true
      && cancelAllState.collectionQueued?.status === "CANCELED"
      && cancelAllState.collectionQueued?.cancelRequested === true
      && Boolean(cancelAllState.collectionQueued?.finishedAt)
      && cancelAllState.collectionRunning?.status === "RUNNING"
      && cancelAllState.collectionRunning?.cancelRequested === true
      && cancelAllState.scanCancelEvents === 2
      && cancelAllState.collectionCancelEvents === 2,
    JSON.stringify(cancelAllState)
  ]);
  checks.push([
    "scans summary shows social stopping count without ads label",
    cancelAllStatusPills.some((text) => text.includes("1") && text.includes("Останавливается"))
      && !cancelAllStatusPills.some((text) => /ADS\s+STOPPING/.test(text)),
    JSON.stringify(cancelAllStatusPills)
  ]);
  const cancelEventApis = await page.evaluate(async (ids) => {
    const [scanResponse, collectionResponse] = await Promise.all([
      fetch(`/api/scans/${ids.scanRunningId}/events`),
      fetch(`/api/collections/${ids.collectionRunningId}/events`)
    ]);
    const [scanText, collectionText] = await Promise.all([scanResponse.text(), collectionResponse.text()]);
    let scanBody: unknown;
    let collectionBody: unknown;
    try {
      scanBody = JSON.parse(scanText);
    } catch {
      scanBody = { parseError: true, text: scanText.slice(0, 300) };
    }
    try {
      collectionBody = JSON.parse(collectionText);
    } catch {
      collectionBody = { parseError: true, text: collectionText.slice(0, 300) };
    }
    return {
      scanStatus: scanResponse.status,
      collectionStatus: collectionResponse.status,
      scanOk: scanResponse.ok,
      collectionOk: collectionResponse.ok,
      scanBody,
      collectionBody
    };
  }, seededCancelableWork);
  const scanEventsJson = JSON.stringify(cancelEventApis.scanBody);
  const collectionEventsJson = JSON.stringify(cancelEventApis.collectionBody);
  checks.push([
    "cancel events are exposed through scan and social event APIs",
    cancelEventApis.scanOk
      && cancelEventApis.collectionOk
      && scanEventsJson.includes("scan-cancel-all-requested")
      && scanEventsJson.includes("scan_cancel_all_requested")
      && collectionEventsJson.includes("collection-cancel-all-requested")
      && collectionEventsJson.includes("collection_cancel_all_requested"),
    `scan=${cancelEventApis.scanStatus}; collection=${cancelEventApis.collectionStatus}; scanLength=${scanEventsJson.length}; collectionLength=${collectionEventsJson.length}`
  ]);
  const retryEventApis = await page.evaluate(async (ids) => {
    const [scanResponse, collectionResponse] = await Promise.all([
      fetch(`/api/scans/${ids.scanOriginalId}/events`),
      fetch(`/api/collections/${ids.collectionOriginalId}/events`)
    ]);
    const [scanText, collectionText] = await Promise.all([scanResponse.text(), collectionResponse.text()]);
    let scanBody: unknown;
    let collectionBody: unknown;
    try {
      scanBody = JSON.parse(scanText);
    } catch {
      scanBody = { parseError: true, text: scanText.slice(0, 300) };
    }
    try {
      collectionBody = JSON.parse(collectionText);
    } catch {
      collectionBody = { parseError: true, text: collectionText.slice(0, 300) };
    }
    return {
      scanStatus: scanResponse.status,
      collectionStatus: collectionResponse.status,
      scanOk: scanResponse.ok,
      collectionOk: collectionResponse.ok,
      scanBody,
      collectionBody
    };
  }, seededRetryWork);
  const retryScanEventsJson = JSON.stringify(retryEventApis.scanBody);
  const retryCollectionEventsJson = JSON.stringify(retryEventApis.collectionBody);
  checks.push([
    "retry events are exposed through scan and social event APIs",
    retryEventApis.scanOk
      && retryEventApis.collectionOk
      && retryScanEventsJson.includes("scan-retry-requested")
      && retryScanEventsJson.includes("scan_retry_requested")
      && retryScanEventsJson.includes(seededRetryWork.scanRetryId)
      && retryCollectionEventsJson.includes("collection-retry-requested")
      && retryCollectionEventsJson.includes("collection_retry_requested")
      && retryCollectionEventsJson.includes(seededRetryWork.collectionRetryId),
    `scan=${retryEventApis.scanStatus}; collection=${retryEventApis.collectionStatus}; scanLength=${retryScanEventsJson.length}; collectionLength=${retryCollectionEventsJson.length}`
  ]);
  const dedupeEventApis = await page.evaluate(async (ids) => {
    const [scanResponse, collectionResponse] = await Promise.all([
      fetch(`/api/scans/${ids.scanJobId}/events`),
      fetch(`/api/collections/${ids.collectionJobId}/events`)
    ]);
    const [scanText, collectionText] = await Promise.all([scanResponse.text(), collectionResponse.text()]);
    let scanBody: unknown;
    let collectionBody: unknown;
    try {
      scanBody = JSON.parse(scanText);
    } catch {
      scanBody = { parseError: true, text: scanText.slice(0, 300) };
    }
    try {
      collectionBody = JSON.parse(collectionText);
    } catch {
      collectionBody = { parseError: true, text: collectionText.slice(0, 300) };
    }
    return {
      scanStatus: scanResponse.status,
      collectionStatus: collectionResponse.status,
      scanOk: scanResponse.ok,
      collectionOk: collectionResponse.ok,
      scanBody,
      collectionBody
    };
  }, seededDedupeWork);
  const dedupeScanEventsJson = JSON.stringify(dedupeEventApis.scanBody);
  const dedupeCollectionEventsJson = JSON.stringify(dedupeEventApis.collectionBody);
  checks.push([
    "dedupe events are exposed through scan and social event APIs",
    dedupeEventApis.scanOk
      && dedupeEventApis.collectionOk
      && dedupeScanEventsJson.includes("scan-queue-deduped")
      && dedupeScanEventsJson.includes("scan_queue_deduped")
      && dedupeCollectionEventsJson.includes("collection-queue-deduped")
      && dedupeCollectionEventsJson.includes("collection_queue_deduped"),
    `scan=${dedupeEventApis.scanStatus}; collection=${dedupeEventApis.collectionStatus}; scanLength=${dedupeScanEventsJson.length}; collectionLength=${dedupeCollectionEventsJson.length}`
  ]);

  await gotoPath("/candidates?q=verify-port-formula");
  const formulaCheckbox = page.locator('input.candidate-select-checkbox[value]').first();
  const hasFormulaCandidate = await formulaCheckbox.count().then((count) => count > 0).catch(() => false);
  checks.push(["candidate fixture visible for bulk actions", hasFormulaCandidate]);
  if (hasFormulaCandidate) {
    await formulaCheckbox.check();
    await page.locator('form#candidate-bulk-status-form select[name="status"]').selectOption("PRIORITY");
    await page.locator('form#candidate-bulk-status-form button[type="submit"]').first().click();
    await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => undefined);
    const priorityCsv = await page.evaluate(async () => {
      const response = await fetch("/api/export/candidates.csv?q=verify-port-formula&status=PRIORITY");
      const text = await response.text();
      return { status: response.status, ok: response.ok, text };
    });
    checks.push([
      "candidate bulk status action persists to export",
      priorityCsv.ok && priorityCsv.text.includes("verify-port-formula") && priorityCsv.text.includes("\",\"PRIORITY\","),
      `status=${priorityCsv.status}; length=${priorityCsv.text.length}`
    ]);

    await gotoPath("/candidates?q=verify-port-formula");
    await page.locator('input.candidate-select-checkbox[value]').first().check();
    await page.locator('form#candidate-bulk-status-form button[name="intent"][value="mark_exported"]').click();
    await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => undefined);
    const exportedCsv = await page.evaluate(async () => {
      const [yesResponse, noResponse] = await Promise.all([
        fetch("/api/export/candidates.csv?q=verify-port-formula&exported=YES"),
        fetch("/api/export/candidates.csv?q=verify-port-formula&exported=NO")
      ]);
      const [yesText, noText] = await Promise.all([yesResponse.text(), noResponse.text()]);
      return {
        yesStatus: yesResponse.status,
        noStatus: noResponse.status,
        ok: yesResponse.ok && noResponse.ok,
        yesText,
        noText
      };
    });
    checks.push([
      "candidate mark exported action persists to export filter",
      exportedCsv.ok
        && exportedCsv.yesText.includes("verify-port-formula")
        && !exportedCsv.noText.includes("verify-port-formula"),
      `yes=${exportedCsv.yesStatus}; no=${exportedCsv.noStatus}; yesLength=${exportedCsv.yesText.length}; noLength=${exportedCsv.noText.length}`
    ]);
  }

  const csv = await page.evaluate(async () => {
    const response = await fetch("/api/export/candidates.csv?exported=NO");
    const text = await response.text();
    return {
      status: response.status,
      ok: response.ok,
      hasExportedHeader: text.includes("exported_at"),
      length: text.length
    };
  });
  checks.push([
    "candidate CSV export respects exported filter",
    csv.ok && csv.hasExportedHeader && csv.length > 20,
    `status=${csv.status}; length=${csv.length}`
  ]);

  const formulaCsv = await page.evaluate(async () => {
    const response = await fetch("/api/export/candidates.csv?q=verify-port-formula");
    const text = await response.text();
    return {
      status: response.status,
      ok: response.ok,
      text
    };
  });
  checks.push([
    "candidate CSV export escapes spreadsheet formulas",
    formulaCsv.ok
      && formulaCsv.text.includes("\"'=HYPERLINK")
      && formulaCsv.text.includes("\"'+SUM(1,1)\"")
      && formulaCsv.text.includes("\"'@verify-port-formula")
      && !formulaCsv.text.includes("\",\"=HYPERLINK")
      && !formulaCsv.text.includes("\",\"+SUM(1,1)\"")
      && !formulaCsv.text.includes("\",\"@verify-port-formula"),
    `status=${formulaCsv.status}; length=${formulaCsv.text.length}`
  ]);

  const formulaCreativeCsv = await page.evaluate(async () => {
    const response = await fetch("/api/export/creatives.csv?fields=creativeId&fields=advertiserName&fields=appName&creativeIds=verify-port-formula-creative");
    const text = await response.text();
    return {
      status: response.status,
      ok: response.ok,
      text
    };
  });
  checks.push([
    "creative CSV export escapes spreadsheet formulas",
    formulaCreativeCsv.ok
      && formulaCreativeCsv.text.includes("verify-port-formula-creative")
      && formulaCreativeCsv.text.includes("\"'+SUM(1,1)\"")
      && formulaCreativeCsv.text.includes("\"'=HYPERLINK")
      && !formulaCreativeCsv.text.includes("\",\"+SUM(1,1)\"")
      && !formulaCreativeCsv.text.includes("\",\"=HYPERLINK"),
    `status=${formulaCreativeCsv.status}; length=${formulaCreativeCsv.text.length}`
  ]);

  const xlsx = await page.evaluate(async () => {
    const response = await fetch("/api/export/candidates.xlsx?exported=NO");
    const contentType = response.headers.get("content-type") ?? "";
    const buffer = await response.arrayBuffer();
    const magic = String.fromCharCode(...new Uint8Array(buffer.slice(0, 2)));
    return {
      status: response.status,
      ok: response.ok,
      contentType,
      length: buffer.byteLength,
      magic
    };
  });
  checks.push([
    "candidate XLSX export respects exported filter",
    xlsx.ok && xlsx.magic === "PK" && xlsx.length > 1000,
    `status=${xlsx.status}; length=${xlsx.length}; type=${xlsx.contentType || "none"}`
  ]);

  const formulaXlsx = await fetchXlsxRows("/api/export/candidates.xlsx?q=verify-port-formula");
  checks.push([
    "candidate XLSX export escapes spreadsheet formulas",
    formulaXlsx.ok
      && cellsInclude(formulaXlsx.rows, "'=HYPERLINK(\"https://evil.test\")")
      && cellsInclude(formulaXlsx.rows, "'+SUM(1,1)")
      && cellsInclude(formulaXlsx.rows, "'@verify-port-formula")
      && cellsInclude(formulaXlsx.rows, "'-formula reason")
      && !cellsInclude(formulaXlsx.rows, "=HYPERLINK(\"https://evil.test\")")
      && !cellsInclude(formulaXlsx.rows, "+SUM(1,1)")
      && !cellsInclude(formulaXlsx.rows, "@verify-port-formula")
      && !cellsInclude(formulaXlsx.rows, "-formula reason"),
    `status=${formulaXlsx.status}; rows=${formulaXlsx.rows.length}; length=${formulaXlsx.length}`
  ]);

  const formulaCreativeXlsx = await fetchXlsxRows("/api/export/creatives.xlsx?fields=creativeId&fields=advertiserName&fields=appName&creativeIds=verify-port-formula-creative");
  checks.push([
    "creative XLSX export escapes spreadsheet formulas",
    formulaCreativeXlsx.ok
      && cellsInclude(formulaCreativeXlsx.rows, "verify-port-formula-creative")
      && cellsInclude(formulaCreativeXlsx.rows, "'+SUM(1,1)")
      && cellsInclude(formulaCreativeXlsx.rows, "'=HYPERLINK(\"https://evil.test\")")
      && !cellsInclude(formulaCreativeXlsx.rows, "+SUM(1,1)")
      && !cellsInclude(formulaCreativeXlsx.rows, "=HYPERLINK(\"https://evil.test\")"),
    `status=${formulaCreativeXlsx.status}; rows=${formulaCreativeXlsx.rows.length}; length=${formulaCreativeXlsx.length}`
  ]);

  const hasHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
  checks.push(["candidates page has no document horizontal overflow", !hasHorizontalOverflow]);

  await gotoPath("/scans");
  const scansCopy = await page.locator("main").innerText({ timeout: 10_000 }).catch(() => "");
  checks.push(["scans page uses platform-neutral social heading", scansCopy.includes("Сборы блогеров")]);
  checks.push(["scans page mentions all social platforms", ["Instagram", "VK", "YouTube"].every((platform) => scansCopy.includes(platform))]);
  checks.push(["scans page is not Instagram-only", !scansCopy.includes("Instagram сборы") && !scansCopy.includes("Instagram сборов пока нет") && !scansCopy.includes("Social сборы")]);

  const systemStatus = await page.evaluate(async () => {
    const response = await fetch("/api/system/status");
    const text = await response.text();
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      body = { parseError: true, text: text.slice(0, 300) };
    }
    return {
      status: response.status,
      ok: response.ok,
      body
    };
  });
  const systemStatusBody = isRecord(systemStatus.body) ? systemStatus.body : {};
  const socialStatus = isRecord(systemStatusBody.social) ? systemStatusBody.social : {};
  const credentials = socialStatus.credentials;
  const accounts = socialStatus.accounts;
  const integrity = isRecord(socialStatus.integrity) ? socialStatus.integrity : undefined;
  const credentialPlatforms = Array.isArray(credentials)
    ? credentials.map((item: { platform?: string }) => item.platform).sort().join(",")
    : "";
  const serializedCredentials = JSON.stringify(credentials ?? {});
  checks.push([
    "system status exposes safe social credential readiness",
    systemStatus.ok
      && credentialPlatforms === "INSTAGRAM,VK,YOUTUBE"
      && !serializedCredentials.includes(adminPassword)
      && !serializedCredentials.includes(process.env.VK_ACCESS_TOKEN ?? "__missing__")
      && !serializedCredentials.includes(process.env.YOUTUBE_API_KEY ?? "__missing__"),
    `status=${systemStatus.status}; platforms=${credentialPlatforms || "none"}`
  ]);
  const serializedAccounts = JSON.stringify(accounts ?? {});
  const hasDirtyStatusFixture = serializedAccounts.includes("verify-port-status-redaction");
  checks.push([
    "system status exposes redacted social account diagnostics",
    systemStatus.ok
      && Array.isArray(accounts)
      && hasDirtyStatusFixture
      && serializedAccounts.includes("Authorization: ***")
      && serializedAccounts.includes("sessionid=***")
      && serializedAccounts.includes("http://[redacted]@1.2.3.4:8080")
      && !serializedAccounts.includes(process.env.INSTAGRAM_USERNAME ?? "__missing__")
      && !serializedAccounts.includes(process.env.INSTAGRAM_PASSWORD ?? "__missing__")
      && !serializedAccounts.includes(process.env.INSTAGRAM_PROXY_URL ?? "__missing__")
      && !serializedAccounts.includes(process.env.VK_ACCESS_TOKEN ?? "__missing__")
      && !serializedAccounts.includes(process.env.VK_SERVICE_TOKEN ?? "__missing__")
      && !serializedAccounts.includes(process.env.VK_SERVER_TOKEN ?? "__missing__")
      && !serializedAccounts.includes(process.env.YOUTUBE_API_KEY ?? "__missing__")
      && !serializedAccounts.includes("abcdefghijklmnopqrstuvwxyz0123456789")
      && !serializedAccounts.includes("ig-session-secret")
      && !serializedAccounts.includes("user:pass"),
    `status=${systemStatus.status}; accounts=${Array.isArray(accounts) ? accounts.length : "none"}`
  ]);
  checks.push([
    "system status exposes social collection integrity",
    systemStatus.ok
      && typeof integrity?.checkedJobs === "number"
      && typeof integrity?.errors === "number"
      && typeof integrity?.warnings === "number"
      && Array.isArray(integrity?.issues),
    `status=${systemStatus.status}; checked=${integrity?.checkedJobs ?? "none"}; errors=${integrity?.errors ?? "none"}; warnings=${integrity?.warnings ?? "none"}`
  ]);

  const collectionEvents = await page.evaluate(async (jobId) => {
    const response = await fetch(`/api/collections/${jobId}/events`);
    const text = await response.text();
    return {
      status: response.status,
      ok: response.ok,
      text
    };
  }, seededCollectionJobId);
  checks.push([
    "collection event API redacts legacy dirty diagnostics",
    collectionEvents.ok
      && collectionEvents.text.includes("verify-port-redaction-event")
      && collectionEvents.text.includes("access_token=***")
      && collectionEvents.text.includes("Authorization: ***")
      && collectionEvents.text.includes("sessionid=***")
      && collectionEvents.text.includes("socks5://[redacted]@1.2.3.4:9000")
      && !collectionEvents.text.includes("abcdefghijklmnopqrstuvwxyz0123456789")
      && !collectionEvents.text.includes("ig-session-secret")
      && !collectionEvents.text.includes("user:pass"),
    `status=${collectionEvents.status}; length=${collectionEvents.text.length}`
  ]);

  const scanEvents = await page.evaluate(async (jobId) => {
    const response = await fetch(`/api/scans/${jobId}/events`);
    const text = await response.text();
    return {
      status: response.status,
      ok: response.ok,
      text
    };
  }, seededScanJobId);
  checks.push([
    "scan event API redacts legacy dirty diagnostics",
    scanEvents.ok
      && scanEvents.text.includes("verify-port-scan-redaction-event")
      && scanEvents.text.includes("access_token=***")
      && scanEvents.text.includes("http://[redacted]@1.2.3.4:8080")
      && !scanEvents.text.includes("abcdefghijklmnopqrstuvwxyz0123456789")
      && !scanEvents.text.includes("user:pass"),
    `status=${scanEvents.status}; length=${scanEvents.text.length}`
  ]);

  const rawExport = await page.evaluate(async (snapshotId) => {
    const response = await fetch("/api/export/raw.json?limit=5000");
    const text = await response.text();
    return {
      status: response.status,
      ok: response.ok,
      text,
      hasSnapshot: text.includes(snapshotId)
    };
  }, seededRawSnapshotId);
  checks.push([
    "raw export API redacts legacy dirty snapshots",
    rawExport.ok
      && rawExport.hasSnapshot
      && rawExport.text.includes("verify-port-raw-redaction-snapshot")
      && rawExport.text.includes("access_token=***")
      && rawExport.text.includes("http://[redacted]@1.2.3.4:8080")
      && !rawExport.text.includes("abcdefghijklmnopqrstuvwxyz0123456789")
      && !rawExport.text.includes("user:pass"),
    `status=${rawExport.status}; length=${rawExport.text.length}`
  ]);

  await gotoPath("/health");
  await page.locator(".health-screen .health-summary-panel").waitFor({ state: "visible", timeout: 15_000 }).catch(() => undefined);
  const healthStructure = await page.evaluate(() => ({
    hasScreen: Boolean(document.querySelector(".health-screen")),
    hasSummary: Boolean(document.querySelector(".health-summary-panel")),
    rows: document.querySelectorAll(".health-screen .proxy-health-row").length
  }));
  const healthCopy = await page.locator("main").innerText({ timeout: 10_000 }).catch(() => "");
  checks.push([
    "health page shows collection integrity panel",
    healthStructure.hasScreen && healthStructure.hasSummary && healthStructure.rows > 0,
    JSON.stringify(healthStructure)
  ]);
  checks.push([
    "health page has no visible legacy ads diagnostics",
    !healthCopy.includes("Ads очередь")
      && !healthCopy.includes("Последний ads scan")
      && !healthCopy.includes("Raw ads snapshots")
      && !healthCopy.includes("Creatives без"),
    `length=${healthCopy.length}`
  ]);
  checks.push([
    "/health redacts social account diagnostics",
    healthCopy.includes("verify-port-status-redaction")
      && healthCopy.includes("Authorization: ***")
      && healthCopy.includes("sessionid=***")
      && healthCopy.includes("http://[redacted]@1.2.3.4:8080")
      && !healthCopy.includes("abcdefghijklmnopqrstuvwxyz0123456789")
      && !healthCopy.includes("ig-session-secret")
      && !healthCopy.includes("user:pass"),
    `length=${healthCopy.length}`
  ]);

  await gotoPath("/scans");
  const logButton = page.getByRole("button", { name: "Логи" }).first();
  const hasLogButton = await logButton.isVisible({ timeout: 3000 }).catch(() => false);
  if (hasLogButton) {
    await logButton.click();
    checks.push(["scan log dialog opens", await isVisible('[role="dialog"]')]);
    checks.push(["scan log diagnostics visible", await isVisible('[aria-label="Диагностика журнала"]')]);
    checks.push(["scan log console visible", await isVisible(".console-log")]);
    const dialogCopy = await page.locator('[role="dialog"]').innerText({ timeout: 10_000 }).catch(() => "");
    checks.push([
      "scan log uses localized social diagnostics",
      dialogCopy.includes("изменено") && !dialogCopy.includes("known skip") && !dialogCopy.includes("affected "),
      `length=${dialogCopy.length}`
    ]);
    await page.getByRole("button", { name: "Закрыть" }).click().catch(() => undefined);
  } else {
    checks.push(["scan log diagnostics visible", true, "skipped=no scan log button"]);
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await gotoPath("/candidates");
  checks.push(["mobile candidates page has no document horizontal overflow", await hasNoDocumentHorizontalOverflow()]);

  await gotoPath("/scans");
  checks.push(["mobile scans page has no document horizontal overflow", await hasNoDocumentHorizontalOverflow()]);
  const mobileLogButton = page.getByRole("button", { name: "Логи" }).first();
  const hasMobileLogButton = await mobileLogButton.isVisible({ timeout: 3000 }).catch(() => false);
  if (hasMobileLogButton) {
    await mobileLogButton.click();
    checks.push(["mobile scan log dialog fits viewport", await dialogFitsViewport()]);
    checks.push(["mobile scan log diagnostics visible", await isVisible('[aria-label="Диагностика журнала"]')]);
    await page.getByRole("button", { name: "Закрыть" }).click().catch(() => undefined);
  } else {
    checks.push(["mobile scan log dialog fits viewport", true, "skipped=no scan log button"]);
  }

  checks.push(["browser console has no errors", consoleErrors.length === 0, consoleErrors.join(" | ")]);
  checks.push(["no failed browser requests", failedRequests.length === 0, failedRequests.join(" | ")]);
} finally {
  await browser.close();
  const cleanup = await cleanupLegacyDirtyFixtures();
  checks.push([
    "verify-port redaction fixture cleaned up",
    cleanup.remaining === 0,
    `deleted=${cleanup.deleted}; remaining=${cleanup.remaining}`
  ]);
}

const failed = checks.filter(([, ok]) => !ok);

for (const [name, ok, details] of checks) {
  const suffix = details ? ` (${details})` : "";
  console.log(`${ok ? "ok" : "fail"} - ${name}${suffix}`);
}

if (failed.length) {
  process.exitCode = 1;
}

async function isVisible(selector: string) {
  return page.locator(selector).isVisible({ timeout: 10_000 }).catch(() => false);
}

async function hasNoDocumentHorizontalOverflow() {
  return page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 2);
}

async function gotoPath(path: string) {
  const target = `${baseUrl}${path}`;
  try {
    return await page.goto(target, { waitUntil: "domcontentloaded", timeout: 30_000 });
  } catch {
    await page.waitForTimeout(1_000).catch(() => undefined);
    return page.goto(target, { waitUntil: "domcontentloaded", timeout: 45_000 });
  }
}

async function dialogFitsViewport() {
  return page.locator('[role="dialog"]').evaluate((dialog) => {
    const box = (dialog as HTMLElement).getBoundingClientRect();
    return box.left >= -1
      && box.top >= -1
      && box.right <= window.innerWidth + 1
      && box.bottom <= window.innerHeight + 1;
  }).catch(() => false);
}

async function hasVisibleLocator(selector: string) {
  return page.waitForFunction((targetSelector) => {
    return [...document.querySelectorAll(targetSelector)].some((item) => {
      const element = item as HTMLElement;
      const style = window.getComputedStyle(element);
      const box = element.getBoundingClientRect();
      return style.visibility !== "hidden" && style.display !== "none" && box.width > 0 && box.height > 0;
    });
  }, selector, { timeout: 15_000 }).then(() => true).catch(() => false);
}

async function readableMainText() {
  const text = await page.locator("main").innerText({ timeout: 10_000 }).catch(() => "");
  const marker = mojibakeMarkers().find((item) => text.includes(item));
  return {
    ok: Boolean(text) && !marker,
    details: marker ? `marker=${marker}` : `length=${text.length}`
  };
}

function mojibakeMarkers() {
  return [
    "Рђ", "Р‘", "Р’", "Р“", "Р”", "Р•", "Р–", "Р—", "Р", "Р™", "Рљ", "Р›", "Рњ", "Рќ", "Рћ", "Рџ",
    "Р ", "РЎ", "Рў", "РЈ", "Р¤", "РҐ", "Р¦", "Р§", "РЁ", "Р©", "Р­", "Р®", "РЇ",
    "Р°", "Р±", "РІ", "Рі", "Рґ", "Рµ", "Р¶", "Р·", "Рё", "Р№", "Рє", "Р»", "Рј", "РЅ", "Рѕ", "Рї",
    "СЂ", "СЃ", "С‚", "Сѓ", "С„", "С…", "С†", "С‡", "С€", "С‰", "СЊ", "С‹", "СЌ", "СЋ", "СЏ",
    "В«", "В»", "в„–"
  ];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function loadDotEnv(path: string) {
  if (!existsSync(path)) return;
  const content = readFileSync(path, "utf8");
  for (const line of content.split(/\r\n|\n|\r/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator < 1) continue;
    const key = trimmed.slice(0, separator);
    let value = trimmed.slice(separator + 1);
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] ??= value;
  }
}

async function fetchXlsxRows(path: string) {
  const response = await page.evaluate(async (targetPath) => {
    const fetchResponse = await fetch(targetPath);
    const buffer = await fetchResponse.arrayBuffer();
    let binary = "";
    for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte);
    return {
      status: fetchResponse.status,
      ok: fetchResponse.ok,
      base64: btoa(binary),
      length: buffer.byteLength
    };
  }, path);
  if (!response.ok) return { ...response, rows: [] as unknown[][] };
  const workbook = loadXlsx().read(Buffer.from(response.base64, "base64"), { type: "buffer" });
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = firstSheet ? loadXlsx().utils.sheet_to_json(firstSheet, { header: 1, raw: false }) : [];
  return { ...response, rows };
}

function cellsInclude(rows: unknown[][], expected: string) {
  return rows.some((row) => row.some((cell) => cell === expected));
}

function loadXlsx() {
  if (cachedXlsx) return cachedXlsx;
  const xlsxPath = [
    join(process.cwd(), "chrome-extension", "lib", "xlsx.mini.min.js"),
    join(process.cwd(), "..", "..", "chrome-extension", "lib", "xlsx.mini.min.js")
  ].find((candidate) => existsSync(candidate));
  if (!xlsxPath) throw new Error("XLSX library was not found.");
  const code = readFileSync(xlsxPath, "utf8");
  const cjsModule: { exports: unknown } = { exports: {} };
  vm.runInNewContext(code, {
    module: cjsModule,
    exports: cjsModule.exports,
    require: cjsRequire,
    Buffer,
    ArrayBuffer,
    Uint8Array,
    console
  }, { filename: xlsxPath });
  cachedXlsx = cjsModule.exports as VerifyXlsxRuntime;
  return cachedXlsx;
}

async function seedLegacyDirtyCollectionEvent() {
  const { prisma } = await import("@scaner-blogers/db");
  const keyword = await prisma.searchKeyword.upsert({
    where: { normalizedValue: "verify-port-redaction" },
    create: {
      id: "verify-port-redaction-keyword",
      value: "verify port redaction",
      normalizedValue: "verify-port-redaction",
      platforms: ["VK"],
      minFollowers: 1,
      maxFollowers: 100000
    },
    update: {}
  });
  const job = await prisma.collectionJob.upsert({
    where: { id: "verify-port-redaction-job" },
    create: {
      id: "verify-port-redaction-job",
      keywordId: keyword.id,
      platform: "VK",
      status: "FAILED",
      finishedAt: new Date(),
      errorMessage: "verify-port legacy dirty event fixture",
      minFollowers: 1,
      maxFollowers: 100000,
      candidatesFound: 0,
      profilesChecked: 0
    },
    update: {
      keywordId: keyword.id,
      platform: "VK",
      status: "FAILED",
      finishedAt: new Date(),
      errorMessage: "verify-port legacy dirty event fixture"
    }
  });
  const vkToken = `vk1.a.${"abcdefghijklmnopqrstuvwxyz0123456789"}`;
  await prisma.collectionEvent.upsert({
    where: { id: "verify-port-redaction-event" },
    create: {
      id: "verify-port-redaction-event",
      collectionJobId: job.id,
      level: "error",
      message: `verify-port-redaction-event access_token=${vkToken} Authorization: Bearer ${vkToken} sessionid=ig-session-secret via socks5://user:pass@1.2.3.4:9000`,
      data: {
        code: "verify_port_redaction_event",
        message: `token=${vkToken} Authorization: Bearer ${vkToken} sessionid=ig-session-secret`,
        proxyUrl: "socks5://user:pass@1.2.3.4:9000"
      }
    },
    update: {
      collectionJobId: job.id,
      level: "error",
      message: `verify-port-redaction-event access_token=${vkToken} Authorization: Bearer ${vkToken} sessionid=ig-session-secret via socks5://user:pass@1.2.3.4:9000`,
      data: {
        code: "verify_port_redaction_event",
        message: `token=${vkToken} Authorization: Bearer ${vkToken} sessionid=ig-session-secret`,
        proxyUrl: "socks5://user:pass@1.2.3.4:9000"
      }
    }
  });
  return job.id;
}

async function seedLegacyDirtyScanEvent() {
  const { prisma } = await import("@scaner-blogers/db");
  const advertiser = await prisma.advertiser.upsert({
    where: { googleAdvertiserId: "verify-port-scan-redaction-advertiser" },
    create: {
      id: "verify-port-scan-redaction-advertiser",
      googleAdvertiserId: "verify-port-scan-redaction-advertiser",
      name: "verify port scan redaction"
    },
    update: {
      name: "verify port scan redaction"
    }
  });
  const job = await prisma.scanJob.upsert({
    where: { id: "verify-port-scan-redaction-job" },
    create: {
      id: "verify-port-scan-redaction-job",
      advertiserId: advertiser.id,
      status: "FAILED",
      scanMode: "FULL",
      finishedAt: new Date(),
      errorMessage: "verify-port legacy dirty scan event fixture"
    },
    update: {
      advertiserId: advertiser.id,
      status: "FAILED",
      scanMode: "FULL",
      finishedAt: new Date(),
      errorMessage: "verify-port legacy dirty scan event fixture"
    }
  });
  const vkToken = `vk1.a.${"abcdefghijklmnopqrstuvwxyz0123456789"}`;
  await prisma.scanEvent.upsert({
    where: { id: "verify-port-scan-redaction-event" },
    create: {
      id: "verify-port-scan-redaction-event",
      scanJobId: job.id,
      level: "error",
      message: `verify-port-scan-redaction-event access_token=${vkToken} via http://user:pass@1.2.3.4:8080`,
      data: {
        code: "verify_port_scan_redaction_event",
        message: `token=${vkToken}`,
        proxyUrl: "http://user:pass@1.2.3.4:8080"
      }
    },
    update: {
      scanJobId: job.id,
      level: "error",
      message: `verify-port-scan-redaction-event access_token=${vkToken} via http://user:pass@1.2.3.4:8080`,
      data: {
        code: "verify_port_scan_redaction_event",
        message: `token=${vkToken}`,
        proxyUrl: "http://user:pass@1.2.3.4:8080"
      }
    }
  });
  return job.id;
}

async function seedLegacyDirtyRawSnapshot() {
  const { prisma } = await import("@scaner-blogers/db");
  const advertiser = await prisma.advertiser.upsert({
    where: { googleAdvertiserId: "verify-port-raw-redaction-advertiser" },
    create: {
      id: "verify-port-raw-redaction-advertiser",
      googleAdvertiserId: "verify-port-raw-redaction-advertiser",
      name: "verify port raw redaction"
    },
    update: {
      name: "verify port raw redaction"
    }
  });
  const creative = await prisma.creative.upsert({
    where: { creativeId: "verify-port-raw-redaction-creative" },
    create: {
      id: "verify-port-raw-redaction-creative",
      creativeId: "verify-port-raw-redaction-creative",
      advertiserId: advertiser.id,
      rawDetail: {
        marker: "verify-port-raw-redaction-creative",
        proxyUrl: "http://user:pass@1.2.3.4:8080"
      }
    },
    update: {
      advertiserId: advertiser.id,
      rawDetail: {
        marker: "verify-port-raw-redaction-creative",
        proxyUrl: "http://user:pass@1.2.3.4:8080"
      }
    }
  });
  const vkToken = `vk1.a.${"abcdefghijklmnopqrstuvwxyz0123456789"}`;
  const snapshot = await prisma.rawApiSnapshot.upsert({
    where: { id: "verify-port-raw-redaction-snapshot" },
    create: {
      id: "verify-port-raw-redaction-snapshot",
      creativeId: creative.id,
      kind: "API_EXPORT",
      payload: {
        marker: "verify-port-raw-redaction-snapshot",
        message: `access_token=${vkToken} via http://user:pass@1.2.3.4:8080`,
        proxyUrl: "http://user:pass@1.2.3.4:8080"
      }
    },
    update: {
      creativeId: creative.id,
      kind: "API_EXPORT",
      payload: {
        marker: "verify-port-raw-redaction-snapshot",
        message: `access_token=${vkToken} via http://user:pass@1.2.3.4:8080`,
        proxyUrl: "http://user:pass@1.2.3.4:8080"
      }
    }
  });
  return snapshot.id;
}

async function seedCancelableWork() {
  const { prisma } = await import("@scaner-blogers/db");
  const advertiser = await prisma.advertiser.upsert({
    where: { googleAdvertiserId: "verify-port-cancel-all-advertiser" },
    create: {
      id: "verify-port-cancel-all-advertiser",
      googleAdvertiserId: "verify-port-cancel-all-advertiser",
      name: "verify port cancel all"
    },
    update: { name: "verify port cancel all" }
  });
  const keyword = await prisma.searchKeyword.upsert({
    where: { normalizedValue: "verify-port-cancel-all" },
    create: {
      id: "verify-port-cancel-all-keyword",
      value: "verify port cancel all",
      normalizedValue: "verify-port-cancel-all",
      platforms: ["INSTAGRAM", "VK", "YOUTUBE"],
      minFollowers: 1,
      maxFollowers: 100000
    },
    update: {}
  });
  const [scanQueued, scanRunning, collectionQueued, collectionRunning] = await prisma.$transaction([
    prisma.scanJob.upsert({
      where: { id: "verify-port-cancel-all-scan-queued" },
      create: {
        id: "verify-port-cancel-all-scan-queued",
        advertiserId: advertiser.id,
        status: "QUEUED",
        scanMode: "FAST",
        cancelRequested: false
      },
      update: {
        advertiserId: advertiser.id,
        status: "QUEUED",
        scanMode: "FAST",
        finishedAt: null,
        cancelRequested: false
      }
    }),
    prisma.scanJob.upsert({
      where: { id: "verify-port-cancel-all-scan-running" },
      create: {
        id: "verify-port-cancel-all-scan-running",
        advertiserId: advertiser.id,
        status: "RUNNING",
        scanMode: "FAST",
        startedAt: new Date(),
        cancelRequested: false
      },
      update: {
        advertiserId: advertiser.id,
        status: "RUNNING",
        scanMode: "FAST",
        startedAt: new Date(),
        finishedAt: null,
        cancelRequested: false
      }
    }),
    prisma.collectionJob.upsert({
      where: { id: "verify-port-cancel-all-collection-queued" },
      create: {
        id: "verify-port-cancel-all-collection-queued",
        keywordId: keyword.id,
        platform: "INSTAGRAM",
        status: "QUEUED",
        minFollowers: 1,
        maxFollowers: 100000,
        cancelRequested: false
      },
      update: {
        keywordId: keyword.id,
        platform: "INSTAGRAM",
        status: "QUEUED",
        finishedAt: null,
        cancelRequested: false
      }
    }),
    prisma.collectionJob.upsert({
      where: { id: "verify-port-cancel-all-collection-running" },
      create: {
        id: "verify-port-cancel-all-collection-running",
        keywordId: keyword.id,
        platform: "VK",
        status: "RUNNING",
        startedAt: new Date(),
        minFollowers: 1,
        maxFollowers: 100000,
        cancelRequested: false
      },
      update: {
        keywordId: keyword.id,
        platform: "VK",
        status: "RUNNING",
        startedAt: new Date(),
        finishedAt: null,
        cancelRequested: false
      }
    })
  ]);
  return {
    advertiserId: advertiser.id,
    keywordId: keyword.id,
    scanQueuedId: scanQueued.id,
    scanRunningId: scanRunning.id,
    collectionQueuedId: collectionQueued.id,
    collectionRunningId: collectionRunning.id
  };
}

async function readCancelableWorkState(ids: Awaited<ReturnType<typeof seedCancelableWork>>) {
  const { prisma } = await import("@scaner-blogers/db");
  const [scanQueued, scanRunning, collectionQueued, collectionRunning, scanCancelEvents, collectionCancelEvents] = await prisma.$transaction([
    prisma.scanJob.findUnique({ where: { id: ids.scanQueuedId }, select: { status: true, cancelRequested: true, finishedAt: true } }),
    prisma.scanJob.findUnique({ where: { id: ids.scanRunningId }, select: { status: true, cancelRequested: true, finishedAt: true } }),
    prisma.collectionJob.findUnique({ where: { id: ids.collectionQueuedId }, select: { status: true, cancelRequested: true, finishedAt: true } }),
    prisma.collectionJob.findUnique({ where: { id: ids.collectionRunningId }, select: { status: true, cancelRequested: true, finishedAt: true } }),
    prisma.scanEvent.count({
      where: {
        scanJobId: { in: [ids.scanQueuedId, ids.scanRunningId] },
        message: "scan-cancel-all-requested"
      }
    }),
    prisma.collectionEvent.count({
      where: {
        collectionJobId: { in: [ids.collectionQueuedId, ids.collectionRunningId] },
        message: "collection-cancel-all-requested"
      }
    })
  ]);
  return { scanQueued, scanRunning, collectionQueued, collectionRunning, scanCancelEvents, collectionCancelEvents };
}

async function seedRetryWork() {
  const { prisma, queueAdvertiserScan, queueCollectionJob } = await import("@scaner-blogers/db");
  await prisma.$transaction([
    prisma.collectionJob.deleteMany({ where: { keywordId: "verify-port-retry-keyword" } }),
    prisma.searchKeyword.deleteMany({ where: { id: "verify-port-retry-keyword" } }),
    prisma.advertiser.deleteMany({ where: { id: "verify-port-retry-advertiser" } })
  ]);
  const advertiser = await prisma.advertiser.create({
    data: {
      id: "verify-port-retry-advertiser",
      googleAdvertiserId: "verify-port-retry-advertiser",
      name: "verify port retry"
    }
  });
  const keyword = await prisma.searchKeyword.create({
    data: {
      id: "verify-port-retry-keyword",
      value: "verify port retry",
      normalizedValue: "verify-port-retry",
      platforms: ["INSTAGRAM", "VK", "YOUTUBE"],
      minFollowers: 1,
      maxFollowers: 100000
    }
  });
  const scanOriginal = await queueAdvertiserScan(advertiser.id, ["GB"], {
    scanMode: "FAST",
    maxPagesPerRun: 1
  });
  const scanRetry = await queueAdvertiserScan(advertiser.id, ["GB"], {
    retryOfJobId: scanOriginal.id,
    retryRequestedFrom: "api",
    scanMode: "FAST",
    maxPagesPerRun: 1
  });

  const collectionOriginal = await queueCollectionJob({
    keywordId: keyword.id,
    platform: "instagram",
    minFollowers: 1,
    maxFollowers: 100000,
    countries: ["RU"],
    hashtags: ["verifyportretry"]
  });
  const collectionRetry = await queueCollectionJob({
    keywordId: keyword.id,
    platform: "instagram",
    minFollowers: 1,
    maxFollowers: 100000,
    countries: ["RU"],
    hashtags: ["verifyportretry"],
    retryOfJobId: collectionOriginal.id,
    retryRequestedFrom: "api"
  });

  return {
    advertiserId: advertiser.id,
    keywordId: keyword.id,
    scanOriginalId: scanOriginal.id,
    scanRetryId: scanRetry.id,
    collectionOriginalId: collectionOriginal.id,
    collectionRetryId: collectionRetry.id
  };
}

async function seedDedupeWork() {
  const { prisma, queueAdvertiserScan, queueCollectionJob } = await import("@scaner-blogers/db");
  await prisma.$transaction([
    prisma.collectionJob.deleteMany({ where: { keywordId: "verify-port-dedupe-keyword" } }),
    prisma.searchKeyword.deleteMany({ where: { id: "verify-port-dedupe-keyword" } }),
    prisma.advertiser.deleteMany({ where: { id: "verify-port-dedupe-advertiser" } })
  ]);
  const advertiser = await prisma.advertiser.create({
    data: {
      id: "verify-port-dedupe-advertiser",
      googleAdvertiserId: "verify-port-dedupe-advertiser",
      name: "verify port dedupe"
    }
  });
  const keyword = await prisma.searchKeyword.create({
    data: {
      id: "verify-port-dedupe-keyword",
      value: "verify port dedupe",
      normalizedValue: "verify-port-dedupe",
      platforms: ["INSTAGRAM", "VK", "YOUTUBE"],
      minFollowers: 1,
      maxFollowers: 100000
    }
  });

  const scanJob = await queueAdvertiserScan(advertiser.id, ["GB"], {
    scanMode: "FAST",
    maxPagesPerRun: 1
  });
  const duplicateScanJob = await queueAdvertiserScan(advertiser.id, ["GB"], {
    scanMode: "FAST",
    maxPagesPerRun: 1
  });

  const collectionJob = await queueCollectionJob({
    keywordId: keyword.id,
    platform: "youtube",
    minFollowers: 1,
    maxFollowers: 100000,
    countries: ["RU"],
    maxProfiles: 5
  });
  const duplicateCollectionJob = await queueCollectionJob({
    keywordId: keyword.id,
    platform: "youtube",
    minFollowers: 1,
    maxFollowers: 100000,
    countries: ["RU"],
    maxProfiles: 5
  });

  if (duplicateScanJob.id !== scanJob.id || duplicateCollectionJob.id !== collectionJob.id) {
    throw new Error("verify-port dedupe fixture did not reuse active jobs");
  }

  return {
    advertiserId: advertiser.id,
    keywordId: keyword.id,
    scanJobId: scanJob.id,
    collectionJobId: collectionJob.id
  };
}

async function seedDirtySocialAccountStatus() {
  const { prisma } = await import("@scaner-blogers/db");
  const vkToken = `vk1.a.${"abcdefghijklmnopqrstuvwxyz0123456789"}`;
  await prisma.socialPlatformAccount.upsert({
    where: { accountKey: "VK:verify-port-status-redaction" },
    create: {
      platform: "VK",
      accountKey: "VK:verify-port-status-redaction",
      label: "verify-port-status-redaction",
      username: "verify-port-status-redaction",
      status: "BLOCKED",
      blockedUntil: new Date(Date.now() + 3_600_000),
      lastErrorAt: new Date(),
      consecutiveErrors: 1,
      lastError: `verify-port-status-redaction Authorization: Bearer ${vkToken}; sessionid=ig-session-secret access_token=${vkToken} via http://user:pass@1.2.3.4:8080`
    },
    update: {
      platform: "VK",
      label: "verify-port-status-redaction",
      username: "verify-port-status-redaction",
      status: "BLOCKED",
      blockedUntil: new Date(Date.now() + 3_600_000),
      lastErrorAt: new Date(),
      consecutiveErrors: 1,
      lastError: `verify-port-status-redaction Authorization: Bearer ${vkToken}; sessionid=ig-session-secret access_token=${vkToken} via http://user:pass@1.2.3.4:8080`
    }
  });
}

async function seedSpreadsheetFormulaCandidate() {
  const { saveSocialCandidateProfile } = await import("@scaner-blogers/db");
  await saveSocialCandidateProfile({
    platform: "instagram",
    platformProfileId: "verify-port-formula-profile",
    username: "@verify-port-formula",
    displayName: "=HYPERLINK(\"https://evil.test\")",
    profileUrl: "https://instagram.com/verify-port-formula",
    followers: 25_000,
    bio: "+SUM(1,1)",
    externalUrl: "",
    contacts: {
      emails: ["@verify-port-formula"],
      phones: [],
      urls: ["https://example.test/formula"]
    },
    sourceKeyword: "verify-port-formula",
    sourceTag: "verify-port-formula",
    matchedBy: "verify_port",
    geoGuess: "RU",
    reason: "-formula reason",
    lastPosts: [],
    metrics: { avgLikes: 0, avgComments: 0, avgViews: 0, postsChecked: 0 },
    raw: { fixture: "verify-port-formula" },
    collectedAt: new Date().toISOString()
  });
}

async function seedSpreadsheetFormulaCreative() {
  const { prisma } = await import("@scaner-blogers/db");
  const advertiser = await prisma.advertiser.upsert({
    where: { googleAdvertiserId: "verify-port-formula-creative-advertiser" },
    create: {
      id: "verify-port-formula-creative-advertiser",
      googleAdvertiserId: "verify-port-formula-creative-advertiser",
      name: "+SUM(1,1)"
    },
    update: {
      name: "+SUM(1,1)"
    }
  });
  const app = await prisma.app.upsert({
    where: {
      store_appId: {
        store: "GOOGLE_PLAY",
        appId: "verify-port-formula-creative-app"
      }
    },
    create: {
      store: "GOOGLE_PLAY",
      appId: "verify-port-formula-creative-app",
      name: "=HYPERLINK(\"https://evil.test\")"
    },
    update: {
      name: "=HYPERLINK(\"https://evil.test\")"
    }
  });
  await prisma.creative.upsert({
    where: { creativeId: "verify-port-formula-creative" },
    create: {
      id: "verify-port-formula-creative",
      creativeId: "verify-port-formula-creative",
      advertiserId: advertiser.id,
      appDbId: app.id,
      status: "ACTIVE"
    },
    update: {
      advertiserId: advertiser.id,
      appDbId: app.id,
      status: "ACTIVE"
    }
  });
}

async function cleanupLegacyDirtyFixtures() {
  const { prisma } = await import("@scaner-blogers/db");
  const formulaProfile = await prisma.candidateProfile.findUnique({
    where: {
      platform_platformProfileId: {
        platform: "INSTAGRAM",
        platformProfileId: "verify-port-formula-profile"
      }
    },
    select: { candidateId: true }
  });
  const [
    deletedCollectionEvents,
    deletedCollectionJobs,
    deletedKeywords,
    deletedScanEvents,
    deletedScanJobs,
    deletedScanAdvertisers,
    deletedRawSnapshots,
    deletedRawCreatives,
    deletedRawAdvertisers,
    deletedCancelableCollectionJobs,
    deletedCancelableKeyword,
    deletedCancelableScanJobs,
    deletedCancelableAdvertiser,
    deletedRetryCollectionJobs,
    deletedRetryKeyword,
    deletedRetryAdvertiser,
    deletedDedupeCollectionJobs,
    deletedDedupeKeyword,
    deletedDedupeAdvertiser,
    deletedSocialAccountStatus,
    deletedFormulaProfiles,
    deletedFormulaCandidates,
    deletedFormulaCreatives,
    deletedFormulaApps,
    deletedFormulaCreativeAdvertisers
  ] = await prisma.$transaction([
    prisma.collectionEvent.deleteMany({ where: { id: "verify-port-redaction-event" } }),
    prisma.collectionJob.deleteMany({ where: { id: "verify-port-redaction-job" } }),
    prisma.searchKeyword.deleteMany({ where: { id: "verify-port-redaction-keyword" } }),
    prisma.scanEvent.deleteMany({ where: { id: "verify-port-scan-redaction-event" } }),
    prisma.scanJob.deleteMany({ where: { id: "verify-port-scan-redaction-job" } }),
    prisma.advertiser.deleteMany({ where: { id: "verify-port-scan-redaction-advertiser" } }),
    prisma.rawApiSnapshot.deleteMany({ where: { id: "verify-port-raw-redaction-snapshot" } }),
    prisma.creative.deleteMany({ where: { id: "verify-port-raw-redaction-creative" } }),
    prisma.advertiser.deleteMany({ where: { id: "verify-port-raw-redaction-advertiser" } }),
    prisma.collectionJob.deleteMany({ where: { id: { in: ["verify-port-cancel-all-collection-queued", "verify-port-cancel-all-collection-running"] } } }),
    prisma.searchKeyword.deleteMany({ where: { id: "verify-port-cancel-all-keyword" } }),
    prisma.scanJob.deleteMany({ where: { id: { in: ["verify-port-cancel-all-scan-queued", "verify-port-cancel-all-scan-running"] } } }),
    prisma.advertiser.deleteMany({ where: { id: "verify-port-cancel-all-advertiser" } }),
    prisma.collectionJob.deleteMany({ where: { keywordId: "verify-port-retry-keyword" } }),
    prisma.searchKeyword.deleteMany({ where: { id: "verify-port-retry-keyword" } }),
    prisma.advertiser.deleteMany({ where: { id: "verify-port-retry-advertiser" } }),
    prisma.collectionJob.deleteMany({ where: { keywordId: "verify-port-dedupe-keyword" } }),
    prisma.searchKeyword.deleteMany({ where: { id: "verify-port-dedupe-keyword" } }),
    prisma.advertiser.deleteMany({ where: { id: "verify-port-dedupe-advertiser" } }),
    prisma.socialPlatformAccount.deleteMany({ where: { accountKey: "VK:verify-port-status-redaction" } }),
    prisma.candidateProfile.deleteMany({ where: { platform: "INSTAGRAM", platformProfileId: "verify-port-formula-profile" } }),
    formulaProfile?.candidateId
      ? prisma.candidate.deleteMany({ where: { id: formulaProfile.candidateId } })
      : prisma.candidate.deleteMany({ where: { id: "__missing_verify_port_formula_candidate__" } }),
    prisma.creative.deleteMany({ where: { id: "verify-port-formula-creative" } }),
    prisma.app.deleteMany({ where: { appId: "verify-port-formula-creative-app", store: "GOOGLE_PLAY" } }),
    prisma.advertiser.deleteMany({ where: { id: "verify-port-formula-creative-advertiser" } })
  ]);
  const [
    remainingCollectionEvents,
    remainingCollectionJobs,
    remainingKeywords,
    remainingScanEvents,
    remainingScanJobs,
    remainingScanAdvertisers,
    remainingRawSnapshots,
    remainingRawCreatives,
    remainingRawAdvertisers,
    remainingCancelableCollectionJobs,
    remainingCancelableKeyword,
    remainingCancelableScanJobs,
    remainingCancelableAdvertiser,
    remainingRetryCollectionJobs,
    remainingRetryKeyword,
    remainingRetryAdvertiser,
    remainingDedupeCollectionJobs,
    remainingDedupeKeyword,
    remainingDedupeAdvertiser,
    remainingSocialAccountStatus,
    remainingFormulaProfiles,
    remainingFormulaCandidates,
    remainingFormulaCreatives,
    remainingFormulaApps,
    remainingFormulaCreativeAdvertisers
  ] = await prisma.$transaction([
    prisma.collectionEvent.count({ where: { id: "verify-port-redaction-event" } }),
    prisma.collectionJob.count({ where: { id: "verify-port-redaction-job" } }),
    prisma.searchKeyword.count({ where: { id: "verify-port-redaction-keyword" } }),
    prisma.scanEvent.count({ where: { id: "verify-port-scan-redaction-event" } }),
    prisma.scanJob.count({ where: { id: "verify-port-scan-redaction-job" } }),
    prisma.advertiser.count({ where: { id: "verify-port-scan-redaction-advertiser" } }),
    prisma.rawApiSnapshot.count({ where: { id: "verify-port-raw-redaction-snapshot" } }),
    prisma.creative.count({ where: { id: "verify-port-raw-redaction-creative" } }),
    prisma.advertiser.count({ where: { id: "verify-port-raw-redaction-advertiser" } }),
    prisma.collectionJob.count({ where: { id: { in: ["verify-port-cancel-all-collection-queued", "verify-port-cancel-all-collection-running"] } } }),
    prisma.searchKeyword.count({ where: { id: "verify-port-cancel-all-keyword" } }),
    prisma.scanJob.count({ where: { id: { in: ["verify-port-cancel-all-scan-queued", "verify-port-cancel-all-scan-running"] } } }),
    prisma.advertiser.count({ where: { id: "verify-port-cancel-all-advertiser" } }),
    prisma.collectionJob.count({ where: { keywordId: "verify-port-retry-keyword" } }),
    prisma.searchKeyword.count({ where: { id: "verify-port-retry-keyword" } }),
    prisma.advertiser.count({ where: { id: "verify-port-retry-advertiser" } }),
    prisma.collectionJob.count({ where: { keywordId: "verify-port-dedupe-keyword" } }),
    prisma.searchKeyword.count({ where: { id: "verify-port-dedupe-keyword" } }),
    prisma.advertiser.count({ where: { id: "verify-port-dedupe-advertiser" } }),
    prisma.socialPlatformAccount.count({ where: { accountKey: "VK:verify-port-status-redaction" } }),
    prisma.candidateProfile.count({ where: { platform: "INSTAGRAM", platformProfileId: "verify-port-formula-profile" } }),
    formulaProfile?.candidateId
      ? prisma.candidate.count({ where: { id: formulaProfile.candidateId } })
      : prisma.candidate.count({ where: { id: "__missing_verify_port_formula_candidate__" } }),
    prisma.creative.count({ where: { id: "verify-port-formula-creative" } }),
    prisma.app.count({ where: { appId: "verify-port-formula-creative-app", store: "GOOGLE_PLAY" } }),
    prisma.advertiser.count({ where: { id: "verify-port-formula-creative-advertiser" } })
  ]);
  return {
    deleted: deletedCollectionEvents.count
      + deletedCollectionJobs.count
      + deletedKeywords.count
      + deletedScanEvents.count
      + deletedScanJobs.count
      + deletedScanAdvertisers.count
      + deletedRawSnapshots.count
      + deletedRawCreatives.count
      + deletedRawAdvertisers.count
      + deletedCancelableCollectionJobs.count
      + deletedCancelableKeyword.count
      + deletedCancelableScanJobs.count
      + deletedCancelableAdvertiser.count
      + deletedRetryCollectionJobs.count
      + deletedRetryKeyword.count
      + deletedRetryAdvertiser.count
      + deletedDedupeCollectionJobs.count
      + deletedDedupeKeyword.count
      + deletedDedupeAdvertiser.count
      + deletedSocialAccountStatus.count
      + deletedFormulaProfiles.count
      + deletedFormulaCandidates.count
      + deletedFormulaCreatives.count
      + deletedFormulaApps.count
      + deletedFormulaCreativeAdvertisers.count,
    remaining: remainingCollectionEvents
      + remainingCollectionJobs
      + remainingKeywords
      + remainingScanEvents
      + remainingScanJobs
      + remainingScanAdvertisers
      + remainingRawSnapshots
      + remainingRawCreatives
      + remainingRawAdvertisers
      + remainingCancelableCollectionJobs
      + remainingCancelableKeyword
      + remainingCancelableScanJobs
      + remainingCancelableAdvertiser
      + remainingRetryCollectionJobs
      + remainingRetryKeyword
      + remainingRetryAdvertiser
      + remainingDedupeCollectionJobs
      + remainingDedupeKeyword
      + remainingDedupeAdvertiser
      + remainingSocialAccountStatus
      + remainingFormulaProfiles
      + remainingFormulaCandidates
      + remainingFormulaCreatives
      + remainingFormulaApps
      + remainingFormulaCreativeAdvertisers
  };
}
