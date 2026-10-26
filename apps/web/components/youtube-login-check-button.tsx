"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function YouTubeLoginCheckButton({ accountKey }: { accountKey: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function runCheck() {
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch("/api/youtube/login-check", {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json"
        },
        body: JSON.stringify({ accountKey })
      });
      const payload = await response.json().catch(() => null) as { ok?: boolean; message?: string; accountStatus?: string } | null;
      if (!response.ok) throw new Error(payload?.message ?? `HTTP ${response.status}`);
      setMessage(payload?.ok ? "YouTube API ключ работает" : loginCheckMessage(payload));
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Ошибка проверки YouTube");
    } finally {
      setPending(false);
    }
  }

  return (
    <span className="inline-action-status compact">
      <button className={`button ${pending ? "is-pending" : ""}`} disabled={pending} onClick={runCheck} type="button">
        {pending ? (
          <>
            <span className="button-spinner" aria-hidden="true" />
            Проверяем
          </>
        ) : "Проверить"}
      </button>
      {message ? <span className="muted">{message}</span> : null}
    </span>
  );
}

function loginCheckMessage(payload: { message?: string; accountStatus?: string } | null) {
  const status = payload?.accountStatus ?? "ошибка";
  const details = payload?.message?.trim();
  return details ? `Проверка: ${status} - ${details}` : `Проверка: ${status}`;
}
