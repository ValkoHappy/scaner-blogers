import { PageHeader } from "@/components/shell";
import Link from "next/link";
import { addYouTubeAccountAction, addYouTubeAccountsBulkAction } from "../../actions";

export default function ConnectYouTubePage() {
  return (
    <div className="settings-connect-screen">
      <PageHeader
        title="Подключить YouTube"
        subtitle="Добавьте один YouTube API key или вставьте несколько ключей списком для резерва и переключения при квотах."
      />

      <section id="single" className="panel compact-panel settings-connect-panel">
        <div className="settings-connect-intro">
          <div>
            <h2 className="panel-title">Один YouTube API key</h2>
            <p className="muted compact-note">
              После сохранения ключ появится в общем пуле. Worker будет брать включенные рабочие ключи и пропускать проблемные.
            </p>
          </div>
          <Link className="button" href="/settings#accounts">Назад к настройкам</Link>
        </div>
        <div className="settings-connect-mode-row" aria-label="Способ добавления">
          <a className="button primary" href="#single">Один ключ</a>
          <a className="button" href="#bulk">Несколько списком</a>
        </div>

        <div className="vk-connect-steps">
          <div className="vk-connect-step">
            <span>1</span>
            <strong>Откройте Google Cloud</strong>
            <p>Нужен API key с доступом к YouTube Data API v3.</p>
          </div>
          <div className="vk-connect-step">
            <span>2</span>
            <strong>Вставьте ключ</strong>
            <p>Название нужно только чтобы понимать, какой ключ используется.</p>
          </div>
          <div className="vk-connect-step">
            <span>3</span>
            <strong>Проверьте строку</strong>
            <p>После добавления вернитесь к списку и нажмите «Проверить».</p>
          </div>
        </div>

        <form action={addYouTubeAccountAction} className="settings-connect-form">
          <label className="field-label">
            Название
            <input className="input" name="label" placeholder="YouTube основной" />
          </label>
          <label className="field-label settings-connect-wide">
            API key
            <input className="input" name="apiKey" type="password" placeholder="AIza..." required />
          </label>
          <div className="settings-connect-actions">
            <button className="button primary" type="submit">Сохранить ключ</button>
            <Link className="button" href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer">
              Открыть Google Cloud
            </Link>
          </div>
        </form>
      </section>

      <section id="bulk" className="panel compact-panel settings-connect-note">
        <h2 className="panel-title">Несколько ключей списком</h2>
        <p className="muted compact-note">
          Если ключей несколько, вставьте их списком. Одна строка = один YouTube ключ, после сохранения все появятся в пуле.
        </p>
        <form action={addYouTubeAccountsBulkAction} className="settings-connect-form">
          <label className="field-label settings-connect-wide">
            Список ключей
            <textarea className="input textarea" name="accounts" placeholder={"Основной ключ|AIza...\nРезервный ключ|AIza..."} required />
          </label>
          <div className="settings-connect-actions">
            <button className="button primary" type="submit">Добавить список</button>
          </div>
        </form>
      </section>
    </div>
  );
}
