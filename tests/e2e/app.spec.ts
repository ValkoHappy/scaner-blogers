import { expect, test } from "@playwright/test";

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.locator('input[name="email"]').fill("admin@scaner-blogers.local");
  await page.locator('input[name="password"]').fill("TestOnly!ChangeInCi2026");
  await page.locator('form.login-card button[type="submit"]').click();
  await expect(page).toHaveURL("/");
}

async function expectReadableRussianUi(page: import("@playwright/test").Page) {
  const text = await page.locator("main.main").innerText();
  const mojibakeMarkers = [
    "Р С’", "Р вЂ", "Р вЂ™", "Р вЂњ", "Р вЂќ", "Р вЂў", "Р вЂ“", "Р вЂ”", "Р В", "Р в„ў", "Р С™", "Р вЂє", "Р Сљ", "Р Сњ", "Р С›", "Р Сџ",
    "Р В ", "Р РЋ", "Р Сћ", "Р Р€", "Р В¤", "Р Тђ", "Р В¦", "Р В§", "Р РЃ", "Р В©", "Р В­", "Р В®", "Р Р‡",
    "Р В°", "Р В±", "Р Р†", "Р С–", "Р Т‘", "Р Вµ", "Р В¶", "Р В·", "Р С‘", "Р в„–", "Р С”", "Р В»", "Р С", "Р Р…", "Р С•", "Р С—",
    "РЎР‚", "РЎРѓ", "РЎвЂљ", "РЎС“", "РЎвЂћ", "РЎвЂ¦", "РЎвЂ ", "РЎвЂЎ", "РЎв‚¬", "РЎвЂ°", "РЎРЉ", "РЎвЂ№", "РЎРЊ", "РЎР‹", "РЎРЏ",
    "Р’В«", "Р’В»", "РІвЂћвЂ“"
  ];
  for (const marker of mojibakeMarkers) {
    expect(text, `UI contains mojibake marker ${marker}`).not.toContain(marker);
  }
}

test("private blogger dashboard navigation works on desktop", async ({ page }) => {
  await login(page);
  await expect(page.locator(".page-title")).toBeVisible();
  await expectReadableRussianUi(page);
  await expect(page.locator(".stat-card")).toHaveCount(6);

  await page.locator('.sidebar a[href="/keywords"]').click();
  await expect(page).toHaveURL("/keywords");
  await expectReadableRussianUi(page);
  await page.locator('form#keywords-bulk-form textarea[name="values"]').fill("face yoga");
  await page.locator('form#keywords-bulk-form button[type="submit"]').first().click();
  const faceYogaRow = page.locator("tr").filter({ hasText: "face yoga" });
  await expect(faceYogaRow.locator(".keyword-name-cell")).toBeVisible();
  await expect(page.locator(".keywords-pro-table")).toBeVisible();
  await expect(faceYogaRow.locator(".keyword-table-actions form.inline-form")).toHaveCount(3);

  await page.locator('.sidebar a[href="/candidates"]').click();
  await expect(page).toHaveURL("/candidates");
  await expectReadableRussianUi(page);
  await expect(page.locator(".candidates-filter-panel")).toBeVisible();
  await expect(page.locator("form#candidate-bulk-status-form")).toBeVisible();
  await expect(page.locator(".platform-tabs")).toBeVisible();
  await expect(page.locator('select[name="platform"]')).toBeVisible();
  await expect(page.locator('select[name="exported"]')).toBeVisible();
  await expect(page.locator('button[name="intent"][value="mark_exported"]')).toBeVisible();
  await expect(page.locator('select[name="status"]').first()).toBeVisible();
  await expect(page.locator('a[href^="/api/export/candidates.csv"]')).toBeVisible();
  await expect(page.locator('a[href^="/api/export/candidates.xlsx"]')).toBeVisible();

  await page.locator('.sidebar a[href="/scans"]').click();
  await expect(page).toHaveURL("/scans");
  await expectReadableRussianUi(page);
  await expect(page.getByRole("heading", { name: "Сканирования" })).toBeVisible();
  const socialTable = page.locator("table.table").first();
  await expect(socialTable).toBeVisible();
  const instagramJobRow = socialTable.locator("tbody tr").filter({ hasText: "INSTAGRAM" }).first();
  await expect(instagramJobRow).toBeVisible();
  await instagramJobRow.getByRole("button").first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByLabel("Диагностика журнала")).toBeVisible();
  await expect(page.getByText("Событий", { exact: true })).toBeVisible();
  await expect(page.getByText("Парсер", { exact: true })).toBeVisible();
  await expect(page.getByText("предупреждения JSONL", { exact: true })).toBeVisible();
  await expect(page.locator(".console-log")).toContainText("code=collector_stdout_parse_failed");
  await expect(page.locator(".console-log")).toContainText("строка=9");
  await page.locator(".modal-backdrop").click({ position: { x: 5, y: 5 } });

  await page.goto("/export");
  await expect(page).toHaveURL("/candidates");
  await expectReadableRussianUi(page);
  await expect(page.locator('select[name="platform"]')).toBeVisible();
  await expect(page.locator('a[href^="/api/export/candidates.csv"]')).toBeVisible();
  await expect(page.locator('a[href^="/api/export/candidates.xlsx"]')).toBeVisible();
  await expect(page.locator('a[href^="/api/export/creatives.csv"]')).toHaveCount(0);

  const candidatesCsv = await page.evaluate(async () => {
    const response = await fetch("/api/export/candidates.csv");
    return { ok: response.ok, text: await response.text() };
  });
  expect(candidatesCsv.ok).toBe(true);
  expect(candidatesCsv.text).toContain("platform");
  expect(candidatesCsv.text).toContain("exported_at");
});

test("legacy ad transparency API routes require auth and work with seeded data", async ({ page, request }) => {
  const unauthorized = await request.get("/api/dashboard/stats");
  expect(unauthorized.status()).toBe(401);

  await login(page);

  const stats = await page.evaluate(async () => {
    const response = await fetch("/api/dashboard/stats");
    return { ok: response.ok, body: await response.json() };
  });
  expect(stats.ok).toBe(true);
  expect(stats.body).toMatchObject({ advertisers: expect.any(Number), creatives: expect.any(Number) });

  const advertiserPost = await page.evaluate(async () => {
    const response = await fetch("/api/advertisers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        input: "AR00000000000000000002",
        name: "API Advertiser",
        selectedCountries: ["GB"],
        scanStartDate: "2026-05-01",
        scanEndDate: "2026-05-31"
      })
    });
    return { status: response.status, body: await response.json() };
  });
  expect(advertiserPost.status).toBe(201);
  const advertiser = advertiserPost.body.advertiser;

  const scanPost = await page.evaluate(async ({ advertiserId }) => {
    const response = await fetch(`/api/advertisers/${advertiserId}/scan`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ countries: ["GB"] })
    });
    return { status: response.status, body: await response.json() };
  }, { advertiserId: advertiser.id });
  expect(scanPost.status).toBe(201);
  const queuedJob = scanPost.body.job;
  expect(queuedJob.scanStartDate).toBe("2026-05-01");
  expect(queuedJob.scanEndDate).toBe("2026-05-31");

  const retryPost = await page.evaluate(async ({ scanJobId }) => {
    const response = await fetch(`/api/scans/${scanJobId}/retry`, { method: "POST" });
    return { status: response.status, body: await response.json() };
  }, { scanJobId: queuedJob.id });
  expect(retryPost.status).toBe(201);
  expect(retryPost.body.job.scanStartDate).toBe("2026-05-01");
  expect(retryPost.body.job.scanEndDate).toBe("2026-05-31");
  const retryEvents = await page.evaluate(async ({ scanJobId }) => {
    const response = await fetch(`/api/scans/${scanJobId}/events`);
    const body = await response.json();
    return {
      ok: response.ok,
      body
    };
  }, { scanJobId: queuedJob.id });
  expect(retryEvents.ok).toBe(true);
  expect(JSON.stringify(retryEvents.body)).toContain("scan-retry-requested");
  expect(JSON.stringify(retryEvents.body)).toContain("scan_retry_requested");
  expect(JSON.stringify(retryEvents.body)).toContain(retryPost.body.job.id);

  const cancelPost = await page.evaluate(async ({ scanJobId }) => {
    const response = await fetch(`/api/scans/${scanJobId}/cancel`, { method: "POST" });
    return response.ok;
  }, { scanJobId: queuedJob.id });
  expect(cancelPost).toBe(true);
  const cancelEvents = await page.evaluate(async ({ scanJobId }) => {
    const response = await fetch(`/api/scans/${scanJobId}/events`);
    const body = await response.json();
    return {
      ok: response.ok,
      body
    };
  }, { scanJobId: queuedJob.id });
  expect(cancelEvents.ok).toBe(true);
  expect(JSON.stringify(cancelEvents.body)).toContain("scan-cancel-requested");
  expect(JSON.stringify(cancelEvents.body)).toContain("scan_cancel_requested");

  const settingsPatch = await page.evaluate(async () => {
    const response = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        defaultCountries: ["GB", "DE"],
        scanMode: "FULL",
        requestDelayMs: 1200,
        maxPagesPerRun: 9,
        maxCreativesPerRun: 150,
        exportDefaultFields: ["creativeId", "advertiserName", "status"]
      })
    });
    return { ok: response.ok, body: await response.json() };
  });
  expect(settingsPatch.ok).toBe(true);
  expect(settingsPatch.body.settings.scanMode).toBe("FULL");

  for (const path of [
    "/api/advertisers",
    "/api/creatives?q=CR063&country=GB&status=ACTIVE",
    "/api/creatives/CR06346342443637538817",
    "/api/apps",
    "/api/scans",
    "/api/settings",
    "/api/export/raw.json",
    "/api/system/status"
  ]) {
    const ok = await page.evaluate(async (url) => (await fetch(url)).ok, path);
    expect(ok, path).toBe(true);
  }

  const systemStatus = await page.evaluate(async () => {
    const response = await fetch("/api/system/status");
    return response.json();
  });
  expect(systemStatus.social.credentials).toEqual(expect.arrayContaining([
    expect.objectContaining({ platform: "INSTAGRAM", source: expect.any(String), missing: expect.any(Array) }),
    expect.objectContaining({ platform: "VK", source: expect.any(String), missing: expect.any(Array) }),
    expect.objectContaining({ platform: "YOUTUBE", source: expect.any(String), missing: expect.any(Array) })
  ]));
  expect(systemStatus.social.integrity).toEqual(expect.objectContaining({
    checkedJobs: expect.any(Number),
    errors: expect.any(Number),
    warnings: expect.any(Number),
    issues: expect.any(Array)
  }));
  expect(JSON.stringify(systemStatus.social.credentials)).not.toContain("TestOnly!ChangeInCi2026");

  const filteredCsv = await page.evaluate(async ({ advertiserId }) => {
    const response = await fetch(`/api/export/creatives.csv?advertiserId=${advertiserId}`);
    return { ok: response.ok, text: await response.text() };
  }, { advertiserId: advertiser.id });
  expect(filteredCsv.ok).toBe(true);
  expect(filteredCsv.text).toContain("creative_id");
});

test("export builder and settings screens expose working product controls", async ({ page }) => {
  await login(page);

  await page.goto("/export?platform=INSTAGRAM");
  await expect(page).toHaveURL("/candidates?platform=INSTAGRAM");
  await expect(page.locator(".page-title")).toBeVisible();
  await expect(page.locator(".platform-tabs")).toBeVisible();
  await expect(page.locator('select[name="platform"]')).toHaveValue("INSTAGRAM");
  await expect(page.locator(".candidates-filter-panel")).toBeVisible();
  await expect(page.locator('a[href^="/api/export/candidates.csv"]')).toBeVisible();
  await expect(page.locator('a[href^="/api/export/candidates.xlsx"]')).toBeVisible();

  await page.goto("/settings");
  await expect(page.locator(".page-title")).toBeVisible();
  await expect(page.locator("form.settings-form")).toBeVisible();
  await expect(page.getByText("Источник VK доступа", { exact: true })).toBeVisible();
  await expect(page.getByText("VK_ACCESS_TOKEN", { exact: true })).toBeVisible();
  await expect(page.locator('a[href="/settings/connect/instagram"]')).toBeVisible();
  await expect(page.locator('a[href="/settings/connect/vk"]')).toBeVisible();
  await expect(page.locator('a[href="/settings/connect/youtube"]')).toBeVisible();
  await page.locator('input[name="rawSnapshotRetentionDays"]').fill("45");
  await expect(page.locator('input[name="rawSnapshotRetentionDays"]')).toHaveValue("45");
});

test("keywords screen supports bulk queueing instead of per-key manual starts", async ({ page }) => {
  await login(page);

  await page.goto("/keywords");
  await expect(page.locator(".page-title")).toHaveText("Ключевые слова");
  await expect(page.locator("form.keyword-mass-launch")).toBeVisible();
  await expect(page.getByText("Массовый запуск", { exact: true })).toBeVisible();
  await expect(page.locator('form.keyword-mass-launch input[name="platforms"][value="instagram"]')).toBeAttached();
  await expect(page.locator('form.keyword-mass-launch input[name="platforms"][value="vk"]')).toBeAttached();
  await expect(page.locator('form.keyword-mass-launch input[name="platforms"][value="youtube"]')).toBeAttached();
  await expect(page.getByRole("button", { name: "Запустить по всем" })).toBeVisible();

  await page.locator('textarea[name="values"]').fill("массаж лица\nфейсфитнес");
  await expect(page.locator('button[name="queueAfterAdd"]')).toBeVisible();
  await expect(page.getByRole("button", { name: "Добавить и запустить" })).toBeVisible();
});

test("settings login-check buttons show platform failure reasons", async ({ page }) => {
  await login(page);
  await page.route("**/api/instagram/login-check", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: false,
        accountStatus: "BLOCKED",
        message: "checkpoint required"
      })
    });
  });
  await page.route("**/api/vk/login-check", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: false,
        accountStatus: "BLOCKED",
        message: "access_token was given to another ip address"
      })
    });
  });

  await page.goto("/settings");
  await page.getByRole("button", { name: "Run server login check" }).click();
  await expect(page.getByText("Server login check failed: checkpoint required")).toBeVisible();

  await page.getByRole("button", { name: "Проверить VK" }).click();
  await expect(page.getByText("Проверка: BLOCKED - access_token was given to another ip address")).toBeVisible();
});

test("collection health screen exposes platform lanes and recent diagnostics", async ({ page }) => {
  await login(page);

  await page.goto("/health");
  await expect(page.locator(".page-title")).toHaveText("Здоровье системы");
  await expect(page.getByText("Воркер", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Потоки по платформам" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Готовность доступов" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Целостность сборов" })).toBeVisible();
  await expect(page.getByText("Последние задачи", { exact: true })).toBeVisible();
  await expect(page.getByText("INSTAGRAM", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("VK", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("YOUTUBE", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("no VK user access token configured", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Качество ключей" })).toBeVisible();
});

test("full scan from advertiser card shows visible progress and activity", async ({ page }) => {
  await login(page);
  await page.goto("/advertisers/AR14577439029227159553");
  await page.locator(".topbar form.inline-form button.primary").click();

  await expect(page.getByRole("progressbar")).toBeVisible();
  await expect(page.locator(".scan-progress-panel")).toBeVisible();
});

test("mobile detail page has no document-level horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page.goto("/creatives/CR06346342443637538817");
  await expect(page.getByRole("heading", { name: "CR06346342443637538817" })).toBeVisible();

  const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
  expect(hasOverflow).toBe(false);
});
