"use client";

import { useEffect, useMemo, useState } from "react";
import { formatScanMessage } from "./display";

export type ScanLogEvent = {
  id: string;
  level: string;
  message: string;
  createdAt: string;
  data?: unknown;
};

export type ScanLogJob = {
  id: string;
  status: string;
  cancelRequested?: boolean | null;
  scanMode: string;
  createdAt: string;
  pagesFetched: number;
  creativesFound: number;
  detailsFetched: number;
  previewsFetched: number;
  events: ScanLogEvent[];
};

type ScanLogDialogProps = {
  buttonLabel?: string;
  job: ScanLogJob;
  liveJob?: ScanLogJob;
  eventsUrl?: string;
  title?: string;
  itemLabel?: string;
};

export function ScanLogDialog({
  buttonLabel = "Открыть журнал",
  job,
  liveJob: externalLiveJob,
  eventsUrl,
  title = "Журнал сканирования",
  itemLabel = "элементов"
}: ScanLogDialogProps) {
  const [open, setOpen] = useState(false);
  const [level, setLevel] = useState("ALL");
  const [fetchedJob, setFetchedJob] = useState<ScanLogJob | null>(null);
  const [liveError, setLiveError] = useState<string | null>(null);
  const liveJob = fetchedJob?.id === job.id ? fetchedJob : externalLiveJob ?? job;
  const effectiveStatus = liveJob.cancelRequested && liveJob.status === "RUNNING" ? "Останавливается" : liveJob.status;
  const diagnostics = useMemo(() => buildDiagnostics(liveJob.events), [liveJob.events]);
  const queueNotice = queueNoticeLabel(liveJob);
  const events = useMemo(
    () => level === "ALL" ? liveJob.events : liveJob.events.filter((event) => event.level === level),
    [liveJob.events, level]
  );

  useEffect(() => {
    if (!open) return;
    let canceled = false;

    async function loadEvents() {
      try {
        const response = await fetch(eventsUrl ?? `/api/scans/${job.id}/events`, { cache: "no-store" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = await response.json() as { job: ScanLogJob };
        if (!canceled) {
          setFetchedJob(payload.job);
          setLiveError(null);
        }
      } catch (error) {
        if (!canceled) setLiveError(error instanceof Error ? error.message : "Ошибка обновления");
      }
    }

    void loadEvents();
    const interval = window.setInterval(loadEvents, 2000);
    return () => {
      canceled = true;
      window.clearInterval(interval);
    };
  }, [eventsUrl, job.id, open]);

  return (
    <>
      <button className="button" type="button" onClick={() => setOpen(true)}>{buttonLabel}</button>
      {open ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setOpen(false)}>
          <div className="log-modal" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => event.stopPropagation()}>
            <div className="log-modal-header">
              <div>
                <h2>{title}</h2>
                <p>{effectiveStatus} · {liveJob.scanMode} · {liveJob.creativesFound} {itemLabel} · {liveJob.pagesFetched} шагов · автообновление 2с</p>
              </div>
              <button className="icon-button" type="button" onClick={() => setOpen(false)} aria-label="Закрыть">x</button>
            </div>
            {liveError ? <div className="status-note error">Журнал не обновился: {liveError}</div> : null}
            {queueNotice ? <div className="status-note warning" aria-live="polite">{queueNotice}</div> : null}
            <div className="log-diagnostics" aria-label="Диагностика журнала">
              {diagnostics.map((item, index) => (
                <div className="log-diagnostic-card" key={`${item.label}:${index}`}>
                  <span>{item.label}</span>
                  <strong>{item.value}</strong>
                  {item.hint ? <small>{item.hint}</small> : null}
                </div>
              ))}
            </div>
            <div className="log-toolbar">
              {["ALL", "info", "warn", "error"].map((item) => (
                <button className={level === item ? "tab-link active" : "tab-link"} type="button" key={item} onClick={() => setLevel(item)}>
                  {item === "ALL" ? "Все" : item.toUpperCase()}
                </button>
              ))}
            </div>
            <pre className="console-log">{events.length ? events.map(formatEvent).join("\n") : "Событий нет"}</pre>
          </div>
        </div>
      ) : null}
    </>
  );
}

function formatEvent(event: ScanLogEvent) {
  const time = new Date(event.createdAt).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
  const data = eventDataLabel(event.data);
  return `[${time}] ${event.level.toUpperCase().padEnd(5)} ${formatScanMessage(event.message)}${data ? `  ${data}` : ""}`;
}

function buildDiagnostics(events: ScanLogEvent[]) {
  const warnings = events.filter((event) => event.level === "warn").length;
  const errors = events.filter((event) => event.level === "error").length;
  const parserWarnings = events.filter((event) => {
    const code = eventCode(event.data);
    return code === "collector_stdout_parse_failed" || code === "collector_stderr_parse_failed";
  }).length;
  const newest = events.at(0);
  const oldest = events.at(-1);
  const mergedData = mergeEventData(events);
  return [
    {
      label: "Событий",
      value: String(events.length),
      hint: errors || warnings ? `${errors} ошибок / ${warnings} предупреждений` : "ошибок нет"
    },
    {
      label: "Первый лог",
      value: oldest ? shortDateTime(oldest.createdAt) : "нет",
      hint: oldest ? formatScanMessage(oldest.message) : undefined
    },
    {
      label: "Последний лог",
      value: newest ? shortDateTime(newest.createdAt) : "нет",
      hint: newest ? formatScanMessage(newest.message) : undefined
    },
    {
      label: "Пришло / сохранено",
      value: `${numberLabel(mergedData.candidatesReceived)} / ${numberLabel(mergedData.savedProfiles ?? mergedData.creatives)}`,
      hint: `изменено ${numberLabel(mergedData.affectedCandidates)}`
    },
    {
      label: "Проверено / дубли",
      value: `${numberLabel(mergedData.profilesChecked)} / ${numberLabel(mergedData.duplicateRowsInCollectorOutput)}`,
      hint: mergedData.excludedProfileIds === undefined ? undefined : `уже были ${numberLabel(mergedData.excludedProfileIds)}`
    },
    {
      label: "Парсер",
      value: String(parserWarnings),
      hint: parserWarnings ? "предупреждения JSONL" : "потоки ok"
    },
    {
      label: "Длительность",
      value: durationLabel(mergedData.durationMs),
      hint: stringValue(mergedData.collector) ?? stringValue(mergedData.platform)
    }
  ];
}

function mergeEventData(events: ScanLogEvent[]) {
  const merged: Record<string, unknown> = {};
  for (const event of [...events].reverse()) {
    if (!event.data || typeof event.data !== "object") continue;
    Object.assign(merged, event.data);
  }
  return merged;
}

function eventDataLabel(data: unknown) {
  if (!data || typeof data !== "object") return "";
  const row = data as Record<string, unknown>;
  const parts = [
    typeof row.code === "string" ? `code=${row.code}` : undefined,
    typeof row.reasonCode === "string" ? `reason=${row.reasonCode}` : undefined,
    typeof row.platform === "string" ? `platform=${row.platform}` : undefined,
    typeof row.collector === "string" ? `collector=${row.collector}` : undefined,
    typeof row.creativeId === "string" ? `creative=${row.creativeId}` : undefined,
    typeof row.creatives === "number" ? `creatives=${row.creatives}` : undefined,
    typeof row.candidatesReceived === "number" ? `получено=${row.candidatesReceived}` : undefined,
    typeof row.savedProfiles === "number" ? `сохранено=${row.savedProfiles}` : undefined,
    typeof row.affectedCandidates === "number" ? `изменено=${row.affectedCandidates}` : undefined,
    typeof row.profilesChecked === "number" ? `проверено=${row.profilesChecked}` : undefined,
    typeof row.duplicateRowsInCollectorOutput === "number" ? `дубли=${row.duplicateRowsInCollectorOutput}` : undefined,
    typeof row.lineLength === "number" ? `строка=${row.lineLength}` : undefined,
    typeof row.durationMs === "number" ? `длительность=${durationLabel(row.durationMs)}` : undefined,
    typeof row.page === "number" ? `страница=${row.page}` : undefined,
    typeof row.retryAt === "string" ? `следующая попытка=${shortDateTime(row.retryAt)}` : undefined
  ].filter(Boolean);
  return parts.length ? `{ ${parts.join(" ")} }` : "";
}

function eventCode(data: unknown) {
  return data && typeof data === "object" && typeof (data as Record<string, unknown>).code === "string"
    ? (data as Record<string, string>).code
    : undefined;
}

function queueNoticeLabel(job: ScanLogJob) {
  if (job.status !== "QUEUED") return null;
  const unavailable = job.events.find((event) => eventCode(event.data) === "instagram_no_available_account");
  if (unavailable) {
    const retryAt = unavailable.data && typeof unavailable.data === "object"
      ? (unavailable.data as Record<string, unknown>).retryAt
      : undefined;
    const retryLabel = typeof retryAt === "string" ? ` Следующая попытка: ${shortDateTime(retryAt)}.` : "";
    return `Сбор сейчас не идёт: нет доступного Instagram-аккаунта.${retryLabel} Worker будет пробовать автоматически.`;
  }
  return "Сбор ещё не начался: задача ожидает свободный worker.";
}

function shortDateTime(value: string) {
  return new Date(value).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function numberLabel(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "-";
}

function durationLabel(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  if (value < 1000) return `${value}ms`;
  return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)}s`;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value ? value : undefined;
}
