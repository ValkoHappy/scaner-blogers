import Link from "next/link";
import { AutoFilterForm } from "@/components/auto-filter-form";
import { formatDateTime } from "@/components/display";
import { Icons } from "@/components/icons";
import { PendingButton } from "@/components/pending-button";
import { PlatformLogo } from "@/components/platform-logo";
import { PageHeader, StatusBadge } from "@/components/shell";
import { candidateStatusLabels, reviewCandidateStatuses, type CandidateStatusValue } from "@/lib/candidate-status";
import { getCandidateProfiles } from "@/lib/data";
import { updateCandidateStatusAction } from "./actions";

type SearchParams = Record<string, string | undefined>;
type PlatformFilter = "ALL" | "INSTAGRAM" | "VK" | "YOUTUBE";

const platforms: Array<{ value: PlatformFilter; label: string; hint: string }> = [
  { value: "ALL", label: "Все", hint: "общая база" },
  { value: "INSTAGRAM", label: "Instagram", hint: "аккаунты, reels, хэштеги" },
  { value: "VK", label: "VK", hint: "профили и группы" },
  { value: "YOUTUBE", label: "YouTube", hint: "каналы, видео, shorts" }
];

export default async function CandidatesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const activePlatform = platformParam(params.platform);
  const profiles = await getCandidateProfiles({
    status: params.status,
    platform: activePlatform,
    q: params.q,
    matchedBy: params.matchedBy,
    minFollowers: params.minFollowers,
    maxFollowers: params.maxFollowers,
    minAvgViews: params.minAvgViews,
    minAvgLikes: params.minAvgLikes,
    minScore: params.minScore,
    exported: params.exported
  });
  const exportQuery = new URLSearchParams(Object.entries(params).filter((entry): entry is [string, string] => Boolean(entry[1]))).toString();
  const exportSuffix = exportQuery ? `?${exportQuery}` : "";
  const filterKey = exportQuery || "empty";

  return (
    <div className="grid">
      <PageHeader title="Кандидаты" subtitle="Единая база найденных блогеров, ручная оценка и выгрузка в CSV/Excel. Instagram, VK и YouTube можно смотреть раздельно.">
        <a className="button" href={`/api/export/candidates.csv${exportSuffix}`}>
          <Icons.Download size={16} />
          Экспорт CSV
        </a>
        <a className="button primary" href={`/api/export/candidates.xlsx${exportSuffix}`}>
          <Icons.Download size={16} />
          Excel
        </a>
      </PageHeader>

      <nav className="platform-tabs" aria-label="Фильтр площадки">
        {platforms.map((platform) => (
          <Link
            key={platform.value}
            className={`platform-tab ${activePlatform === platform.value ? "active" : ""}`}
            href={platformHref("/candidates", params, platform.value)}
            scroll={false}
            prefetch
          >
            <span className={`platform-tab-icon ${platform.value.toLowerCase()}`}>
              {platform.value === "ALL" ? platformIcon(platform.value) : <PlatformLogo platform={platform.value} size={24} />}
            </span>
            <span className="platform-tab-copy">
              <strong>{platform.label}</strong>
              <span>{platform.hint}</span>
            </span>
          </Link>
        ))}
      </nav>

      <section key={filterKey} className="panel compact-panel candidates-filter-panel">
        <AutoFilterForm className="candidates-filter-grid" autoSubmit={false} showStatus={false}>
          <label className="field-label compact">
            Площадка
            <select className="select" name="platform" defaultValue={activePlatform}>
              {platforms.map((platform) => (
                <option key={platform.value} value={platform.value}>{platform.label}</option>
              ))}
            </select>
          </label>
          <label className="field-label compact">
            Экспорт
            <select className="select" name="exported" defaultValue={params.exported ?? "ALL"}>
              <option value="ALL">Все</option>
              <option value="NO">Не экспортированы</option>
              <option value="YES">Экспортированы</option>
            </select>
          </label>
          <label className="field-label wide">
            Поиск
            <input className="input" name="q" placeholder="Ник, имя, био, тег" defaultValue={params.q ?? ""} />
          </label>
          <label className="field-label compact">
            Статус
            <select className="select" name="status" defaultValue={params.status ?? "ALL"}>
              <option value="ALL">Все</option>
              {reviewCandidateStatuses.map((status) => (
                <option key={status} value={status}>{candidateStatusLabels[status]}</option>
              ))}
            </select>
          </label>
          <label className="field-label compact">
            Источник
            <select className="select" name="matchedBy" defaultValue={params.matchedBy ?? "ALL"}>
              <option value="ALL">Все</option>
              <option value="hashtag_reels">Instagram reels по хэштегу</option>
              <option value="keyword_reels">Instagram reels по поиску</option>
              <option value="account_serp_search">Instagram поиск аккаунтов</option>
              <option value="typeahead_search">Instagram подсказки</option>
              <option value="user_search">Instagram поиск пользователей</option>
              <option value="vk_groups_search">VK группы</option>
              <option value="youtube_channel_search">YouTube каналы</option>
              <option value="youtube_shorts_search">YouTube Shorts</option>
              <option value="youtube_video_search">YouTube видео</option>
            </select>
          </label>
          <label className="field-label compact">
            Подписчики от
            <input className="input" name="minFollowers" inputMode="numeric" defaultValue={params.minFollowers ?? ""} />
          </label>
          <label className="field-label compact">
            Подписчики до
            <input className="input" name="maxFollowers" inputMode="numeric" defaultValue={params.maxFollowers ?? ""} />
          </label>
          <label className="field-label compact">
            Просмотры от
            <input className="input" name="minAvgViews" inputMode="numeric" defaultValue={params.minAvgViews ?? ""} />
          </label>
          <label className="field-label compact">
            Лайки от
            <input className="input" name="minAvgLikes" inputMode="numeric" defaultValue={params.minAvgLikes ?? ""} />
          </label>
          <label className="field-label compact">
            Score от
            <input className="input" name="minScore" inputMode="numeric" defaultValue={params.minScore ?? ""} />
          </label>
          <div className="candidates-filter-actions">
            <button className="button primary" type="submit">
              <Icons.RefreshCw size={16} />
              Применить
            </button>
            <Link className="button" href="/candidates" scroll={false}>
              Сброс
            </Link>
          </div>
        </AutoFilterForm>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2 className="panel-title">Профили кандидатов: {profiles.length.toLocaleString("ru-RU")}</h2>
            <div className="muted chart-subtitle">Дубли режутся по паре площадка + ID профиля. Один и тот же человек в разных соцсетях остается отдельными карточками.</div>
          </div>
        </div>
        <div className="table-scroll">
          <form id="candidate-bulk-status-form" className="candidate-bulk-actions" action={updateCandidateStatusAction}>
            <label className="field-label compact">
              Отметить выбранных как
              <select className="select" name="status" defaultValue="REVIEWED">
                {reviewCandidateStatuses.filter((status) => status !== "NEW").map((status) => (
                  <option key={status} value={status}>{candidateStatusLabels[status]}</option>
                ))}
              </select>
            </label>
            <PendingButton className="button primary" pendingText="Сохраняю..." type="submit">
              Применить
            </PendingButton>
            <PendingButton className="button" name="intent" value="mark_exported" pendingText="Отмечаю..." type="submit">
              Отметить экспортированными
            </PendingButton>
            <span className="muted">Выберите кандидатов галочками. Отметка экспорта не меняет статус.</span>
          </form>
          <table className="table candidate-platform-table">
            <thead>
              <tr>
                <th>Выбор</th>
                <th>Профиль</th>
                <th>Площадка</th>
                <th>Подписчики</th>
                <th>Score</th>
                <th>Контакты</th>
                <th>Активность</th>
                <th>Описание</th>
                <th>Источник</th>
                <th>Найден</th>
                <th>Оценка</th>
              </tr>
            </thead>
            <tbody>
              {profiles.map((profile) => {
                const contacts = contactsSummary(profile.contacts);
                const metrics = metricsSummary(profile.metrics);
                return (
                  <tr key={profile.id}>
                    <td>
                      <input className="candidate-select-checkbox" form="candidate-bulk-status-form" type="checkbox" name="candidateId" value={profile.candidateId} aria-label={`Выбрать ${profile.username}`} />
                    </td>
                    <td>
                      <div className="candidate-profile-cell">
                        <div className="candidate-profile-main">
                          <strong>
                            <a href={profile.profileUrl} target="_blank" rel="noreferrer">{profile.displayName || profile.username}</a>
                          </strong>
                          <div className="muted">@{profile.username}</div>
                          <a className="candidate-profile-url" href={profile.profileUrl} target="_blank" rel="noreferrer">{shortProfileUrl(profile.profileUrl)}</a>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className={`platform-badge ${profile.platform.toLowerCase()}`}>
                        <PlatformLogo platform={profile.platform} size={24} />
                      </span>
                      <div className="muted platform-hint">{platformDataHint(profile.platform)}</div>
                    </td>
                    <td>{profile.followers.toLocaleString("ru-RU")}</td>
                    <td>
                      <strong className={`candidate-score-pill ${scoreTone(profile.qualityScore)}`}>{profile.qualityScore}</strong>
                      <div className="muted candidate-score-signals">{qualitySignalsSummary(profile.qualitySignals)}</div>
                    </td>
                    <td className="candidate-contacts-cell">{contacts || <span className="muted">не найдены</span>}</td>
                    <td>{metrics || <span className="muted">нет данных</span>}</td>
                    <td className="candidate-bio-cell">{profile.bio ? shortText(profile.bio, 150) : <span className="muted">без описания</span>}</td>
                    <td>
                      {profile.keyword ? <Link href="/keywords">{profile.keyword.value}</Link> : profile.sourceKeyword || "-"}
                      {profile.sourceTag ? <div className="muted">#{profile.sourceTag}</div> : null}
                      {profile.matchedBy ? <div className="muted">{matchedByLabel(profile.matchedBy)}</div> : null}
                    </td>
                    <td>{formatDateTime(profile.lastCollectedAt)}</td>
                    <td>
                      <div className="candidate-status-cell">
                        <StatusBadge status={profile.candidate.status} />
                        <div className="candidate-status-meta">
                          {profile.candidate.reviewedAt ? `просмотр ${formatDateTime(profile.candidate.reviewedAt)}` : "не просмотрен"}
                          {profile.candidate.exportedAt ? <span>экспорт {formatDateTime(profile.candidate.exportedAt)}</span> : null}
                        </div>
                        <div className="candidate-actions">
                          <CandidateStatusButton candidateId={profile.candidateId} status="REVIEWED" label="Просмотрен" currentStatus={profile.candidate.status} />
                          <CandidateStatusButton candidateId={profile.candidateId} status="PRIORITY" label="Приоритет" currentStatus={profile.candidate.status} />
                          <CandidateStatusButton candidateId={profile.candidateId} status="REJECTED" label="Не подходит" currentStatus={profile.candidate.status} />
                        </div>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!profiles.length ? (
            <div className="empty-state">
              <h2 className="panel-title">Кандидатов пока нет</h2>
              <p className="muted">Добавьте ключевое слово, поставьте сбор нужной площадки в очередь и запустите сборщик.</p>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function CandidateStatusButton({
  candidateId,
  status,
  label,
  currentStatus
}: {
  candidateId: string;
  status: Exclude<CandidateStatusValue, "NEW">;
  label: string;
  currentStatus: string;
}) {
  return (
    <form action={updateCandidateStatusAction}>
      <input type="hidden" name="candidateId" value={candidateId} />
      <input type="hidden" name="status" value={status} />
      <PendingButton className="button candidate-action-button" disabled={currentStatus === status} pendingText="..." type="submit">
        {label}
      </PendingButton>
    </form>
  );
}

function platformParam(value?: string): PlatformFilter {
  if (value === "INSTAGRAM" || value === "VK" || value === "YOUTUBE") return value;
  return "ALL";
}

function platformHref(path: string, params: SearchParams, platform: PlatformFilter) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (!value || key === "platform") continue;
    query.set(key, value);
  }
  if (platform !== "ALL") query.set("platform", platform);
  const text = query.toString();
  return text ? `${path}?${text}` : path;
}

function platformIcon(value: PlatformFilter) {
  if (value === "INSTAGRAM") return "IG";
  if (value === "VK") return "VK";
  if (value === "YOUTUBE") return "YT";
  return "Все";
}

function platformDataHint(value: string) {
  if (value === "INSTAGRAM") return "reels / аккаунт";
  if (value === "VK") return "группа / профиль";
  if (value === "YOUTUBE") return "канал / shorts";
  return "профиль";
}

function shortProfileUrl(value: string) {
  return value
    .replace(/^https?:\/\/(www\.)?/i, "")
    .replace(/\/$/, "");
}

function scoreTone(value: number) {
  if (value >= 70) return "good";
  if (value >= 40) return "medium";
  return "low";
}

function shortText(value: string, maxLength: number) {
  const compact = value.replace(/\s+/g, " ").trim();
  const chars = Array.from(compact);
  return chars.length > maxLength ? `${chars.slice(0, maxLength - 1).join("").trim()}…` : compact;
}

function contactsSummary(value: unknown) {
  if (!value || typeof value !== "object") return "";
  const contacts = value as { emails?: unknown; phones?: unknown; urls?: unknown };
  const parts = [
    ...stringList(contacts.emails),
    ...stringList(contacts.phones),
    ...stringList(contacts.urls)
  ];
  return parts.slice(0, 3).join(", ");
}

function metricsSummary(value: unknown) {
  if (!value || typeof value !== "object") return "";
  const metrics = value as { avgLikes?: unknown; avgComments?: unknown; avgViews?: unknown; postsChecked?: unknown };
  const parts = [];
  if (typeof metrics.avgViews === "number" && metrics.avgViews > 0) parts.push(`просм. ${Math.round(metrics.avgViews).toLocaleString("ru-RU")}`);
  if (typeof metrics.avgLikes === "number" && metrics.avgLikes > 0) parts.push(`лайки ${Math.round(metrics.avgLikes).toLocaleString("ru-RU")}`);
  if (typeof metrics.avgComments === "number" && metrics.avgComments > 0) parts.push(`комм. ${Math.round(metrics.avgComments).toLocaleString("ru-RU")}`);
  if (typeof metrics.postsChecked === "number") parts.push(`постов ${metrics.postsChecked}`);
  return parts.join(", ");
}

function qualitySignalsSummary(value: unknown) {
  const labels: Record<string, string> = {
    followers_in_range: "диапазон",
    followers_near_range: "рядом",
    has_contacts: "контакты",
    has_recent_posts: "посты",
    has_activity: "активность",
    bio_keyword_match: "био",
    has_source_tag: "тег",
    has_geo_guess: "гео"
  };
  return stringList(value)
    .map((signal) => labels[signal])
    .filter(Boolean)
    .slice(0, 3)
    .join(", ");
}

function matchedByLabel(value: string) {
  const labels: Record<string, string> = {
    hashtag_reels: "Instagram reels по хэштегу",
    keyword_reels: "Instagram reels по поиску",
    account_serp_search: "Instagram поиск аккаунтов",
    typeahead_search: "Instagram подсказки поиска",
    user_search: "Instagram поиск пользователей",
    vk_groups_search: "VK группы",
    youtube_channel_search: "YouTube каналы",
    youtube_shorts_search: "YouTube Shorts",
    youtube_video_search: "YouTube видео"
  };
  return labels[value] ?? value;
}

function stringList(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())) : [];
}
