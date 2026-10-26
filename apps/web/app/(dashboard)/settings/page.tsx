import { AutoSaveSettingsForm } from "@/components/auto-save-settings-form";
import { formatDateTime } from "@/components/display";
import { InstagramLoginCheckButton } from "@/components/instagram-login-check-button";
import { PendingButton } from "@/components/pending-button";
import { PageHeader, StatusBadge } from "@/components/shell";
import { VkLoginCheckButton } from "@/components/vk-login-check-button";
import { YouTubeLoginCheckButton } from "@/components/youtube-login-check-button";
import { getSettingsData } from "@/lib/data";
import Link from "next/link";
import type { ReactNode } from "react";
import {
  deleteSocialPlatformAccountAction,
  deleteSocialPlatformAccountsAction,
  resetProxyStatusAction,
  toggleSocialPlatformAccountAction,
  toggleInstagramAccountAction,
  updateSettingsAction
} from "./actions";

export default async function SettingsPage() {
  const data = await getSettingsData();
  const system = data.systemStatus;
  const configuredAccessCount = [
    data.instagram.usernameConfigured && data.instagram.passwordConfigured,
    data.vk.tokenConfigured,
    data.youtube.apiKeyConfigured
  ].filter(Boolean).length;
  const accountAttentionCount = data.socialAccounts.filter((account) => account.status !== "OK").length;

  return (
    <div className="settings-screen">
      <PageHeader title="Настройки" subtitle="Доступы, состояние сборщиков, прокси и диагностика поиска" />

      <section className="settings-overview">
        <div className="settings-overview-card">
          <span className="settings-overview-label">Worker</span>
          <strong>{system.workerOnline ? "онлайн" : "не активен"}</strong>
          <span>{system.socialQueue.queued} в очереди · {system.socialQueue.running} в работе</span>
        </div>
        <div className="settings-overview-card">
          <span className="settings-overview-label">Доступы</span>
          <strong>{accountAttentionCount > 0 ? `${accountAttentionCount} требуют внимания` : `${configuredAccessCount}/3 готовы`}</strong>
          <span>{configuredAccessCount}/3 env · Instagram · VK · YouTube</span>
        </div>
        <div className="settings-overview-card">
          <span className="settings-overview-label">Кандидаты</span>
          <strong>{system.candidateProfiles}</strong>
          <span>{system.rawSocialSnapshots} сырых снимков</span>
        </div>
        <div className="settings-overview-card">
          <span className="settings-overview-label">Прокси</span>
          <strong>{data.proxies.length || 0}</strong>
          <span>{data.settings.proxyEnabled ? "используются" : "выключены"}</span>
        </div>
      </section>

      <AutoSaveSettingsForm action={updateSettingsAction} className="settings-layout settings-form">
        <div className="settings-column">
          <section className="panel compact-panel settings-access-panel">
            <div className="panel-header"><h2 className="panel-title">Доступ</h2></div>
            <div className="form-grid">
              <label className="field-label">Почта администратора<input className="input" value={data.adminEmail} readOnly /></label>
              <label className="field-label">Название кабинета<input className="input" value={data.appName} readOnly /></label>
              <p className="muted compact-note">Секреты входа задаются через env. Из интерфейса меняем только рабочие настройки вроде прокси и хранения логов.</p>
            </div>
          </section>

          <section className="panel compact-panel settings-system-panel">
            <div className="panel-header">
              <h2 className="panel-title">Состояние системы</h2>
              <StatusBadge status={system.ok ? "SUCCESS" : "FAILED"} />
            </div>
            <div className="settings-list">
              <Row label="База" value={system.ok ? `OK, ${system.latencyMs} мс` : system.error ?? "Ошибка"} />
              <Row label="Сборщик" value={`${system.workerOnline ? "онлайн" : "ожидает задач"} · ${system.workerStatus}${system.workerMessage ? ` · ${formatWorkerMessage(system.workerMessage)}` : ""}`} />
              <Row label="Очередь сборов" value={`${system.socialQueue.queued} в очереди, ${system.socialQueue.running} в работе, ${system.socialQueue.failed} с ошибкой`} />
              <Row label="Потоки платформ" value={formatSocialLanes(system.socialLanes)} />
              <Row label="Последний успех" value={formatDateTime(system.lastSuccessAt)} />
              <Row label="Кандидаты" value={String(system.candidateProfiles)} />
              <Row label="Сырые снимки соцсетей" value={String(system.rawSocialSnapshots)} />
            </div>
          </section>

          <section className="panel compact-panel settings-proxy-panel">
            <div className="panel-header"><h2 className="panel-title">Прокси и хранение</h2></div>
            <div className="form-grid">
              <label className="check-row"><input type="checkbox" name="proxyEnabled" defaultChecked={data.settings.proxyEnabled} />Использовать прокси</label>
              <label className="field-label">Прокси URL<input className="input" name="proxyUrl" placeholder="http://user:pass@host:port или socks5://user:pass@host:port" defaultValue={data.settings.proxyUrl ?? ""} /></label>
              <label className="field-label">Пул прокси<textarea className="input textarea" name="proxyPool" placeholder="http://user:pass@host:port или socks5://user:pass@host:port" defaultValue={data.proxies.map((proxy) => proxy.url).join("\n")} /></label>
              <div className="inline-fields">
                <label className="field-label">Сырые снимки, дней<input className="input" name="rawSnapshotRetentionDays" type="number" min="1" max="365" defaultValue={data.settings.rawSnapshotRetentionDays} /></label>
                <label className="field-label">События, дней<input className="input" name="scanEventRetentionDays" type="number" min="1" max="365" defaultValue={data.settings.scanEventRetentionDays} /></label>
              </div>
              <div className="proxy-health-list">
                {data.proxies.length ? data.proxies.map((proxy) => (
                  <div className="proxy-health-row" key={proxy.id}>
                    <span className="proxy-url">{maskProxyUrl(proxy.url)}</span>
                    {data.settings.proxyEnabled ? (
                      <StatusBadge status={proxy.status === "OK" ? "SUCCESS" : proxy.status === "FAILED" ? "FAILED" : "BLOCKED"} />
                    ) : (
                      <span className="badge blue">Выключено</span>
                    )}
                    <span className="muted">{data.settings.proxyEnabled ? `сбоев ${proxy.failCount}` : "не используется"}</span>
                    <span className="muted">{proxy.blockedUntil ? `до ${formatDateTime(proxy.blockedUntil)}` : "без паузы"}</span>
                    {proxy.lastError ? <span className="muted truncate">{data.settings.proxyEnabled ? proxy.lastError : `последняя проверка: ${proxy.lastError}`}</span> : null}
                    {proxy.status !== "OK" || proxy.blockedUntil || proxy.lastError ? (
                      <PendingButton
                        className="button compact"
                        formAction={resetProxyStatusAction}
                        name="proxyId"
                        value={proxy.id}
                        pendingText="Сбрасываем"
                      >
                        Сбросить
                      </PendingButton>
                    ) : null}
                  </div>
                )) : <p className="muted compact-note">Прокси в пуле нет.</p>}
              </div>
            </div>
          </section>
        </div>

        <div className="settings-column">
          <section className="panel compact-panel settings-platform-card instagram">
            <div className="panel-header">
              <h2 className="panel-title">Instagram сборщик</h2>
              <div className="panel-actions">
                <StatusBadge status={data.instagram.usernameConfigured && data.instagram.passwordConfigured ? "SUCCESS" : "FAILED"} />
                <InstagramLoginCheckButton />
              </div>
            </div>
            <div className="settings-list">
              <Row label="Логин" value={data.instagram.usernameConfigured ? "задан" : "не задан"} />
              <Row label="Пароль" value={data.instagram.passwordConfigured ? "задан" : "не задан"} />
              <Row label="Прокси" value={data.instagram.proxyConfigured ? "задан через env" : data.settings.proxyEnabled ? "можно взять из пула" : "не задан"} />
              <Row label="Файл сессии" value={data.instagram.sessionFile} />
              <Row label="Python" value={data.instagram.pythonBin} />
            </div>
          </section>

          <section className="panel compact-panel settings-platform-card vk">
            <div className="panel-header">
              <h2 className="panel-title">VK сборщик</h2>
              <div className="panel-actions">
                <StatusBadge status={data.vk.tokenConfigured ? "SUCCESS" : "FAILED"} />
                <VkLoginCheckButton />
              </div>
            </div>
            <div className="settings-list">
              <Row label="Источник VK доступа" value={data.vk.preferredToken === "none" ? "не задан" : data.vk.preferredToken} />
              <Row label="VK_ACCESS_TOKEN" value={data.vk.accessTokenConfigured ? "задан" : "не задан"} />
              <Row label="vk_api repo" value={data.vk.apiRepoPath} />
              <Row label="Python" value={data.vk.pythonBin} />
            </div>
            <p className="muted compact-note">Для groups.search нужен пользовательский access token. Если он истёк или привязан к другому IP, переподключите аккаунт через вход VK на сервере worker.</p>
          </section>

          <section className="panel compact-panel settings-platform-card youtube">
            <div className="panel-header">
              <h2 className="panel-title">YouTube сборщик</h2>
              <StatusBadge status={data.youtube.apiKeyConfigured ? "SUCCESS" : "FAILED"} />
            </div>
            <div className="settings-list">
              <Row label="YOUTUBE_API_KEY" value={data.youtube.apiKeyConfigured ? "задан" : "не задан"} />
              <Row label="Python" value={data.youtube.pythonBin} />
              <Row label="Скрипт сборщика" value={data.youtube.collectorScript} />
            </div>
          </section>

        </div>
      </AutoSaveSettingsForm>

      <section className="panel compact-panel platform-account-hub">
        <div className="panel-header">
        <div>
          <h2 className="panel-title">Аккаунты платформ</h2>
          <p className="muted compact-note">Единое место для добавления Instagram аккаунтов, VK доступов и YouTube API ключей. Секреты сохраняются, но обратно в интерфейс не выводятся.</p>
        </div>
          <div className="platform-account-summary">
            <span>IG {data.instagramAccounts.length}</span>
            <span>VK {data.vkAccounts.length}</span>
            <span>YT {data.youtubeAccounts.length}</span>
          </div>
        </div>

        <div className="platform-account-help" id="accounts">
          <div>
            <strong>Один порядок для всех платформ</strong>
            <span>В каждой карточке сверху показано состояние, затем что сделать, ниже добавление доступов и список аккаунтов. Worker берет только здоровые доступы.</span>
          </div>
          <Link className="button" href="/guide#accounts">Методичка</Link>
        </div>

        <div className="platform-account-hub-grid">
          <InstagramAccountPool
            accounts={data.instagramAccounts}
            concurrency={data.instagramConcurrency}
            deleteAction={deleteSocialPlatformAccountAction}
          />
          <PlatformCredentialPool
            title="VK"
            subtitle="Подключайте VK через вход в аккаунт. Доступ сохраняется внутри и обновляется при повторном входе в тот же VK user_id."
            concurrency={data.vkConcurrency}
            platform="VK"
            accounts={data.vkAccounts}
            deleteAction={deleteSocialPlatformAccountAction}
          />
          <PlatformCredentialPool
            title="YouTube"
            subtitle="Добавляйте несколько ключей, чтобы сборщик мог переключаться при квотах или ошибках отдельного ключа."
            concurrency={data.youtubeConcurrency}
            platform="YOUTUBE"
            accounts={data.youtubeAccounts}
            deleteAction={deleteSocialPlatformAccountAction}
          />
        </div>

        <div className="platform-account-maintenance">
          <form action={deleteSocialPlatformAccountsAction} className="platform-account-delete-all">
            <input type="hidden" name="platform" value="ALL" />
            <label className="field-label">
              Удалить весь пул аккаунтов
              <input className="input" name="confirm" placeholder="введите DELETE" />
            </label>
            <button className="button danger" type="submit">Удалить все аккаунты</button>
            <p className="muted compact-note">Удаляются только аккаунты из базы. Env-доступы в .env не стираются.</p>
          </form>
        </div>
      </section>
    </div>
  );
}

type InstagramAccountView = {
  accountKey: string;
  label: string;
  username: string | null;
  status: string;
  blockedUntil: Date | null;
  lastError: string | null;
  enabled: boolean;
  hasPassword: boolean;
  hasSessionSettings: boolean;
  hasProxy: boolean;
  sessionFile: string | null;
  authSource: "helper_session" | "session_file" | "sessionid" | "password" | "mixed" | "missing";
};

function InstagramAccountPool({
  accounts,
  concurrency,
  deleteAction
}: {
  accounts: InstagramAccountView[];
  concurrency: number;
  deleteAction: (formData: FormData) => Promise<void>;
}) {
  const accessIssueAccounts = accounts.filter(hasInstagramAccessIssue);
  const problemAccounts = accounts.filter((account) => account.status !== "OK" || account.lastError || account.blockedUntil);
  const state = instagramCardState(accounts, accessIssueAccounts, problemAccounts);

  return (
    <section className="platform-account-card instagram">
      <div className="platform-account-card-head">
        <div>
          <h3>Instagram</h3>
          <p className="muted compact-note">Helper-first flow: refresh the donor session via helper, upload the JSON, then run worker only on that prepared session.</p>
        </div>
        <div className="platform-account-card-actions">
          <Link className="button primary" href="/settings/connect/instagram">Добавить доступы</Link>
          <span className="account-count">{accounts.length} / потоков {concurrency}</span>
        </div>
      </div>

      <div className="platform-account-body">
        <PlatformAccountState
          tone="instagram"
          state={state.state}
          title={state.title}
          description={state.description}
          steps={state.steps}
          action={accessIssueAccounts.length ? (
            <span>
              Проверка выполняется на Railway через серверный proxy. Вход в браузере на этом компьютере не передает серверу сессию.
            </span>
          ) : null}
        />

        <div className="platform-account-access-column">
          <AccountListEmpty show={!accounts.length} text="Дополнительных Instagram аккаунтов пока нет. Если пул пустой, worker использует env-аккаунт." />
          {accounts.length ? (
            <div className="platform-account-list">
              {accounts.map((account, index) => {
                const needsManualLogin = hasInstagramAccessIssue(account);
                const accountName = instagramAccountName(account);
                return (
                  <div className={`platform-account-row${needsManualLogin ? " instagram-needs-action" : ""}`} key={`${account.accountKey}:${index}`}>
                    <div className="platform-account-main">
                      <strong>{account.label}</strong>
                      <span>@{account.username || "без логина"}</span>
                    </div>
                    <StatusBadge status={accountStatusForBadge(account.status, account.enabled)} />
                    <div className="platform-account-meta">
                      <span>{account.enabled ? "включен" : "выключен"}</span>
                      <span>{account.hasPassword ? "пароль есть" : "пароля нет"}</span>
                      <span>{account.hasSessionSettings ? "json ?????? ????" : "json ?????? ???"}</span>
                      <span>{instagramAuthSourceLabel(account.authSource)}</span>
                      <span>{account.hasProxy ? "proxy ????" : "proxy ?????"}</span>
                      <span className="truncate">
                        {account.blockedUntil ? `пауза до ${formatDateTime(account.blockedUntil)}` : account.sessionFile || "без паузы"}
                      </span>
                      {account.lastError ? (
                        <span className="truncate" title={account.lastError}>
                          {instagramAccountErrorText(account, accountName)}
                        </span>
                      ) : null}
                    </div>
                    <div className="platform-account-actions">
                      <InstagramLoginCheckButton accountKey={account.accountKey} compact />
                      <form action={toggleInstagramAccountAction}>
                        <input type="hidden" name="accountKey" value={account.accountKey} />
                        <input type="hidden" name="enabled" value={account.enabled ? "false" : "true"} />
                        <button className="button" type="submit">{account.enabled ? "Выкл" : "Вкл"}</button>
                      </form>
                      <form action={deleteAction}>
                        <input type="hidden" name="platform" value="INSTAGRAM" />
                        <input type="hidden" name="accountKey" value={account.accountKey} />
                        <button className="button danger" type="submit">Удалить</button>
                      </form>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function instagramCardState(accounts: InstagramAccountView[], accessIssueAccounts: InstagramAccountView[], problemAccounts: InstagramAccountView[]) {
  if (!accounts.length) {
    return {
      state: "empty" as const,
      title: "Нет Instagram-аккаунтов",
      description: "Добавьте хотя бы один аккаунт. После этого worker сможет брать его из общего пула.",
      steps: ["Откройте добавление доступов.", "Добавьте логин, пароль и proxy при необходимости.", "Запустите проверку входа."]
    };
  }
  if (accessIssueAccounts.length) {
    return {
      state: "error" as const,
      title: "Railway не вошел в Instagram",
      description: "Сборщик использует отдельную серверную сессию. Вход в Instagram на вашем компьютере не влияет на сервер.",
      steps: ["Нажмите «Проверить на сервере».", "Дождитесь результата рядом с кнопкой.", "Рабочим считается только статус «Готов» после серверной проверки."]
    };
  }
  if (problemAccounts.length) {
    return {
      state: "warning" as const,
      title: "Есть аккаунты с ошибками",
      description: "Проверьте строки ниже. Worker будет пропускать проблемные доступы и брать следующий здоровый аккаунт.",
      steps: ["Откройте строку с ошибкой.", "Нажмите «Проверить».", "Если ошибка ушла, очередь продолжит работу."]
    };
  }
  return {
    state: "ok" as const,
    title: "Instagram готов",
    description: "Аккаунты добавлены. Worker будет распределять сборы между включенными здоровыми доступами.",
    steps: ["Следите за статусом строк.", "При ошибке используйте кнопку проверки.", "Для массового добавления откройте блок ниже."]
  };
}

function hasInstagramAccessIssue(account: InstagramAccountView) {
  const lastError = account.lastError?.toLocaleLowerCase("en-US") ?? "";
  return account.authSource === "mixed"
    || account.authSource === "missing"
    || account.status === "MISSING_CREDENTIALS"
    || /challenge_required|checkpoint|login_required/.test(lastError);
}

function instagramAccountName(account: InstagramAccountView) {
  return account.username ? `@${account.username}` : account.label;
}

function instagramAuthSourceLabel(source: InstagramAccountView["authSource"]) {
  switch (source) {
    case "helper_session":
      return "helper donor session";
    case "session_file":
      return "session file only";
    case "sessionid":
      return "legacy sessionid";
    case "password":
      return "legacy password";
    case "mixed":
      return "conflicting auth state";
    default:
      return "session not prepared";
  }
}

function instagramAccountErrorText(account: InstagramAccountView, accountName: string) {
  const error = account.lastError?.toLocaleLowerCase("en-US") ?? "";
  if (account.authSource === "mixed") {
    return `${accountName}: conflicting Instagram auth sources are stored together. Reconnect this account through the helper and upload one fresh JSON`;
  }
  if (account.authSource === "password" || /instagram_helper_session_required/.test(error)) {
    return `${accountName}: password-only access is treated as legacy. Refresh the donor session through the helper and reconnect the exported JSON`;
  }
  if (account.authSource === "missing" || /missing_credentials|instagram_mixed_auth_state/.test(error)) {
    return `${accountName}: no prepared donor session is stored on the server. Run the helper, sign in to Instagram, then reconnect the JSON`;
  }
  if (/checkpoint_challenge_required|apipath=\/challenge\//.test(error)) {
    return `${accountName}: Instagram stopped the login with a challenge. Confirm the login through the helper or the official app, then reconnect the JSON`;
  }
  if (/challenge_required|checkpoint|login_required/.test(error)) {
    return `${accountName}: the current donor session no longer passes checks. Refresh it through the helper, reconnect the account, then reset cooldown and retry`;
  }
  if (/bad_credentials/.test(error)) {
    return `${accountName}: Instagram rejected the password. Use the helper for the next login and save a fresh donor session`;
  }
  return account.lastError || `${accountName}: server-side login check did not pass`;
}

function PlatformCredentialPool({
  title,
  subtitle,
  concurrency,
  platform,
  accounts,
  deleteAction
}: {
  title: string;
  subtitle: string;
  concurrency: number;
  platform: "VK" | "YOUTUBE";
  accounts: Array<{
    accountKey: string;
    label: string;
    status: string;
    blockedUntil: Date | null;
    lastError: string | null;
    consecutiveErrors: number;
    enabled: boolean;
    hasSecret: boolean;
    hasPassword?: boolean;
    login?: string;
    tokenType: string;
  }>;
  deleteAction: (formData: FormData) => Promise<void>;
}) {
  const problemAccounts = accounts.filter((account) => platformCredentialNeedsAttention(account));
  const state = credentialCardState(platform, accounts, problemAccounts);
  const connectHref = platform === "VK" ? "/settings/connect/vk" : "/settings/connect/youtube";

  return (
    <section className={`platform-account-card ${platform.toLocaleLowerCase("en-US")}`}>
      <div className="platform-account-card-head">
        <div>
          <h3>{title}</h3>
          <p className="muted compact-note">{subtitle}</p>
        </div>
        <div className="platform-account-card-actions">
          <Link className="button primary" href={connectHref}>Добавить доступы</Link>
          <span className="account-count">{accounts.length} / потоков {concurrency}</span>
        </div>
      </div>

      <div className="platform-account-body">
        <PlatformAccountState
          tone={platform.toLocaleLowerCase("en-US") as "vk" | "youtube"}
          state={state.state}
          title={state.title}
          description={state.description}
          steps={state.steps}
        />

        <div className="platform-account-access-column">
          <AccountListEmpty show={!accounts.length} text="Дополнительных ключей пока нет. Если пул пустой, worker использует env-настройки." />
          {accounts.length ? (
            <div className="platform-account-list">
              {accounts.map((account, index) => {
                const needsAttention = platformCredentialNeedsAttention(account);
                return (
              <div className={`platform-account-row${needsAttention ? " platform-needs-action" : ""}`} key={`${account.accountKey}:${index}`}>
                <div className="platform-account-main">
                  <strong>{account.label}</strong>
                  <span>{account.login || (platform === "VK" ? "вход через VK" : account.tokenType ? `тип: ${account.tokenType}` : platform)}</span>
                </div>
                <StatusBadge status={accountStatusForBadge(account.status, account.enabled)} />
                <div className="platform-account-meta">
                  <span>{account.enabled ? "включен" : "выключен"}</span>
                  <span className={!account.hasSecret ? "account-warning" : undefined}>{account.hasSecret ? (platform === "YOUTUBE" ? "ключ есть" : "доступ есть") : (platform === "YOUTUBE" ? "ключа нет" : "доступа нет")}</span>
                  {platform === "VK" ? <span>{account.hasPassword ? "пароль есть" : "пароля нет"}</span> : null}
                  <span className="truncate">{account.blockedUntil ? `пауза до ${formatDateTime(account.blockedUntil)}` : account.consecutiveErrors ? `ошибок ${account.consecutiveErrors}` : "без паузы"}</span>
                  {account.lastError ? <span className="truncate">{account.lastError}</span> : null}
                  {needsAttention ? (
                    <span className="account-warning">
                      {platform === "VK" ? "переподключите VK и проверьте" : "добавьте рабочий API key и проверьте"}
                    </span>
                  ) : null}
                </div>
                <div className="platform-account-actions">
                  {platform === "VK" ? <VkLoginCheckButton accountKey={account.accountKey} compact /> : null}
                  {platform === "YOUTUBE" ? <YouTubeLoginCheckButton accountKey={account.accountKey} /> : null}
                  <form action={toggleSocialPlatformAccountAction}>
                    <input type="hidden" name="platform" value={platform} />
                    <input type="hidden" name="accountKey" value={account.accountKey} />
                    <input type="hidden" name="enabled" value={account.enabled ? "false" : "true"} />
                    <button className="button" type="submit">{account.enabled ? "Выкл" : "Вкл"}</button>
                  </form>
                  <form action={deleteAction}>
                    <input type="hidden" name="platform" value={platform} />
                    <input type="hidden" name="accountKey" value={account.accountKey} />
                    <button className="button danger" type="submit">Удалить</button>
                  </form>
                </div>
              </div>
                );
              })}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

type PlatformAccountStateName = "ok" | "warning" | "error" | "empty";
type PlatformAccountTone = "instagram" | "vk" | "youtube";

function PlatformAccountState({
  tone,
  state,
  title,
  description,
  steps,
  action
}: {
  tone: PlatformAccountTone;
  state: PlatformAccountStateName;
  title: string;
  description: ReactNode;
  steps: string[];
  action?: ReactNode;
}) {
  return (
    <div className={`platform-account-state ${tone} ${state}`} role={state === "ok" ? undefined : "status"}>
      <div className="platform-account-state-copy">
        <strong>{title}</strong>
        <span>{description}</span>
      </div>
      <ol className="platform-account-state-steps">
        {steps.map((step) => <li key={step}>{step}</li>)}
      </ol>
      {action ? <div className="platform-account-state-actions">{action}</div> : null}
    </div>
  );
}

function platformCredentialNeedsAttention(account: {
  status: string;
  blockedUntil: Date | null;
  lastError: string | null;
  enabled: boolean;
  hasSecret: boolean;
  consecutiveErrors: number;
}) {
  return !account.enabled || !account.hasSecret || account.status !== "OK" || Boolean(account.blockedUntil) || Boolean(account.lastError) || account.consecutiveErrors > 0;
}

function credentialCardState(
  platform: "VK" | "YOUTUBE",
  accounts: Array<{ hasSecret: boolean; status: string; lastError: string | null }>,
  problemAccounts: Array<{ hasSecret: boolean; status: string; lastError: string | null }>
) {
  if (!accounts.length) {
    return {
      state: "empty" as const,
      title: platform === "VK" ? "Нет VK-доступов" : "Нет YouTube-ключей",
      description: platform === "VK"
        ? "Подключите VK через вход в аккаунт, чтобы сборщик мог искать через VK."
        : "Добавьте YouTube Data API key, чтобы сборщик мог искать через YouTube.",
      steps: platform === "VK"
        ? ["Откройте добавление доступов.", "Войдите в нужный VK аккаунт.", "Вернитесь к списку и нажмите «Проверить»."]
        : ["Откройте добавление доступов.", "Вставьте API key.", "Нажмите «Проверить» в строке."]
    };
  }

  const missingSecretCount = accounts.filter((account) => !account.hasSecret).length;
  if (missingSecretCount || problemAccounts.length) {
    return {
      state: "error" as const,
      title: platform === "VK" ? "VK требует внимания" : "YouTube требует внимания",
      description: platform === "VK"
        ? "В строках ниже есть VK доступ без доступа или ошибка проверки. Worker будет брать следующий здоровый доступ."
        : "В строках ниже есть ключ без доступа или ошибка проверки. Worker будет брать следующий здоровый ключ.",
      steps: platform === "VK"
        ? ["Переподключите VK через вход.", "Проверьте строку.", "Оставьте включенными только рабочие доступы."]
        : ["Добавьте рабочий API key.", "Проверьте строку.", "Оставьте включенными только рабочие ключи."]
    };
  }

  return {
    state: "ok" as const,
    title: platform === "VK" ? "VK готов" : "YouTube готов",
    description: platform === "VK"
      ? "VK доступы добавлены. Worker будет переключаться между включенными здоровыми аккаунтами."
      : "Ключи добавлены. Worker будет переключаться между включенными здоровыми ключами.",
    steps: ["Следите за статусом строк.", "При ошибке нажмите «Проверить».", "Для резерва добавьте несколько доступов."]
  };
}

function AccountListEmpty({ show, text }: { show: boolean; text: string }) {
  return show ? <p className="platform-account-empty">{text}</p> : null;
}

function accountStatusForBadge(status: string, enabled: boolean) {
  if (!enabled) return "STOPPED";
  if (status === "OK") return "SUCCESS";
  if (status === "BLOCKED" || status === "FAILED" || status === "MISSING_CREDENTIALS" || status === "RUNNING") return status;
  return "PENDING";
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="settings-row">
      <span className="muted">{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function formatWorkerMessage(message: string) {
  const iso = message.match(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/)?.[0];
  if (!iso) return message;
  return message.replace(iso, formatDateTime(new Date(iso)));
}

function maskProxyUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.username || url.password) {
      url.username = url.username ? "***" : "";
      url.password = url.password ? "***" : "";
    }
    return url.toString();
  } catch {
    return value.replace(/:\/\/([^:@]+):([^@]+)@/, "://***:***@");
  }
}

function formatSocialLanes(lanes: { running: Record<string, number>; queued: Record<string, number> }) {
  const platforms = ["INSTAGRAM", "VK", "YOUTUBE"];
  return platforms.map((platform) => {
    const running = lanes.running[platform] ?? 0;
    const queued = lanes.queued[platform] ?? 0;
    return `${platform}: ${running} в работе / ${queued} в очереди`;
  }).join(" · ");
}
