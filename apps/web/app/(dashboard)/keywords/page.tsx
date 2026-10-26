import { Icons } from "@/components/icons";
import { PendingButton } from "@/components/pending-button";
import { PersistFormState } from "@/components/persist-form-state";
import { PlatformLogo } from "@/components/platform-logo";
import { formatDateTime } from "@/components/display";
import { PageHeader, StatusBadge } from "@/components/shell";
import { getKeywords } from "@/lib/data";
import { platformFollowerRange } from "@/lib/platform-follower-ranges";
import { redirect } from "next/navigation";
import { addKeywordAction, addKeywordsBulkAction, queueAllKeywordsAction, queueInstagramKeywordAction, queueVkKeywordAction, queueYouTubeKeywordAction } from "../actions";

type SearchParams = Record<string, string | undefined>;
type PlatformKey = "instagram" | "vk" | "youtube";

const defaultFollowerRanges = {
  instagram: { min: 20_000, max: 60_000 },
  vk: { min: 5_000, max: 100_000 },
  youtube: { min: 10_000, max: 150_000 }
} as const;

const platforms: Array<{ key: PlatformKey; label: string; defaultMin: number; defaultMax: number; defaultMode: "quick" | "deep" | "continuous" }> = [
  { key: "instagram", label: "Instagram", defaultMin: defaultFollowerRanges.instagram.min, defaultMax: defaultFollowerRanges.instagram.max, defaultMode: "deep" },
  { key: "vk", label: "VK", defaultMin: defaultFollowerRanges.vk.min, defaultMax: defaultFollowerRanges.vk.max, defaultMode: "deep" },
  { key: "youtube", label: "YouTube", defaultMin: defaultFollowerRanges.youtube.min, defaultMax: defaultFollowerRanges.youtube.max, defaultMode: "deep" }
];

export default async function KeywordsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const keywords = await getKeywords();
  const filteredKeywords = filterKeywords(keywords, params);
  const pageSize = 20;
  const totalPages = Math.max(1, Math.ceil(filteredKeywords.length / pageSize));
  const currentPage = normalizePage(params.page, totalPages);
  if (shouldRedirectPageParam(params.page, currentPage)) {
    redirect(pageHref(params, currentPage));
  }
  const pageStart = (currentPage - 1) * pageSize;
  const visibleKeywords = filteredKeywords.slice(pageStart, pageStart + pageSize);
  const stats = buildKeywordStats(keywords);

  return (
    <div className="grid keywords-screen keywords-pro-screen">
      <PageHeader title="Ключевые слова" subtitle="Управление поисковыми запросами и запуск сборов блогеров по Instagram, VK и YouTube">
        <button className="button" type="button" disabled title="Импорт CSV будет подключен отдельным действием">
          <Icons.Upload size={16} />
          Импорт CSV
        </button>
        <button className="button" type="button" disabled title="Экспорт ключевых слов будет подключен отдельным действием">
          <Icons.Download size={16} />
          Экспорт
        </button>
        <button className="button icon-button" type="button" disabled title="Справка по экрану">
          <Icons.HelpCircle size={16} />
        </button>
      </PageHeader>

      <section className="keywords-builder-panel panel">
        <form action={addKeywordsBulkAction} className="keywords-builder-form" id="keywords-bulk-form">
          <PersistFormState
            formId="keywords-bulk-form"
            storageKey="scaner-blogers:keywords-bulk-settings:v1"
            names={[
              "autoHashtags",
              "queuePlatforms",
              "instagramBulkScanMode",
              "vkBulkScanMode",
              "youtubeBulkScanMode",
              "instagramMinFollowers",
              "instagramMaxFollowers",
              "vkMinFollowers",
              "vkMaxFollowers",
              "youtubeMinFollowers",
              "youtubeMaxFollowers"
            ]}
          />
          <div className="keywords-builder-main">
            <div className="section-title-row">
              <h2 className="panel-title">Массовое добавление ключевых слов</h2>
              <Icons.Info size={15} />
            </div>
            <div className="keyword-textarea-wrap">
              <textarea
                className="input textarea keyword-bulk-textarea"
                name="values"
                required
                placeholder={"массаж лица\nфейсфитнес\nкосметолог\nуход за кожей"}
              />
              <span className="keyword-lines-hint">1 строка = 1 ключ</span>
            </div>
            <label className="keyword-toggle-row">
              <input type="checkbox" name="autoHashtags" value="1" defaultChecked />
              <span>Автогенерация хэштегов</span>
              <Icons.Info size={14} />
            </label>
          </div>

          <div className="keywords-builder-platforms">
            <h3 className="keyword-column-title">Площадки</h3>
            {platforms.map((platform) => (
              <label className="keyword-platform-check" key={platform.key}>
                <input type="checkbox" name="queuePlatforms" value={platform.key} defaultChecked />
                <PlatformLogo platform={platform.label} size={22} />
                <span>{platform.label}</span>
                <SelectMode name={`${platform.key}BulkScanMode`} defaultValue={platform.defaultMode} tone={platform.key} />
              </label>
            ))}
          </div>

          <div className="keywords-builder-ranges">
            <h3 className="keyword-column-title">Диапазоны подписчиков</h3>
            <span className="keyword-column-note">для новых ключей</span>
            {platforms.map((platform) => (
              <div className="keyword-range-row" key={platform.key}>
                <PlatformLogo platform={platform.label} size={22} />
                <input className="input" name={`${platform.key}MinFollowers`} type="number" min="0" step="100" defaultValue={platform.defaultMin} aria-label={`${platform.label} от`} />
                <input className="input" name={`${platform.key}MaxFollowers`} type="number" min="0" step="1000" defaultValue={platform.defaultMax} aria-label={`${platform.label} до`} />
              </div>
            ))}
          </div>

          <input type="hidden" name="countries" value="RU KZ" />
          <div className="keywords-builder-actions">
            <PendingButton className="button keyword-save-button" pendingText="Добавляем..." type="submit">
              <Icons.Plus size={20} />
              <span>Добавить списком</span>
              <small>сохранить в базу</small>
            </PendingButton>
            <PendingButton className="button primary keyword-run-button" name="queueAfterAdd" value="1" pendingText="Ставим в очередь..." type="submit">
              <Icons.Play size={20} />
              <span>Добавить и запустить</span>
              <small>поставить в очередь</small>
            </PendingButton>
          </div>
        </form>
      </section>

      <section className="keyword-summary-grid">
        <div className="panel keyword-stat-card keyword-stat-wide">
          <div>
            <span className="stat-label">Всего ключей</span>
            <strong>{stats.totalKeywords.toLocaleString("ru-RU")}</strong>
          </div>
          <span className="keyword-stat-icon"><Icons.Search size={22} /></span>
        </div>
        <div className="panel keyword-stat-card keyword-stat-platforms">
          <span className="stat-label">Платформы</span>
          <PlatformCount platform="INSTAGRAM" value={stats.platforms.instagram} />
          <PlatformCount platform="VK" value={stats.platforms.vk} />
          <PlatformCount platform="YOUTUBE" value={stats.platforms.youtube} />
        </div>
        <div className="panel keyword-stat-card">
          <span className="stat-label">Всего запусков</span>
          <strong>{stats.totalJobs.toLocaleString("ru-RU")}</strong>
        </div>
        <div className="panel keyword-stat-card">
          <span className="stat-label">Кандидатов найдено</span>
          <strong>{stats.totalCandidates.toLocaleString("ru-RU")}</strong>
        </div>
        <div className="panel keyword-stat-card keyword-run-statuses">
          <span className="stat-label">Последние запуски</span>
          <StatusDot label="Успешно" value={stats.statuses.success} tone="success" />
          <StatusDot label="Ошибка" value={stats.statuses.failed} tone="error" />
          <StatusDot label="В очереди" value={stats.statuses.queued} tone="queued" />
          <StatusDot label="Выполняется" value={stats.statuses.running} tone="running" />
        </div>
      </section>

      <div className="keywords-workspace">
        <div className="keywords-table-main">
          <section className="panel keyword-filter-panel">
            <form className="keyword-filter-form" action="/keywords">
              <label className="field-label keyword-search-field">
                <span className="sr-only">Поиск</span>
                <span className="keyword-search-input">
                  <Icons.Search size={16} />
                  <input name="q" placeholder="Поиск по ключевому слову или хэштегу" defaultValue={params.q ?? ""} />
                </span>
              </label>
              <label className="field-label">
                Площадка
                <select className="select" name="platform" defaultValue={params.platform ?? "ALL"}>
                  <option value="ALL">Все</option>
                  <option value="instagram">Instagram</option>
                  <option value="vk">VK</option>
                  <option value="youtube">YouTube</option>
                </select>
              </label>
              <label className="field-label">
                Статус последнего сбора
                <select className="select" name="status" defaultValue={params.status ?? "ALL"}>
                  <option value="ALL">Все</option>
                  <option value="SUCCESS">Успешно</option>
                  <option value="RUNNING">Выполняется</option>
                  <option value="QUEUED">В очереди</option>
                  <option value="FAILED">Ошибка</option>
                  <option value="NONE">Не запускался</option>
                </select>
              </label>
              <button className="button" type="submit">
                <Icons.RefreshCw size={15} />
                Применить
              </button>
              <a className="button" href="/keywords">Сбросить фильтры</a>
            </form>
          </section>

          <section className="panel keywords-data-panel">
            {visibleKeywords.length ? (
              <>
                <div className="table-scroll keywords-table-scroll">
                  <table className="table keywords-pro-table">
                    <colgroup>
                      <col className="keyword-col-select" />
                      <col className="keyword-col-name" />
                      <col className="keyword-col-tag" />
                      <col className="keyword-col-platforms" />
                      <col className="keyword-col-ranges" />
                      <col className="keyword-col-found" />
                      <col className="keyword-col-last" />
                      <col className="keyword-col-actions" />
                    </colgroup>
                    <thead>
                      <tr>
                        <th><input type="checkbox" aria-label="Выбрать все ключи" disabled /></th>
                        <th>Ключевое слово</th>
                        <th>Хэштег</th>
                        <th>Площадки</th>
                        <th>Диапазоны</th>
                        <th>Кандидатов найдено</th>
                        <th>Последний сбор</th>
                        <th>Действия</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleKeywords.map((keyword) => {
                        const lastJob = keyword.jobs[0];
                        const hashtag = keyword.hashtags.length ? keyword.hashtags.map((tag) => `#${tag}`).join(", ") : `#${keywordToHashtag(keyword.value)}`;
                        const instagramRange = platformFollowerRange(keyword, "instagram");
                        const vkRange = platformFollowerRange(keyword, "vk");
                        const youtubeRange = platformFollowerRange(keyword, "youtube");

                        return (
                          <tr key={keyword.id}>
                            <td><input type="checkbox" aria-label={`Выбрать ${keyword.value}`} disabled /></td>
                            <td>
                              <div className="keyword-name-cell">
                                <Icons.Star size={14} />
                                <strong>{keyword.value}</strong>
                                {keyword.topic ? <span className="muted">{keyword.topic}</span> : null}
                              </div>
                            </td>
                            <td>
                              <span className="keyword-hashtag-inline">{hashtag}</span>
                              <Icons.CheckCircle2 className="keyword-check" size={14} />
                            </td>
                            <td><PlatformLogos platforms={keyword.platforms} /></td>
                            <td className="keyword-ranges-cell">
                              <KeywordRange platform="Instagram" range={instagramRange} />
                              <KeywordRange platform="VK" range={vkRange} />
                              <KeywordRange platform="YouTube" range={youtubeRange} />
                            </td>
                            <td className="keyword-found-cell">{keyword._count.profiles.toLocaleString("ru-RU")}</td>
                            <td className="keyword-last-run-cell">
                              {lastJob ? (
                                <>
                                  <strong>{formatDateTime(lastJob.createdAt)}</strong>
                                  <span>{platformLabel(lastJob.platform)}</span>
                                  <StatusBadge status={lastJob.status} />
                                </>
                              ) : (
                                <span className="muted">-</span>
                              )}
                            </td>
                            <td>
                              <div className="keyword-table-actions">
                                <RunPlatformIcon keywordId={keyword.id} platform="INSTAGRAM" action={queueInstagramKeywordAction} modeName="instagramScanMode" range={instagramRange} />
                                <RunPlatformIcon keywordId={keyword.id} platform="VK" action={queueVkKeywordAction} modeName="vkScanMode" range={vkRange} />
                                <RunPlatformIcon keywordId={keyword.id} platform="YOUTUBE" action={queueYouTubeKeywordAction} modeName="youtubeScanMode" range={youtubeRange} />
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="keywords-table-footer">
                  <span>Показано {filteredKeywords.length ? pageStart + 1 : 0}-{Math.min(pageStart + visibleKeywords.length, filteredKeywords.length)} из {filteredKeywords.length.toLocaleString("ru-RU")} ключей</span>
                  {totalPages > 1 ? (
                    <div className="keyword-pagination">
                      {currentPage <= 1 ? (
                        <span className="button icon-button disabled" aria-disabled="true">‹</span>
                      ) : (
                        <a className="button icon-button" href={pageHref(params, currentPage - 1)}>‹</a>
                      )}
                      {paginationItems(currentPage, totalPages).map((item, index) => item === "gap" ? (
                        <span className="keyword-page-gap" key={`gap-${index}`}>...</span>
                      ) : item === currentPage ? (
                        <strong key={item}>{item}</strong>
                      ) : (
                        <a key={item} href={pageHref(params, item)}>{item}</a>
                      ))}
                      {currentPage >= totalPages ? (
                        <span className="button icon-button disabled" aria-disabled="true">›</span>
                      ) : (
                        <a className="button icon-button" href={pageHref(params, currentPage + 1)}>›</a>
                      )}
                    </div>
                  ) : (
                    <span />
                  )}
                  <label className="keyword-page-size">
                    Показывать по
                    <select className="select" disabled defaultValue="20"><option>20</option></select>
                  </label>
                </div>
              </>
            ) : (
              <div className="empty-state">
                <h2 className="panel-title">Ключевых слов по фильтрам нет</h2>
                <p className="muted">Добавьте список запросов или сбросьте фильтры.</p>
              </div>
            )}
          </section>
        </div>

        <aside className="keywords-side-panel">
          <form action={queueAllKeywordsAction} className="panel keyword-mass-launch">
            <div className="keyword-side-icon success"><Icons.Zap size={20} /></div>
            <h2 className="panel-title">Массовый запуск</h2>
            <p className="muted">Запустить сборы по всем выбранным ключам</p>
            <input type="hidden" name="platforms" value="instagram" />
            <input type="hidden" name="platforms" value="vk" />
            <input type="hidden" name="platforms" value="youtube" />
            <input type="hidden" name="instagramBulkScanMode" value="deep" />
            <input type="hidden" name="vkBulkScanMode" value="deep" />
            <input type="hidden" name="youtubeBulkScanMode" value="deep" />
            <label className="keyword-side-checkbox">
              <input type="checkbox" name="onlyUncollected" value="1" defaultChecked />
              <span>Только без прошлых сборов</span>
            </label>
            <PendingButton className="button primary keyword-launch-all" pendingText="Ставим в очередь..." type="submit">
              Запустить по всем
            </PendingButton>
          </form>

          <section className="panel keyword-side-actions keyword-hint-box">
            <Icons.Info size={18} />
            <div>
              <strong>Подсказка</strong>
              <p>У каждой платформы свои диапазоны и режимы сбора. Запускайте отдельно для лучшего результата.</p>
            </div>
          </section>
        </aside>
      </div>

      <form action={addKeywordAction} className="keyword-single-hidden-form" aria-label="Быстрое добавление одного ключа">
        <input className="input" name="value" placeholder="Один ключ быстро" />
        <input type="hidden" name="instagramMinFollowers" value={defaultFollowerRanges.instagram.min} />
        <input type="hidden" name="instagramMaxFollowers" value={defaultFollowerRanges.instagram.max} />
        <input type="hidden" name="vkMinFollowers" value={defaultFollowerRanges.vk.min} />
        <input type="hidden" name="vkMaxFollowers" value={defaultFollowerRanges.vk.max} />
        <input type="hidden" name="youtubeMinFollowers" value={defaultFollowerRanges.youtube.min} />
        <input type="hidden" name="youtubeMaxFollowers" value={defaultFollowerRanges.youtube.max} />
        <PendingButton className="button" pendingText="Добавляем..." type="submit">Добавить один</PendingButton>
      </form>
    </div>
  );
}

function SelectMode({ name, defaultValue = "deep", tone }: { name: string; defaultValue?: "quick" | "deep" | "continuous"; tone?: string }) {
  return (
    <select className={`select compact-select keyword-mode-select ${tone ?? ""}`} name={name} defaultValue={defaultValue}>
      <option value="quick">Быстрый</option>
      <option value="deep">Глубокий</option>
      <option value="continuous">Осторожный</option>
    </select>
  );
}

function RunPlatformIcon({
  keywordId,
  platform,
  action,
  modeName,
  range
}: {
  keywordId: string;
  platform: "INSTAGRAM" | "VK" | "YOUTUBE";
  action: (formData: FormData) => Promise<void>;
  modeName: string;
  range: { minFollowers: number; maxFollowers: number };
}) {
  return (
    <form action={action} className="inline-form">
      <input type="hidden" name="keywordId" value={keywordId} />
      <input type="hidden" name={modeName} value="deep" />
      <input type="hidden" name="minFollowers" value={range.minFollowers} />
      <input type="hidden" name="maxFollowers" value={range.maxFollowers} />
      <PendingButton className="button keyword-platform-button" pendingText="" type="submit" title={`Запустить ${platformLabel(platform)}`}>
        <PlatformLogo platform={platform} size={20} />
      </PendingButton>
    </form>
  );
}

function PlatformLogos({ platforms: values }: { platforms: string[] }) {
  const active = new Set(values.map((value) => value.toLowerCase()));
  return (
    <div className="keyword-platform-logos">
      {platforms.map((platform) => (
        <span className={active.has(platform.key) ? "" : "disabled"} key={platform.key}>
          <PlatformLogo platform={platform.label} size={22} />
        </span>
      ))}
    </div>
  );
}

function PlatformCount({ platform, value }: { platform: string; value: number }) {
  return (
    <span className="keyword-platform-count">
      <PlatformLogo platform={platform} size={24} />
      <strong>{value.toLocaleString("ru-RU")}</strong>
    </span>
  );
}

function KeywordRange({ platform, range }: { platform: string; range: { minFollowers: number; maxFollowers: number } }) {
  return (
    <span className="keyword-range-chip">
      <PlatformLogo platform={platform} size={16} />
      <span>{rangeLabel(range)}</span>
    </span>
  );
}

function StatusDot({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <span className={`keyword-status-dot ${tone}`}>
      <i />
      <span>{label}</span>
      <strong>{value.toLocaleString("ru-RU")}</strong>
    </span>
  );
}

function buildKeywordStats(keywords: Awaited<ReturnType<typeof getKeywords>>) {
  const stats = {
    totalKeywords: keywords.length,
    totalJobs: 0,
    totalCandidates: 0,
    platforms: { instagram: 0, vk: 0, youtube: 0 },
    statuses: { success: 0, failed: 0, queued: 0, running: 0 }
  };

  for (const keyword of keywords) {
    stats.totalCandidates += keyword._count.profiles;
    for (const platform of keyword.platforms) {
      const key = platform.toLowerCase() as PlatformKey;
      if (key in stats.platforms) stats.platforms[key] += 1;
    }
    for (const job of keyword.jobs) {
      stats.totalJobs += 1;
      if (job.status === "SUCCESS") stats.statuses.success += 1;
      if (job.status === "FAILED" || job.status === "BLOCKED") stats.statuses.failed += 1;
      if (job.status === "QUEUED") stats.statuses.queued += 1;
      if (job.status === "RUNNING") stats.statuses.running += 1;
    }
  }
  return stats;
}

function filterKeywords(keywords: Awaited<ReturnType<typeof getKeywords>>, params: SearchParams) {
  const query = (params.q ?? "").trim().toLocaleLowerCase("ru-RU");
  const platform = (params.platform ?? "ALL").toLowerCase();
  const status = params.status ?? "ALL";

  return keywords.filter((keyword) => {
    const hashtagText = keyword.hashtags.map((tag) => `#${tag}`).join(" ");
    const queryMatch = !query || `${keyword.value} ${hashtagText}`.toLocaleLowerCase("ru-RU").includes(query);
    const platformMatch = platform === "all" || keyword.platforms.map((item) => item.toLowerCase()).includes(platform);
    const lastStatus = keyword.jobs[0]?.status ?? "NONE";
    const statusMatch = status === "ALL" || lastStatus === status;
    return queryMatch && platformMatch && statusMatch;
  });
}

function normalizePage(value: string | undefined, totalPages: number) {
  const page = Number(value);
  if (!Number.isFinite(page) || page < 1) return 1;
  return Math.min(Math.floor(page), totalPages);
}

function shouldRedirectPageParam(value: string | undefined, currentPage: number) {
  if (!value) return false;
  const page = Number(value);
  if (!Number.isFinite(page) || page < 1) return true;
  return Math.floor(page) !== currentPage || currentPage === 1 || value !== String(Math.floor(page));
}

function paginationItems(currentPage: number, totalPages: number) {
  const pages = new Set([1, totalPages, currentPage - 1, currentPage, currentPage + 1]);
  const items: Array<number | "gap"> = [];
  let previous = 0;
  for (const page of [...pages].filter((item) => item >= 1 && item <= totalPages).sort((a, b) => a - b)) {
    if (previous && page - previous > 1) items.push("gap");
    items.push(page);
    previous = page;
  }
  return items;
}

function pageHref(params: SearchParams, page: number) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (key !== "page" && value) query.set(key, value);
  }
  if (page > 1) query.set("page", String(page));
  const text = query.toString();
  return text ? `/keywords?${text}` : "/keywords";
}

function rangeLabel(range: { minFollowers: number; maxFollowers: number }) {
  return `${compactNumber(range.minFollowers)}-${compactNumber(range.maxFollowers)}`;
}

function compactNumber(value: number) {
  if (value >= 1_000_000) return `${Math.round(value / 1_000_000)}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}K`;
  return value.toLocaleString("ru-RU");
}

function platformLabel(value: string) {
  if (value === "INSTAGRAM" || value === "instagram") return "Instagram";
  if (value === "VK" || value === "vk") return "VK";
  if (value === "YOUTUBE" || value === "youtube") return "YouTube";
  return value;
}

function keywordToHashtag(value: string) {
  return value
    .trim()
    .replace(/^#/, "")
    .toLocaleLowerCase("ru-RU")
    .replace(/[^\p{L}\p{N}_]+/gu, "");
}
