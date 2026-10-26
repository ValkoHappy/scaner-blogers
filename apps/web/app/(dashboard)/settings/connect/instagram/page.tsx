import { prisma } from "@scaner-blogers/db";
import { InstagramProxyCheckButton } from "@/components/instagram-proxy-check-button";
import { InstagramSessionHelperDownloadButton } from "@/components/instagram-session-helper-download-button";
import { PendingButton } from "@/components/pending-button";
import { PageHeader } from "@/components/shell";
import Link from "next/link";
import { connectInstagramAccountAction } from "../../actions";

export default async function ConnectInstagramPage() {
  const proxies = await prisma.proxyEndpoint.findMany({
    orderBy: { createdAt: "asc" },
    select: { id: true, url: true }
  }).catch(() => []);

  return (
    <div className="settings-connect-screen instagram-connect-screen">
      <PageHeader
        title="Connect Instagram"
        subtitle="Enter the Instagram login data here. ScannerBlogers will run the same donor login flow on the server and save the prepared session."
      />

      <section className="panel compact-panel settings-connect-panel">
        <div className="settings-connect-intro">
          <div>
            <h2 className="panel-title">Server login first</h2>
            <p className="muted compact-note">
              Use login, email or phone plus the password. If Instagram asks for a code, enter it here and retry the same account.
              The worker will still consume only the saved prepared session.
            </p>
          </div>
          <Link className="button" href="/settings#accounts">Back</Link>
        </div>

        <div className="instagram-session-steps">
          <section className="instagram-session-step">
            <span className="instagram-session-step-number">1</span>
            <div>
              <strong>Enter the same login identifier you use in Instagram</strong>
              <p>Username, email or phone are accepted. If one identifier returns account-not-found, try the exact one that works in the browser.</p>
            </div>
          </section>

          <section className="instagram-session-step">
            <span className="instagram-session-step-number">2</span>
            <div>
              <strong>Run the login from the server</strong>
              <p>The same collector bootstrap is used here, so the saved session matches the worker runtime.</p>
            </div>
          </section>

          <section className="instagram-session-step">
            <span className="instagram-session-step-number">3</span>
            <div>
              <strong>Save the prepared session</strong>
              <p>Successful login replaces stale auth state. If Instagram asks for an email/SMS/app code, enter the code and submit again.</p>
            </div>
          </section>
        </div>

        <form
          action={connectInstagramAccountAction}
          className="settings-connect-form instagram-session-upload-form"
        >
          <label className="field-label">
            Instagram login (username, email or phone)
            <input
              id="instagram-helper-username"
              className="input"
              name="username"
              placeholder="your_username_or_email@example.com"
              required
            />
            <span>Used as the server account key unless an imported session JSON contains a canonical username.</span>
          </label>

          <label className="field-label">
            Instagram password
            <input
              className="input"
              name="password"
              type="password"
              autoComplete="current-password"
              placeholder="Password"
              required
            />
            <span>The password is used only to create or refresh a prepared donor session for this account.</span>
          </label>

          <label className="field-label">
            Email/SMS/app code
            <input
              className="input"
              name="verificationCode"
              inputMode="numeric"
              placeholder="Enter only if Instagram already sent a code"
            />
            <span>Leave empty on the first attempt. If Instagram sends a code, enter it here and submit again.</span>
          </label>

          <label className="field-label">
            Proxy for this account
            <select
              id="instagram-proxy-url"
              className="input"
              name="proxyUrl"
              defaultValue=""
            >
              <option value="">No proxy</option>
              {proxies.map((proxy) => (
                <option key={proxy.id} value={proxy.url}>
                  {proxy.url}
                </option>
              ))}
            </select>
            <span>The helper and the server runtime will use the same normalized proxy. SOCKS values are forced to socks5h.</span>
          </label>

          <div className="settings-connect-wide instagram-proxy-warning">
            <strong>Proxy diagnostics before login</strong>
            <span>
              Run a quick check first. If the proxy is alive but Instagram later says account not found, the login identifier is wrong.
              If the proxy check already fails, do not waste a login attempt on it.
            </span>
          </div>

          <InstagramProxyCheckButton proxyInputId="instagram-proxy-url" />

          <input type="hidden" name="verifyNow" value="true" />

          <label className="field-label settings-connect-wide instagram-session-file-field">
            Optional session JSON import
            <input
              className="input"
              name="sessionSettingsFile"
              type="file"
              accept=".json,application/json,text/json"
            />
            <span>Use this only if you already have a helper/export JSON. A successful server login can fill this automatically.</span>
          </label>

          <div className="settings-connect-actions">
            <PendingButton className="button primary" pendingText="Saving account..." type="submit">
              Login and save session
            </PendingButton>
            <InstagramSessionHelperDownloadButton
              proxyInputId="instagram-proxy-url"
              usernameInputId="instagram-helper-username"
            />
          </div>
        </form>
      </section>
    </div>
  );
}
