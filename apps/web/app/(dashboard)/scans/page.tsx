import type { ReactNode } from "react";
import Link from "next/link";
import { formatDateTime, formatScanMessage, formatStatusLabel } from "@/components/display";
import { Icons } from "@/components/icons";
import { LiveRouteRefresh } from "@/components/live-route-refresh";
import { PendingButton } from "@/components/pending-button";
import { PlatformLogo } from "@/components/platform-logo";
import { ScanLogDialog } from "@/components/scan-log-dialog";
import { StatusBadge } from "@/components/shell";
import { getCollectionJobs, getScans, getSystemStatusData } from "@/lib/data";
import { cancelAllActiveWorkAction, cancelCollectionJobAction, retryCollectionJobAction } from "../actions";

type CollectionJobs = Awaited<ReturnType<typeof getCollectionJobs>>;
type CollectionJob = CollectionJobs[number];

export default async function ScansPage() {
  const [scans, collectionJobs, systemStatus] = await Promise.all([getScans(), getCollectionJobs(), getSystemStatusData()]);
  const collectionStatusStats = countBy(collectionJobs, (job) => job.cancelRequested && job.status === "RUNNING" ? "STOPPING" : job.status);
  const queuedCollections = collectionJobs.filter((job) => job.status === "QUEUED").length;
  const successfulCollections = collectionJobs.filter((job) => job.status === "SUCCESS").length;
  const runningCollections = collectionJobs.filter((job) => job.status === "RUNNING").length;
  const platformStats = platformCounts(collectionJobs);
  const queueNote = scanQueueNote(systemStatus);
  const platformProblems = scanPlatformProblems(systemStatus);
  const hasCancelableWork = scans.some((scan) => (scan.status === "RUNNING" || scan.status === "QUEUED") && !scan.cancelRequested)
    || collectionJobs.some((job) => (job.status === "RUNNING" || job.status === "QUEUED") && !job.cancelRequested);
  const hasLiveWork = scans.some((scan) => scan.status === "RUNNING" || scan.status === "QUEUED" || scan.cancelRequested)
    || collectionJobs.some((job) => job.status === "RUNNING" || job.status === "QUEUED")
    || systemStatus.workerStatus === "running";

  return (
    <div className="scans-screen">
      <LiveRouteRefresh enabled={hasLiveWork} />

      <div className="scans-hero">
        <div>
          <h1 className="page-title">Сканирования</h1>
          <p className="page-subtitle">очередь ручных сборов блогеров по Instagram, VK и YouTube</p>
        </div>
        <div className="scans-hero-note">
          <Icons.Info size={16} />
          Если есть активные сборы, страница обновляется автоматически
        </div>
        <div className="scans-hero-actions">
          {hasCancelableWork ? (
            <form id="cancel-all-active-work-form" action={cancelAllActiveWorkAction} className="inline-form">
              <PendingButton className="button danger scan-stop-all" pendingText="Останавливаю..." type="submit">
                <Icons.Square size={13} />
                Остановить все
              </PendingButton>
            </form>
          ) : null}
        </div>
      </div>

      <section className="scan-metric-grid">
        <SummaryCard icon={<Icons.Zap size={30} />} tone="blue" label="Всего запусков" value={String(collectionJobs.length)} hint="за все время" />
        <SummaryCard icon={<Icons.Users size={30} />} tone="green" label="Сборы блогеров" value={String(successfulCollections)} hint="успешно завершено" />
        <SummaryCard icon={<Icons.Clock3 size={30} />} tone="orange" label="В очереди" value={String(queuedCollections)} hint={queueNote ?? "ожидают запуска"} />
        <div className="scan-metric-card">
          <span className="stat-label">Площадки</span>
          <div className="scan-platform-counts">
            <PlatformCount platform="INSTAGRAM" value={platformStats.INSTAGRAM} />
            <PlatformCount platform="VK" value={platformStats.VK} />
            <PlatformCount platform="YOUTUBE" value={platformStats.YOUTUBE} />
          </div>
        </div>
        <div className="scan-metric-card">
          <span className="stat-label">Статус сборщика</span>
          <strong className={`worker-state ${systemStatus.workerOnline ? "online" : "offline"}`}>
            <span className={`legend-dot ${systemStatus.workerOnline ? "green" : "red"}`} />
            {systemStatus.workerStatus}
          </strong>
          <small>активных процессов: {runningCollections}</small>
        </div>
      </section>

      <section className="scan-status-row" aria-label="Статусы сборов">
        {collectionStatusStats.map((item) => (
          <span className={`scan-status-pill ${statusTone(item.label)}`} key={`collection-${item.label}`}>
            {statusIcon(item.label)}
            {formatStatusLabel(item.label)}
            <strong>{item.value}</strong>
          </span>
        ))}
      </section>

      {platformProblems.length ? (
        <section className="panel compact-panel scan-problems-panel">
          <div className="panel-header">
            <h2 className="panel-title">Что мешает сбору</h2>
            <Link className="button secondary" href="/health">Подробности</Link>
          </div>
          <div className="scan-problem-strip">
            {platformProblems.map((problem, index) => (
              <div className="scan-problem-card" key={`${problem.key}:${problem.platform}:${index}`}>
                <strong>{problem.platform}</strong>
                <StatusBadge status={problem.status} />
                <span className="muted truncate">{problem.message}</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="panel compact-panel scans-table-panel">
        {collectionJobs.length ? (
          <div className="table-scroll scans-table-scroll">
            <table className="table scans-table">
              <thead>
                <tr>
                  <th>Ключевое слово</th>
                  <th>Хэштеги</th>
                  <th>Площадка</th>
                  <th>Создано</th>
                  <th>Запущено</th>
                  <th>Завершено</th>
                  <th>Найдено кандидатов</th>
                  <th>Статус</th>
                  <th>Последнее событие / ошибка / причина блока</th>
                  <th>Действия</th>
                </tr>
              </thead>
              <tbody>
                {collectionJobs.map((job) => {
                  const stopping = job.cancelRequested && job.status === "RUNNING";
                  return (
                    <tr key={job.id}>
                      <td><strong>{job.keyword?.value ?? "ручной запуск"}</strong></td>
                      <td className="scan-tags-cell">{job.hashtags.length ? job.hashtags.map((tag) => `#${tag}`).join(", ") : <span className="muted">-</span>}</td>
                      <td>
                        <span className={`scan-platform-badge ${job.platform.toLowerCase()}`}>
                          <PlatformLogo platform={job.platform} size={24} />
                          {platformLabel(job.platform)}
                        </span>
                      </td>
                      <td>{formatDateTime(job.createdAt)}</td>
                      <td>{formatDateTime(job.startedAt)}</td>
                      <td>{formatDateTime(job.finishedAt)}</td>
                      <td className="scan-found-count">{job.candidatesFound.toLocaleString("ru-RU")}</td>
                      <td><StatusBadge status={stopping ? "STOPPING" : job.status} /></td>
                      <td className="scan-event-cell">
                        {stopping ? "Остановка запрошена, сборщик завершит текущий шаг." : formatScanMessage(job.blockedReason ?? job.events[0]?.message ?? job.errorMessage)}
                      </td>
                      <td className="actions-cell scan-actions-cell">
                        <ScanLogDialog
                          buttonLabel="Логи"
                          eventsUrl={`/api/collections/${job.id}/events`}
                          itemLabel="кандидатов"
                          job={collectionLogJob(job)}
                          title={`Логи ${platformLabel(job.platform)}-сбора`}
                        />
                        <form action={retryCollectionJobAction} className="inline-form">
                          <input type="hidden" name="collectionJobId" value={job.id} />
                          <PendingButton className="button scan-table-action" pendingText="" type="submit">Повторить</PendingButton>
                        </form>
                        {(job.status === "QUEUED" || job.status === "RUNNING") && !stopping ? (
                          <form action={cancelCollectionJobAction} className="inline-form">
                            <input type="hidden" name="collectionJobId" value={job.id} />
                            <PendingButton className="button scan-table-action danger-lite" pendingText="Выполняется" type="submit">{job.status === "QUEUED" ? "Снять" : "Остановить"}</PendingButton>
                          </form>
                        ) : stopping ? (
                          <span className="muted">Останавливается</span>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">
            <h2 className="panel-title">Сборов блогеров пока нет</h2>
            <p className="muted">Запустите Instagram, VK или YouTube сбор с экрана ключевых слов.</p>
          </div>
        )}
      </section>

      <section className="panel chart-panel scan-chart-panel">
        <div className="panel-header chart-heading">
          <div>
            <h2 className="panel-title">Результаты последних сборов</h2>
          </div>
          <span className="scan-chart-range">Последние 10 запусков</span>
        </div>
        <CollectionRunsBars jobs={collectionJobs.slice(0, 15).reverse()} />
      </section>
    </div>
  );
}

function SummaryCard({ icon, tone, label, value, hint }: { icon: ReactNode; tone: string; label: string; value: string; hint?: string }) {
  return (
    <div className="scan-metric-card icon-card">
      <span className={`scan-metric-icon ${tone}`}>{icon}</span>
      <div>
        <span className="stat-label">{label}</span>
        <strong>{value}</strong>
        {hint ? <small>{hint}</small> : null}
      </div>
    </div>
  );
}

function CollectionRunsBars({ jobs }: { jobs: CollectionJobs }) {
  const max = Math.max(1, ...jobs.map((job) => Math.max(job.candidatesFound, job.profilesChecked)));
  return (
    <div className="mini-bars">
      {jobs.map((job) => (
        <div className="mini-bar-item" key={job.id}>
          <strong>{job.candidatesFound}</strong>
          <i style={{ height: `${Math.max(4, (job.candidatesFound / max) * 100)}%` }} />
          <span>{new Date(job.createdAt).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" })}</span>
        </div>
      ))}
    </div>
  );
}

function collectionLogJob(job: CollectionJob) {
  return {
    id: job.id,
    status: job.status,
    cancelRequested: job.cancelRequested,
    scanMode: job.platform,
    createdAt: job.createdAt.toISOString(),
    pagesFetched: job.profilesChecked,
    creativesFound: job.candidatesFound,
    detailsFetched: job.profilesChecked,
    previewsFetched: 0,
    events: job.events.map((event) => ({
      id: event.id,
      level: event.level,
      message: formatScanMessage(event.message),
      createdAt: event.createdAt.toISOString(),
      data: event.data
    }))
  };
}

function scanQueueNote(systemStatus: Awaited<ReturnType<typeof getSystemStatusData>>) {
  if (systemStatus.workerStatus === "cooldown" && systemStatus.workerMessage) {
    return formatScanMessage(systemStatus.workerMessage);
  }
  return null;
}

function scanPlatformProblems(systemStatus: Awaited<ReturnType<typeof getSystemStatusData>>) {
  const problems = systemStatus.socialAccounts
    .filter((account) => account.status !== "OK" && account.status !== "RUNNING")
    .map((account) => {
      const message = formatScanMessage(account.lastError ?? "");
      return {
        key: account.accountKey,
        platform: platformLabel(account.platform),
        status: account.status,
        message: problemMessage(account.platform, message, account.blockedUntil)
      };
    });
  if (!systemStatus.workerOnline && (systemStatus.socialQueue.queued > 0 || systemStatus.socialQueue.running > 0)) {
    problems.unshift({
      key: "worker",
      platform: "Worker",
      status: "FAILED",
      message: systemStatus.socialQueue.running > 0
        ? `Сборщик не отвечает во время работы. В очереди ${systemStatus.socialQueue.queued}, выполняется ${systemStatus.socialQueue.running}.`
        : `В очереди ${systemStatus.socialQueue.queued} задач, но worker не активен.`
    });
  }
  return problems;
}

function problemMessage(platform: string, error: string, blockedUntil?: Date | null) {
  const lower = error.toLowerCase();
  const cooldown = blockedUntil ? ` Пауза до ${formatDateTime(blockedUntil)}.` : "";
  if (platform === "VK" && lower.includes("another ip address")) {
    return `VK токен получен с другого IP. Нужно обновить токен с серверного IP.${cooldown}`;
  }
  if (platform === "INSTAGRAM" && lower.includes("login_required")) {
    return `Instagram просит заново войти в аккаунт.${cooldown}`;
  }
  if (platform === "INSTAGRAM") {
    return `Instagram на паузе/ограничении.${cooldown}`;
  }
  if (platform === "YOUTUBE" && lower.includes("quota")) {
    return `YouTube API уперся в квоту.${cooldown}`;
  }
  return `${error || "Есть проблема с доступом платформы."}${cooldown}`;
}

function countBy<T>(items: T[], getLabel: (item: T) => string) {
  const counts = new Map<string, number>();
  for (const item of items) {
    const label = getLabel(item);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
}

function platformCounts(jobs: CollectionJobs) {
  return jobs.reduce((acc, job) => {
    if (job.platform === "INSTAGRAM" || job.platform === "VK" || job.platform === "YOUTUBE") {
      acc[job.platform] += 1;
    }
    return acc;
  }, { INSTAGRAM: 0, VK: 0, YOUTUBE: 0 });
}

function PlatformCount({ platform, value }: { platform: string; value: number }) {
  return (
    <span>
      <PlatformLogo platform={platform} size={24} />
      <strong>{value}</strong>
    </span>
  );
}

function statusTone(status: string) {
  if (status === "SUCCESS") return "success";
  if (status === "FAILED") return "failed";
  if (status === "QUEUED") return "queued";
  if (status === "RUNNING") return "running";
  if (status === "BLOCKED") return "blocked";
  if (status === "STOPPING" || status === "CANCELED") return "stopped";
  return "stopped";
}

function statusIcon(status: string) {
  if (status === "SUCCESS") return <Icons.CheckCircle2 size={15} />;
  if (status === "FAILED") return <Icons.AlertCircle size={15} />;
  if (status === "QUEUED") return <Icons.Hourglass size={15} />;
  if (status === "RUNNING") return <Icons.Play size={15} fill="currentColor" />;
  if (status === "BLOCKED") return <Icons.AlertCircle size={15} />;
  return <Icons.PauseCircle size={15} />;
}

function platformLabel(platform: string) {
  if (platform === "YOUTUBE") return "YouTube";
  if (platform === "VK") return "VK";
  if (platform === "INSTAGRAM") return "Instagram";
  return platform;
}
