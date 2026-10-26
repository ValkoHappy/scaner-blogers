"use client";

import Link from "next/link";

export default function VkOauthCallbackPage() {
  return (
    <div className="settings-connect-screen">
      <section className="panel compact-panel settings-connect-result error">
        <h1>Legacy callback больше не используется</h1>
        <p className="muted compact-note">
          Канонический VK OAuth-first flow теперь завершается серверным callback-маршрутом <code>/api/vk/oauth/callback</code>. Эта страница оставлена только
          как явная подсказка, чтобы не сохранять старый fragment-token state рядом с refreshable OAuth account.
        </p>
        <div className="settings-connect-actions">
          <Link className="button primary" href="/settings/connect/vk">Вернуться к подключению VK</Link>
          <Link className="button" href="/settings#accounts">Открыть настройки</Link>
        </div>
      </section>
    </div>
  );
}
