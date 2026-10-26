import Link from "next/link";
import { getSystemSettings } from "@scaner-blogers/db";
import { headers } from "next/headers";
import { PageHeader } from "@/components/shell";
import { inspectVkOAuthRedirectUri, resolveVkOAuthClientId } from "@/lib/vk-oauth-config";

interface ConnectVkPageProps {
  searchParams?: Promise<{ error?: string }>;
}

export default async function ConnectVkPage({ searchParams }: ConnectVkPageProps) {
  const settings = await getSystemSettings();
  const error = (await searchParams)?.error;
  const origin = await requestOrigin();
  const client = resolveVkOAuthClientId({
    settingsVkAppId: settings.vkAppId,
    envVkAppId: process.env.VK_APP_ID
  });
  const redirect = inspectVkOAuthRedirectUri(origin, process.env.VK_OAUTH_REDIRECT_URI);
  const appReady = Boolean(client.activeClientId) && redirect.isReady;
  const callbackUrl = redirect.redirectUri;

  return (
    <div className="settings-connect-screen">
      <PageHeader
        title="\u041f\u043e\u0434\u043a\u043b\u044e\u0447\u0438\u0442\u044c VK"
        subtitle="\u041e\u0434\u043d\u043e\u0440\u0430\u0437\u043e\u0432\u044b\u0439 \u0432\u0445\u043e\u0434 \u0447\u0435\u0440\u0435\u0437 VK ID, \u0437\u0430\u0442\u0435\u043c \u0441\u0435\u0440\u0432\u0435\u0440 \u0445\u0440\u0430\u043d\u0438\u0442 refresh token \u0438 \u043e\u0431\u043d\u043e\u0432\u043b\u044f\u0435\u0442 \u0434\u043e\u0441\u0442\u0443\u043f \u0430\u0432\u0442\u043e\u043c\u0430\u0442\u0438\u0447\u0435\u0441\u043a\u0438."
      />

      <section className="panel compact-panel settings-connect-panel">
        <div className="settings-connect-intro">
          <div>
            <h2 className="panel-title">VK OAuth</h2>
            <p className="muted compact-note">
              {"\u041e\u0441\u043d\u043e\u0432\u043d\u043e\u0439 \u043f\u0443\u0442\u044c \u043e\u0434\u0438\u043d: \u043f\u043e\u0434\u043a\u043b\u044e\u0447\u0435\u043d\u0438\u0435 \u0447\u0435\u0440\u0435\u0437 VK ID app \u0431\u0435\u0437 \u0440\u0443\u0447\u043d\u043e\u0439 \u0432\u0441\u0442\u0430\u0432\u043a\u0438 \u0442\u043e\u043a\u0435\u043d\u0430."}
            </p>
          </div>
          <Link className="button" href="/settings#accounts">{"\u041d\u0430\u0437\u0430\u0434"}</Link>
        </div>

        {error ? (
          <div className="settings-connect-note-inline" style={{ borderColor: "color-mix(in srgb, var(--danger) 45%, var(--line))" }}>
            <strong>{"VK \u043d\u0435 \u043f\u043e\u0434\u043a\u043b\u044e\u0447\u0435\u043d"}</strong>
            <p className="muted compact-note">{vkOauthError(error)}</p>
          </div>
        ) : null}

        <div className="vk-setup-row vk-setup-row-wide">
          <span className="vk-setup-number">1</span>
          <div className="vk-setup-content">
            <strong>{"\u0421\u0442\u0430\u0442\u0443\u0441 \u043f\u043e\u0434\u043a\u043b\u044e\u0447\u0435\u043d\u0438\u044f"}</strong>
            <p>
              {appReady
                ? "\u041a\u043e\u043d\u0444\u0438\u0433\u0443\u0440\u0430\u0446\u0438\u044f \u0433\u043e\u0442\u043e\u0432\u0430. \u041c\u043e\u0436\u043d\u043e \u0437\u0430\u043f\u0443\u0441\u043a\u0430\u0442\u044c \u0432\u0445\u043e\u0434 \u0447\u0435\u0440\u0435\u0437 VK ID."
                : "\u0421\u0435\u0439\u0447\u0430\u0441 \u0432\u0445\u043e\u0434 \u0437\u0430\u0431\u043b\u043e\u043a\u0438\u0440\u043e\u0432\u0430\u043d \u0438\u0437-\u0437\u0430 redirect URI."}
            </p>

            <div style={{ display: "grid", gap: 12, marginTop: 16 }}>
              <div className="settings-connect-note-inline vk-callback-hint">
                <strong>VK client_id</strong>
                <p className="muted compact-note callback-url">{client.activeClientId || "\u043d\u0435 \u0437\u0430\u0434\u0430\u043d"}</p>
                <p className="muted compact-note">
                  {"\u0418\u0441\u0442\u043e\u0447\u043d\u0438\u043a: "}
                  {client.source === "db"
                    ? "systemSettings.vkAppId"
                    : client.source === "env"
                      ? "VK_APP_ID \u0438\u0437 env"
                      : "\u043d\u0435 \u043d\u0430\u0441\u0442\u0440\u043e\u0435\u043d"}
                  .
                </p>
                {client.mismatch ? (
                  <p className="muted compact-note">
                    {"\u0412 \u0411\u0414 \u0438 env \u0440\u0430\u0437\u043d\u044b\u0435 client_id. \u0420\u0435\u0430\u043b\u044c\u043d\u043e \u0431\u0443\u0434\u0435\u0442 \u0438\u0441\u043f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u043d \u0411\u0414-\u0432\u0430\u0440\u0438\u0430\u043d\u0442: "}
                    <code>{client.activeClientId}</code>
                  </p>
                ) : null}
              </div>

              <div className="settings-connect-note-inline vk-callback-hint">
                <strong>Redirect URI</strong>
                <p className="muted compact-note callback-url">{callbackUrl}</p>
                {!redirect.isReady ? (
                  <p className="muted compact-note">
                    {"\u041d\u0443\u0436\u0435\u043d \u043f\u0443\u0431\u043b\u0438\u0447\u043d\u044b\u0439 "}
                    <code>https://</code>
                    {" callback \u0432 "}
                    <code>VK_OAUTH_REDIRECT_URI</code>
                    {". \u041b\u043e\u043a\u0430\u043b\u044c\u043d\u044b\u0439 "}
                    <code>127.0.0.1</code>
                    {" / "}
                    <code>localhost</code>
                    {" \u0434\u043b\u044f \u044d\u0442\u043e\u0433\u043e \u0432\u0445\u043e\u0434\u0430 \u043d\u0435 \u043f\u043e\u0434\u0445\u043e\u0434\u0438\u0442."}
                  </p>
                ) : (
                  <p className="muted compact-note">
                    {"\u0418\u043c\u0435\u043d\u043d\u043e \u044d\u0442\u043e\u0442 URL \u043d\u0443\u0436\u043d\u043e \u0434\u043e\u0431\u0430\u0432\u0438\u0442\u044c \u0432 VK ID app."}
                  </p>
                )}
              </div>
            </div>

            <div className="settings-connect-actions" style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", marginTop: 18 }}>
              {appReady ? (
                <Link className="button primary" href="/api/vk/oauth/start">
                  {"\u041f\u043e\u0434\u043a\u043b\u044e\u0447\u0438\u0442\u044c VK"}
                </Link>
              ) : (
                <button className="button primary" type="button" disabled aria-disabled="true" title="\u0421\u043d\u0430\u0447\u0430\u043b\u0430 \u0437\u0430\u0434\u0430\u0439\u0442\u0435 VK_OAUTH_REDIRECT_URI">
                  {"\u041f\u043e\u0434\u043a\u043b\u044e\u0447\u0438\u0442\u044c VK"}
                </button>
              )}
              <Link className="button" href="/settings">{"\u041e\u0442\u043a\u0440\u044b\u0442\u044c \u043d\u0430\u0441\u0442\u0440\u043e\u0439\u043a\u0438"}</Link>
              <Link className="button" href="/settings/connect/vk">{"\u041e\u0431\u043d\u043e\u0432\u0438\u0442\u044c \u0441\u0442\u0430\u0442\u0443\u0441"}</Link>
            </div>

            {!redirect.isReady ? (
              <div className="settings-connect-note-inline" style={{ marginTop: 16, borderColor: "color-mix(in srgb, var(--danger) 45%, var(--line))" }}>
                <strong>{"\u0427\u0442\u043e \u043d\u0443\u0436\u043d\u043e \u0441\u0434\u0435\u043b\u0430\u0442\u044c"}</strong>
                <p className="muted compact-note">1. {"\u0417\u0430\u0434\u0430\u0442\u044c "}<code>VK_OAUTH_REDIRECT_URI</code>{" \u043d\u0430 \u043f\u0443\u0431\u043b\u0438\u0447\u043d\u044b\u0439 HTTPS URL."}</p>
                <p className="muted compact-note">2. {"\u0414\u043e\u0431\u0430\u0432\u0438\u0442\u044c \u044d\u0442\u043e\u0442 exact URL \u0432 VK ID app."}</p>
                <p className="muted compact-note">3. {"\u0412\u0435\u0440\u043d\u0443\u0442\u044c\u0441\u044f \u0441\u044e\u0434\u0430 \u0438 \u043d\u0430\u0436\u0430\u0442\u044c \u00ab\u041f\u043e\u0434\u043a\u043b\u044e\u0447\u0438\u0442\u044c VK\u00bb."}</p>
              </div>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  );
}

function vkOauthError(error: string) {
  switch (error) {
    case "missing_app_id":
      return "\u0056\u004b \u0049\u0044 \u043f\u043e\u043a\u0430 \u043d\u0435 \u043d\u0430\u0441\u0442\u0440\u043e\u0435\u043d \u043d\u0430 \u0441\u0435\u0440\u0432\u0435\u0440\u0435.";
    case "oauth_state_invalid":
      return "\u0421\u0435\u0441\u0441\u0438\u044f \u043f\u043e\u0434\u043a\u043b\u044e\u0447\u0435\u043d\u0438\u044f \u0438\u0441\u0442\u0435\u043a\u043b\u0430. \u041d\u0430\u0436\u043c\u0438\u0442\u0435 \u00ab\u041f\u043e\u0434\u043a\u043b\u044e\u0447\u0438\u0442\u044c \u0056\u004b\u00bb \u0435\u0449\u0435 \u0440\u0430\u0437.";
    case "oauth_exchange_failed":
      return "\u0056\u004b \u043d\u0435 \u0432\u044b\u0434\u0430\u043b \u0441\u0435\u0440\u0432\u0435\u0440\u043d\u044b\u0439 \u0434\u043e\u0441\u0442\u0443\u043f. \u041f\u0440\u043e\u0432\u0435\u0440\u044c\u0442\u0435 callback \u043f\u0440\u0438\u043b\u043e\u0436\u0435\u043d\u0438\u044f \u0438 \u043f\u043e\u0432\u0442\u043e\u0440\u0438\u0442\u0435 \u0432\u0445\u043e\u0434.";
    case "redirect_uri_not_ready":
      return "\u0421\u043d\u0430\u0447\u0430\u043b\u0430 \u043d\u0430\u0441\u0442\u0440\u043e\u0439\u0442\u0435 \u043f\u0443\u0431\u043b\u0438\u0447\u043d\u044b\u0439 \u0048\u0054\u0054\u0050\u0053 callback \u0432 \u0056\u004b\u005f\u004f\u0041\u0055\u0054\u0048\u005f\u0052\u0045\u0044\u0049\u0052\u0045\u0043\u0054\u005f\u0055\u0052\u0049 \u0438 \u0434\u043e\u0431\u0430\u0432\u044c\u0442\u0435 \u0435\u0433\u043e \u0432 \u0056\u004b \u0049\u0044 app.";
    case "invalid_app_id":
      return "\u0423\u043a\u0430\u0437\u0430\u043d \u043d\u0435\u0432\u0435\u0440\u043d\u044b\u0439 \u0056\u004b App ID.";
    default:
      return "\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u043f\u043e\u0434\u043a\u043b\u044e\u0447\u0438\u0442\u044c \u0056\u004b. \u041f\u043e\u0432\u0442\u043e\u0440\u0438\u0442\u0435 \u0432\u0445\u043e\u0434.";
  }
}

async function requestOrigin() {
  const envOrigin = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL;
  if (envOrigin) return envOrigin.replace(/\/$/, "");
  const headerList = await headers();
  const proto = headerList.get("x-forwarded-proto") || "http";
  const host = headerList.get("x-forwarded-host") || headerList.get("host") || "127.0.0.1:3200";
  return `${proto}://${host}`;
}
