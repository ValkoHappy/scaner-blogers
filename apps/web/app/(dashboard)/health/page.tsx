import Link from "next/link";
import { formatDateTime, formatScanMessage, formatStatusLabel } from "@/components/display";
import { PageHeader, StatusBadge } from "@/components/shell";
import { getSystemStatusData } from "@/lib/data";

const socialPlatforms = ["INSTAGRAM", "VK", "YOUTUBE"] as const;
type SystemStatusData = Awaited<ReturnType<typeof getSystemStatusData>>;
type SocialAccountStatus = SystemStatusData["socialAccounts"][number];

export default async function HealthPage() {
  const system = await getSystemStatusData();
  const readyCredentials = system.socialCredentialReadiness.filter((item) => item.status === "READY").length;
  const weakCredentials = system.socialCredentialReadiness.filter((item) => item.status !== "READY").length;
  const platformProblems = buildPlatformProblems(system);
  const accountAttentionCount = platformProblems.length;
  const hasPendingWork = system.socialQueue.queued > 0 || system.socialQueue.running > 0;
  const workerOk = system.workerOnline || !hasPendingWork;
  return (
    <div className="health-screen">
      <PageHeader title="Здоровье системы" subtitle="Очереди сборов, доступы, аккаунты и качество поисковых запросов" />

      <section className="panel scan-summary-panel health-summary-panel">
        <HealthMetric label="Воркер" value={system.workerOnline ? "работает" : hasPendingWork ? "не отвечает" : "ожидает задач"} status={workerOk ? "SUCCESS" : "FAILED"} hint={system.workerMessage ? formatScanMessage(system.workerMessage) : `последний сигнал ${formatDateTime(system.workerLastSeenAt)}`} />
        <HealthMetric label="Очередь сборов" value={`${system.socialQueue.queued} в очереди`} status={system.socialQueue.running > 0 ? "RUNNING" : system.socialQueue.queued > 0 ? "QUEUED" : "SUCCESS"} hint={`${system.socialQueue.running} в работе · ${system.socialQueue.failed} с ошибкой`} />
        <HealthMetric label="Доступы" value={`${readyCredentials}/${system.socialCredentialReadiness.length} готовы`} status={accountAttentionCount > 0 || weakCredentials > 0 ? "BLOCKED" : "SUCCESS"} hint={accountAttentionCount > 0 ? `${accountAttentionCount} требуют внимания` : weakCredentials > 0 ? `${weakCredentials} требуют внимания` : "Instagram, VK и YouTube настроены"} />
        <HealthMetric label="Кандидаты" value={String(system.candidateProfiles)} status="SUCCESS" hint={`${system.rawSocialSnapshots} сырых снимков`} />
      </section>

      <section className={`panel compact-panel platform-problems-panel ${platformProblems.length ? "has-problems" : ""}`}>
        <div className="panel-header">
          <div>
            <h2 className="panel-title">Проблемы платформ</h2>
            <p className="muted compact-note">Здесь видно, почему сбор не идет по VK, Instagram или YouTube, и что нужно сделать.</p>
          </div>
          <Link className="button secondary" href="/scans">Открыть сборы</Link>
        </div>
        {platformProblems.length ? (
          <div className="platform-problem-list">
            {platformProblems.map((problem, index) => (
              <div className="platform-problem-row" key={`${problem.key}:${problem.platform}:${index}`}>
                <strong>{problem.platform}</strong>
                <StatusBadge status={problem.status} />
                <div>
                  <div>{problem.title}</div>
                  <div className="muted truncate">{problem.detail}</div>
                </div>
                <div className="platform-problem-action">{problem.action}</div>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted compact-note">Критичных проблем по платформам сейчас не видно.</p>
        )}
      </section>

      <div className="settings-layout health-layout">
        <div className="settings-column">
          <section className="panel compact-panel">
            <div className="panel-header">
              <h2 className="panel-title">Потоки по платформам</h2>
            </div>
            <div className="proxy-health-list">
              {socialPlatforms.map((platform) => {
                const running = laneCount(system.socialLanes.running, platform);
                const queued = laneCount(system.socialLanes.queued, platform);
                return (
                  <div className="proxy-health-row" key={platform}>
                    <strong>{platform}</strong>
                    <StatusBadge status={running > 0 ? "RUNNING" : queued > 0 ? "QUEUED" : "SUCCESS"} />
                    <span className="muted">в работе {running}</span>
                    <span className="muted">в очереди {queued}</span>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="panel compact-panel">
            <div className="panel-header">
              <h2 className="panel-title">Готовность доступов</h2>
            </div>
            <div className="proxy-health-list">
              {system.socialCredentialReadiness.map((item) => (
                <div className="proxy-health-row" key={item.platform}>
                  <strong>{item.platform}</strong>
                  <StatusBadge status={item.status === "READY" ? "SUCCESS" : item.status === "WEAK" ? "BLOCKED" : "FAILED"} />
                  <span className="muted">{item.source}</span>
                  <span className="muted">{item.missing.length ? `не хватает ${item.missing.join(", ")}` : "настроено"}</span>
                  <span className="muted truncate">{item.notes.join("; ")}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="panel compact-panel">
            <div className="panel-header">
              <h2 className="panel-title">Целостность сборов</h2>
            </div>
            <div className="proxy-health-list">
              <div className="proxy-health-row">
                <strong>Последние задачи</strong>
                <StatusBadge status={system.socialIntegrity.errors > 0 ? "FAILED" : system.socialIntegrity.warnings > 0 ? "BLOCKED" : "SUCCESS"} />
                <span className="muted">проверено {system.socialIntegrity.checkedJobs}</span>
                <span className="muted">ошибки {system.socialIntegrity.errors}</span>
                <span className="muted">предупреждения {system.socialIntegrity.warnings}</span>
              </div>
              {system.socialIntegrity.issues.slice(0, 5).map((issue, index) => (
                <div className="proxy-health-row" key={`${issue.code}:${issue.jobId ?? ""}:${issue.runId ?? ""}:${index}`}>
                  <strong>{issue.level}</strong>
                  <StatusBadge status={issue.level === "error" ? "FAILED" : "BLOCKED"} />
                  <span className="muted">{issue.code}</span>
                  <span className="muted">{issue.platform ?? "платформа ?"}</span>
                  <span className="muted truncate">{issue.message}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="panel compact-panel">
            <div className="panel-header">
              <h2 className="panel-title">Платформенные аккаунты</h2>
            </div>
            {system.socialAccounts.length ? (
              <div className="proxy-health-list">
                {system.socialAccounts.map((account, index) => (
                  <div className="proxy-health-row" key={`${account.id}:${index}`}>
                    <strong>{account.platform}</strong>
                    <StatusBadge status={account.status === "OK" ? "SUCCESS" : account.status} />
                    <span className="muted">{account.username ?? account.accountKey}</span>
                    <span className="muted">ошибок {account.consecutiveErrors}</span>
                    <span className="muted">{account.blockedUntil ? `до ${formatDateTime(account.blockedUntil)}` : "без паузы"}</span>
                    {account.lastError ? <span className="muted truncate">{formatScanMessage(account.lastError)}</span> : null}
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted compact-note">Истории платформенных аккаунтов пока нет.</p>
            )}
          </section>

          <section className="panel compact-panel">
            <div className="panel-header">
              <h2 className="panel-title">Последние сборы</h2>
              <Link className="button secondary" href="/scans">Открыть очередь</Link>
            </div>
            <div className="settings-list">
              <HealthRow label="Последний сбор блогеров" value={system.lastCollectionJob ? `${system.lastCollectionJob.platform} · ${formatStatusLabel(system.lastCollectionJob.status)} · ${formatDateTime(system.lastCollectionJob.updatedAt)}` : "нет данных"} />
              <HealthRow label="Последний успех" value={formatDateTime(system.lastSuccessAt)} />
              <HealthRow label="Очередь сборов" value={`${system.socialQueue.queued} в очереди · ${system.socialQueue.running} в работе · ${system.socialQueue.failed} с ошибкой`} />
            </div>
          </section>
        </div>

        <div className="settings-column">
          <section className="panel compact-panel">
            <div className="panel-header">
              <h2 className="panel-title">Качество ключей</h2>
              <Link className="button secondary" href="/keywords">Ключи</Link>
            </div>
            {system.socialKeywordQuality.length ? (
              <div className="proxy-health-list">
                {system.socialKeywordQuality.map((row, index) => (
                  <div className="proxy-health-row" key={`${row.keywordId}:${row.platform}:${index}`}>
                    <span>{row.platform}</span>
                    <strong>{row.keyword}</strong>
                    <span className="muted">score {row.avgQualityScore}</span>
                    <span className="muted">кандидаты {row.candidates}</span>
                    <span className="muted">проверено {row.profilesChecked}</span>
                    <span className="muted">конверсия {row.acceptanceRate ?? "?"}%</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted compact-note">Пока нет данных по качеству ключей.</p>
            )}
          </section>

          <section className="panel compact-panel">
            <div className="panel-header">
              <h2 className="panel-title">История поиска</h2>
            </div>
            {system.socialSearchHistory.length ? (
              <div className="proxy-health-list">
                {system.socialSearchHistory.map((row, index) => (
                  <div className="proxy-health-row" key={`${row.platform}:${row.query}:${row.queryType}:${row.regionCode}:${index}`}>
                    <span>{row.platform}</span>
                    <strong>{row.query}</strong>
                    <span className="muted">{row.queryType}</span>
                    <span className="muted">{row.regionCode}</span>
                    <span className="muted">запусков {row.searches}</span>
                    <span className="muted">найдено {row.lastItemsFound ?? "?"}</span>
                    <span className="muted">проверено {row.lastProfilesChecked ?? "?"}</span>
                    <span className="muted">{formatDateTime(row.lastSearchedAt)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted compact-note">Поисковые запросы ещё не записывались.</p>
            )}
          </section>

          <section className="panel compact-panel">
            <div className="panel-header">
              <h2 className="panel-title">Данные и обслуживание</h2>
            </div>
            <div className="settings-list">
              <HealthRow label="Профили кандидатов" value={String(system.candidateProfiles)} />
              <HealthRow label="Сырые снимки соцсетей" value={String(system.rawSocialSnapshots)} />
              <HealthRow label="Проверено задач" value={String(system.socialIntegrity.checkedJobs)} />
              <HealthRow label="Ошибок целостности" value={String(system.socialIntegrity.errors)} />
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function buildPlatformProblems(system: SystemStatusData) {
  const problems = system.socialAccounts
    .filter((account) => account.status !== "OK" && account.status !== "RUNNING")
    .map((account) => accountProblem(account));

  if (!system.workerOnline && (system.socialQueue.queued > 0 || system.socialQueue.running > 0)) {
    problems.unshift({
      key: "worker",
      platform: "Worker",
      status: "FAILED",
      title: system.socialQueue.running > 0 ? "Сборщик не отвечает во время работы" : "Задачи стоят в очереди, но worker не активен",
      detail: `Статус worker: ${system.workerStatus}. В очереди: ${system.socialQueue.queued}, выполняется: ${system.socialQueue.running}.`,
      action: "Проверить сервис worker на сервере или запустить локальный worker."
    });
  }

  return problems;
}

function accountProblem(account: SocialAccountStatus) {
  const error = formatScanMessage(account.lastError ?? "");
  const lowerError = error.toLowerCase();
  const cooldown = account.blockedUntil ? ` Пауза до ${formatDateTime(account.blockedUntil)}.` : "";
  return {
    key: account.accountKey,
    platform: platformLabel(account.platform),
    status: account.status,
    title: accountProblemTitle(account, lowerError),
    detail: `${error || "Последняя ошибка не записана."}${cooldown}`,
    action: accountProblemAction(account, lowerError)
  };
}

function accountProblemTitle(account: SocialAccountStatus, lowerError: string) {
  if (account.platform === "VK" && lowerError.includes("another ip address")) {
    return "VK токен привязан к другому IP";
  }
  if (account.platform === "INSTAGRAM" && lowerError.includes("login_required")) {
    return "Instagram просит заново войти в аккаунт";
  }
  if (account.platform === "INSTAGRAM" && account.status === "BLOCKED") {
    return "Instagram аккаунт на паузе после ограничения";
  }
  if (account.platform === "YOUTUBE" && lowerError.includes("quota")) {
    return "YouTube уперся в квоту API";
  }
  if (account.platform === "YOUTUBE" && lowerError.includes("scrapetube")) {
    return "YouTube fallback не видел локальный репозиторий";
  }
  return `${platformLabel(account.platform)} требует внимания`;
}

function accountProblemAction(account: SocialAccountStatus, lowerError: string) {
  if (account.platform === "VK" && lowerError.includes("another ip address")) {
    return "Обновить VK токен именно с серверного IP или завести серверный OAuth flow.";
  }
  if (account.platform === "INSTAGRAM") {
    return "Не добивать аккаунт, дождаться паузы и пройти вход/проверку в Instagram.";
  }
  if (account.platform === "YOUTUBE" && lowerError.includes("quota")) {
    return "Дождаться сброса квоты или добавить новый YouTube API key.";
  }
  if (account.platform === "YOUTUBE") {
    return "Запустить контрольный YouTube сбор, статус очистится автоматически после успешного прохода.";
  }
  return "Открыть логи сборов и обновить доступы в настройках.";
}

function HealthMetric({
  label,
  value,
  status,
  hint
}: {
  label: string;
  value: string;
  status: string;
  hint?: string | null;
}) {
  return (
    <div className="summary-item">
      <div className="muted">{label}</div>
      <strong>{value}</strong>
      <StatusBadge status={status} />
      {hint ? <span className="muted compact-note">{hint}</span> : null}
    </div>
  );
}

function HealthRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="settings-row">
      <span className="muted">{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function laneCount(lanes: Record<string, number>, platform: string) {
  return platform in lanes ? (lanes as Record<string, number>)[platform] ?? 0 : 0;
}

function platformLabel(platform: string) {
  if (platform === "INSTAGRAM") return "Instagram";
  if (platform === "VK") return "VK";
  if (platform === "YOUTUBE") return "YouTube";
  return platform;
}
