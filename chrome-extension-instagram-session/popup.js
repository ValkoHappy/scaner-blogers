const usernameInput = document.getElementById("username");
const sessionIdField = document.getElementById("sessionId");
const readSessionButton = document.getElementById("readSessionButton");
const copySessionButton = document.getElementById("copySessionButton");
const downloadJsonButton = document.getElementById("downloadJsonButton");
const statusBox = document.getElementById("status");

const STORAGE_KEY = "scanerblogers_instagram_session_bridge";

let lastPayload = null;

bootstrap().catch((error) => {
  setStatus(error instanceof Error ? error.message : String(error), "error");
});

readSessionButton.addEventListener("click", async () => {
  setStatus("Читаю cookies Instagram...", "");
  await persistInputs();

  try {
    const payload = await readInstagramSession();
    lastPayload = payload;
    sessionIdField.value = payload.sessionId;
    copySessionButton.disabled = false;
    downloadJsonButton.disabled = false;
    setStatus("Session ID получен. Скачайте JSON и загрузите его в ScanerBlogers.", "success");
  } catch (error) {
    sessionIdField.value = "";
    lastPayload = null;
    copySessionButton.disabled = true;
    downloadJsonButton.disabled = true;
    setStatus(error instanceof Error ? error.message : String(error), "error");
  }
});

copySessionButton.addEventListener("click", async () => {
  if (!lastPayload?.sessionId) return;
  try {
    await navigator.clipboard.writeText(lastPayload.sessionId);
    setStatus("Session ID скопирован в буфер обмена.", "success");
  } catch {
    setStatus("Не удалось скопировать sessionid. Скопируйте его вручную из поля.", "error");
  }
});

downloadJsonButton.addEventListener("click", async () => {
  if (!lastPayload) return;
  await persistInputs();

  const blob = new Blob([JSON.stringify(lastPayload, null, 2)], {
    type: "application/json;charset=utf-8"
  });
  const url = URL.createObjectURL(blob);
  chrome.downloads.download(
    {
      url,
      filename: "scanerblogers-instagram-sessionid.json",
      saveAs: true
    },
    () => {
      URL.revokeObjectURL(url);
    }
  );
  setStatus("JSON с sessionid подготовлен для скачивания.", "success");
});

async function bootstrap() {
  const saved = await chrome.storage.local.get(STORAGE_KEY);
  const state = saved[STORAGE_KEY] || {};
  usernameInput.value = typeof state.username === "string" ? state.username : "";
  if (!usernameInput.value.trim()) {
    const detectedUsername = await detectInstagramUsername();
    if (detectedUsername) {
      usernameInput.value = detectedUsername;
      await persistInputs();
    }
  }
}

async function persistInputs() {
  await chrome.storage.local.set({
    [STORAGE_KEY]: {
      username: usernameInput.value.trim()
    }
  });
}

async function readInstagramSession() {
  const [sessionIdCookie, csrfCookie, dsUserIdCookie] = await Promise.all([
    chrome.cookies.get({ url: "https://www.instagram.com", name: "sessionid" }),
    chrome.cookies.get({ url: "https://www.instagram.com", name: "csrftoken" }),
    chrome.cookies.get({ url: "https://www.instagram.com", name: "ds_user_id" })
  ]);

  if (!sessionIdCookie?.value) {
    throw new Error("В этом браузере нет cookie sessionid для instagram.com. Сначала войдите в Instagram.");
  }

  let username = usernameInput.value.trim();
  if (!username) {
    username = await detectInstagramUsername();
    if (username) {
      usernameInput.value = username;
      await persistInputs();
    }
  }
  if (!username) {
    throw new Error("Не удалось определить логин Instagram. Откройте профиль аккаунта или впишите логин в расширении один раз.");
  }

  return {
    exportedAt: new Date().toISOString(),
    source: "instagram-browser-cookies",
    username,
    sessionId: decodeSessionValue(sessionIdCookie.value),
    cookies: {
      sessionid: decodeSessionValue(sessionIdCookie.value),
      csrftoken: csrfCookie?.value || "",
      ds_user_id: dsUserIdCookie?.value || ""
    }
  };
}

async function detectInstagramUsername() {
  try {
    const response = await fetch("https://www.instagram.com/api/v1/accounts/current_user/?__a=1", {
      credentials: "include"
    });
    if (response.ok) {
      const payload = await response.json();
      const candidate = payload?.user?.username;
      if (typeof candidate === "string" && candidate.trim()) {
        return candidate.trim();
      }
    }
  } catch {
    // Ignore and continue to URL-based fallback.
  }

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const url = typeof tab?.url === "string" ? tab.url : "";
    const match = url.match(/^https:\/\/www\.instagram\.com\/([A-Za-z0-9._]+)\/?$/i);
    if (match?.[1]) {
      return match[1];
    }
  } catch {
    // Ignore fallback errors.
  }

  return "";
}

function setStatus(message, tone) {
  statusBox.textContent = message;
  statusBox.className = `status${tone ? ` ${tone}` : ""}`;
}

function decodeSessionValue(value) {
  if (!value) return "";
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
