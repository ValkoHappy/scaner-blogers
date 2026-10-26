const statusLabels: Record<string, string> = {
  SUCCESS: "Успешно",
  ACTIVE: "Активен",
  FAILED: "Ошибка",
  STOPPED: "Остановлен",
  BLOCKED: "Ограничено",
  CANCELED: "Отменено",
  STOPPING: "Останавливается",
  QUEUED: "В очереди",
  RUNNING: "В процессе",
  PENDING: "Не проверен",
  MISSING_CREDENTIALS: "Нет доступа",
  UNKNOWN: "Неизвестно"
};

const storeLabels: Record<string, string> = {
  GOOGLE_PLAY: "Google Play",
  APP_STORE: "App Store",
  UNKNOWN: "Неизвестно"
};

const formatLabels: Record<string, string> = {
  VIDEO: "Видео",
  IMAGE: "Изображение",
  TEXT: "Текст",
  UNKNOWN: "Неизвестно"
};

const assetKindLabels: Record<string, string> = {
  LANDSCAPE_IMAGE: "Изображение",
  APP_ICON: "Иконка",
  SCREENSHOT: "Скриншот",
  COVER_IMAGE: "Обложка",
  VIDEO: "Видео",
  LANDING_URL: "Ссылка"
};

export function formatStatusLabel(status?: string | null) {
  const candidateLabels: Record<string, string> = {
    NEW: "Новый",
    REVIEWED: "Просмотрен",
    PRIORITY: "Приоритет",
    CONTACTED: "Связались",
    REJECTED: "Не подходит",
    SAVED: "Сохранён"
  };
  if (status && candidateLabels[status]) return candidateLabels[status];
  return statusLabels[status ?? "UNKNOWN"] ?? "Неизвестно";
}

export function formatStoreLabel(store?: string | null) {
  return storeLabels[store ?? "UNKNOWN"] ?? store ?? "Неизвестно";
}

export function formatCreativeFormat(format?: string | null) {
  return formatLabels[format ?? "UNKNOWN"] ?? "Неизвестно";
}

export function formatAssetKind(kind?: string | null) {
  return assetKindLabels[kind ?? "UNKNOWN"] ?? "Материал";
}

export function formatCountries(countries?: string[] | null) {
  const value = countries?.filter(Boolean).join(", ");
  return value || "Все страны";
}

export function formatScanMode(mode?: string | null) {
  return ({
    FAST: "Быстрый",
    FULL: "Полный",
    CAUTIOUS: "Осторожный"
  } as Record<string, string>)[mode ?? ""] ?? "Осторожный";
}

export function formatDateTime(value?: Date | string | null) {
  if (!value) return "-";
  return new Date(value).toLocaleString("ru-RU", {
    timeZone: "Europe/Moscow",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

export function formatDate(value?: Date | string | null) {
  if (!value) return "-";
  return new Date(value).toLocaleDateString("ru-RU", { timeZone: "Europe/Moscow" });
}

export function nextDailyScanTime(from = new Date(), hour = 3) {
  const next = new Date(from);
  next.setHours(hour, 0, 0, 0);
  if (next <= from) next.setDate(next.getDate() + 1);
  return next;
}

export type ScheduleSettings = {
  dailyScanHour?: number | null;
  scheduleType?: string | null;
  dailyScanHours?: number[] | null;
  scanIntervalHours?: number | null;
};

export function nextScheduledScanTime(from = new Date(), settings: ScheduleSettings = {}) {
  const scheduleType = settings.scheduleType ?? "DAILY";
  if (scheduleType === "INTERVAL") {
    const interval = clampInterval(settings.scanIntervalHours);
    const next = new Date(from);
    const nextHour = Math.floor(next.getHours() / interval) * interval + interval;
    next.setMinutes(0, 0, 0);
    next.setHours(nextHour);
    return next;
  }

  const hours = normalizeScheduleHours(settings);
  for (const hour of hours) {
    const next = new Date(from);
    next.setHours(hour, 0, 0, 0);
    if (next > from) return next;
  }
  const tomorrow = new Date(from);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(hours[0] ?? 3, 0, 0, 0);
  return tomorrow;
}

export function formatSchedule(settings: ScheduleSettings = {}) {
  if ((settings.scheduleType ?? "DAILY") === "INTERVAL") {
    return `каждые ${clampInterval(settings.scanIntervalHours)} ч.`;
  }
  const hours = normalizeScheduleHours(settings).map((hour) => `${String(hour).padStart(2, "0")}:00`);
  return hours.length > 1 ? `в ${hours.join(", ")}` : `ежедневно в ${hours[0] ?? "03:00"}`;
}

export function formatScheduleHours(settings: ScheduleSettings = {}) {
  return normalizeScheduleHours(settings).join(", ");
}

function normalizeScheduleHours(settings: ScheduleSettings) {
  const source = settings.dailyScanHours?.length ? settings.dailyScanHours : [settings.dailyScanHour ?? 3];
  const hours = [...new Set(source.map(Number).filter((hour) => Number.isInteger(hour) && hour >= 0 && hour <= 23))];
  return hours.length ? hours.sort((a, b) => a - b) : [3];
}

function clampInterval(value?: number | null) {
  const interval = Number(value);
  if (!Number.isFinite(interval)) return 24;
  return Math.min(24, Math.max(1, Math.round(interval)));
}

export function transparencyAdvertiserUrl(advertiserId?: string | null, dateRange?: { startDate?: string | null; endDate?: string | null }) {
  if (!advertiserId) return undefined;
  const params = new URLSearchParams();
  if (dateRange?.startDate && dateRange.endDate) {
    params.set("region", "anywhere");
    params.set("start-date", dateRange.startDate);
    params.set("end-date", dateRange.endDate);
  }
  const query = params.toString();
  return `https://adstransparency.google.com/advertiser/${advertiserId}${query ? `?${query}` : ""}`;
}

export function transparencyCreativeUrl(advertiserId?: string | null, creativeId?: string | null) {
  if (!advertiserId || !creativeId) return undefined;
  return `https://adstransparency.google.com/advertiser/${advertiserId}/creative/${creativeId}`;
}

export function formatScanMessage(message?: string | null) {
  if (!message) return "-";
  const clean = message
    .replace(/\x1B\[[0-9;]*m/g, "")
    .replace(/\u001b\[[0-9;]*m/g, "")
    .replace(/\[\d+m/g, "")
    .replace(/\s*Call log:[\s\S]*$/m, "")
    .replace(/\s+/g, " ")
    .trim();

  if (clean.includes("ERR_PROXY_CONNECTION_FAILED")) {
    return "Прокси не подключился. Отключите прокси или укажите рабочий URL.";
  }
  if (clean.startsWith("browser-native:challenge:")) {
    return "Нужна ручная проверка proxy: Google показал captcha или challenge.";
  }
  if (clean.startsWith("browser-native:timeout:")) {
    return "Proxy не открыл страницу Google вовремя.";
  }
  if (clean.includes("no healthy proxy")) {
    return "Нет рабочего proxy для браузерного сбора. Проверьте proxy pool или временно отключите прокси.";
  }
  if (clean.includes("SearchService/SearchCreatives:404")) {
    return "Google вернул 404 на RPC-поиск. Нужен браузерный режим или пауза.";
  }
  const socialMessages: Record<string, string> = {
    "collection-queued": "Задача добавлена в очередь и ожидает запуска",
    instagram_no_available_account: "Сбор ещё не начался: сейчас нет доступного Instagram-аккаунта. Worker повторит попытку автоматически",
    "collection-canceled": "Сбор остановлен",
    social_collection_completed: "сбор завершен",
    social_candidates_saved: "кандидаты сохранены",
    social_collection_failed: "сбор завершился с ошибкой",
    social_collection_blocked: "сбор ограничен площадкой",
    collection_cancel_all_requested: "запрошена остановка всех сборов",
    collection_retry_requested: "запущен повторный сбор",
    collection_queue_deduped: "дубликат задачи не добавлен"
  };
  if (socialMessages[clean]) return socialMessages[clean];
  if (clean.startsWith("blocked:") || clean.includes(":403") || clean.includes(":429") || clean.includes("captcha")) {
    return "Google ограничил запрос. Нужна пауза, probe позже или рабочий прокси.";
  }
  if (clean === "scan-canceled") return "Сканирование остановлено пользователем.";
  return clean.length > 180 ? `${clean.slice(0, 180)}...` : clean;
}
