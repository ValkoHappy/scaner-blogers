import type { CollectorEventRow } from "@scaner-blogers/core";

export function collectorStdoutParseFailedEvent(collector: string, line: string, error: unknown): CollectorEventRow {
  return {
    event: {
      level: "warn",
      code: "collector_stdout_parse_failed",
      message: `${collector} collector emitted invalid candidate JSONL row`,
      data: {
        collector,
        lineLength: line.length,
        error: error instanceof Error ? error.message : String(error)
      }
    },
    collectedAt: new Date().toISOString()
  };
}

export function collectorStderrParseFailedEvent(collector: string, line: string, error: unknown): CollectorEventRow {
  return {
    event: {
      level: "warn",
      code: "collector_stderr_parse_failed",
      message: `${collector} collector emitted invalid event JSONL row`,
      data: {
        collector,
        lineLength: line.length,
        error: error instanceof Error ? error.message : String(error)
      }
    },
    collectedAt: new Date().toISOString()
  };
}
