import type { ReactNode } from "react";
import Link from "next/link";
import { Icons } from "@/components/icons";
import { PageHeader } from "@/components/shell";

const accountExamples = [
  {
    title: "Instagram",
    description: "Одна строка - один аккаунт. Proxy и файл сессии можно добавить через вертикальную черту.",
    example: "login:password\nlogin:password|socks5://user:pass@host:port|.instagram/account-2.session.json|Аккаунт 2"
  },
  {
    title: "VK",
    description: "VK подключается только через вход в аккаунт. Доступ копировать и вставлять не нужно.",
    example: "Настройки -> Аккаунты платформ -> VK -> Войти в VK и подключить"
  },
  {
    title: "YouTube",
    description: "Лучше добавить несколько API ключей. Если один ключ упрется в квоту, сборщик сможет взять следующий. Где брать ключ - в блоке ниже.",
    example: "Основной ключ|AIza...\nРезервный ключ|AIza..."
  }
];

const statusRows = [
  ["Новый", "Кандидат найден, но вручную еще не проверен."],
  ["Просмотрен", "Вы уже открывали и оценивали профиль."],
  ["Приоритет", "Хороший кандидат, его стоит выгружать или передавать дальше."],
  ["Не подходит", "Профиль не нужен в работе, но остается в базе для истории и защиты от дублей."],
  ["Экспортирован", "Кандидат уже попадал в выгрузку."]
];

export default function GuidePage() {
  return (
    <div className="guide-screen">
      <PageHeader title="Методичка" subtitle="Как пользоваться админкой, добавлять ключи, аккаунты и разбирать ошибки">
        <Link className="button" href="/settings">
          <Icons.Settings size={16} />
          Аккаунты
        </Link>
        <Link className="button primary" href="/keywords">
          <Icons.Search size={16} />
          Ключевые слова
        </Link>
      </PageHeader>

      <section className="panel guide-hero">
        <div>
          <span className="guide-kicker">Рабочий порядок</span>
          <h2>Сначала доступы, потом ключи, потом сборы и проверка кандидатов.</h2>
          <p>
            Система хранит найденные профили в базе, режет дубли по паре платформа + ID профиля
            и дает выгрузку в CSV/Excel. Instagram, VK и YouTube лучше запускать отдельно, если
            нужно точнее контролировать лимиты и ошибки.
          </p>
        </div>
        <ol className="guide-steps">
          <li><strong>1</strong><span>Добавить аккаунты и API ключи в настройках.</span></li>
          <li><strong>2</strong><span>Загрузить список ключевых слов строками.</span></li>
          <li><strong>3</strong><span>Запустить сбор по нужным площадкам.</span></li>
          <li><strong>4</strong><span>Проверить кандидатов и отметить статус.</span></li>
          <li><strong>5</strong><span>Выгрузить результат в CSV или Excel.</span></li>
        </ol>
      </section>

      <section className="guide-grid">
        <GuideCard
          icon={<Icons.FileText size={20} />}
          title="Ключевые слова"
          href="/keywords"
          items={[
            "Вставляйте хоть 300 строк сразу: одна строка = один ключ.",
            "Хэштег создается автоматически: «массаж лица» превращается в #массажлица.",
            "Диапазон подписчиков задается отдельно для Instagram, VK и YouTube.",
            "Кнопка «Добавить и запустить» сразу ставит выбранные площадки в очередь."
          ]}
        />
        <GuideCard
          icon={<Icons.Users size={20} />}
          title="Кандидаты"
          href="/candidates"
          items={[
            "Это единая база найденных профилей, но карточки разных платформ не склеиваются.",
            "Фильтры помогают смотреть Instagram, VK и YouTube отдельно.",
            "Статусы нужны для ручной оценки: просмотрен, приоритет, не подходит.",
            "Описание в таблицах сокращается, полные данные остаются в базе и экспорте."
          ]}
        />
        <GuideCard
          icon={<Icons.Search size={20} />}
          title="Сборы"
          href="/scans"
          items={[
            "На странице видно очередь, активные задачи, ошибки и последние события.",
            "Если worker не работает, задачи будут висеть в очереди и это будет видно в баннере.",
            "Instagram после предупреждений лучше не добивать, а дождаться cooldown.",
            "VK ошибка доступа означает, что аккаунт надо переподключить через вход."
          ]}
        />
        <GuideCard
          icon={<Icons.Download size={20} />}
          title="Выгрузка"
          href="/candidates"
          items={[
            "CSV и Excel скачиваются прямо со страницы кандидатов.",
            "Можно выгружать все площадки вместе или отдельно Instagram/VK/YouTube.",
            "После выгрузки кандидатов можно отметить как экспортированных.",
            "Для клиента лучше отдавать отфильтрованный список без лишнего шума."
          ]}
        />
      </section>

      <section className="panel guide-section" id="accounts">
        <div className="guide-section-head">
          <div>
            <h2 className="panel-title">Добавление аккаунтов</h2>
            <p className="muted compact-note">Форматы строк для массового добавления в настройках.</p>
          </div>
          <Link className="button" href="/settings">Открыть настройки</Link>
        </div>
        <div className="guide-account-grid">
          {accountExamples.map((item) => (
            <article className="guide-account-card" key={item.title}>
              <h3>{item.title}</h3>
              <p>{item.description}</p>
              <pre>{item.example}</pre>
            </article>
          ))}
        </div>
        <div className="guide-warning">
          <Icons.AlertCircle size={18} />
          <span>
            Секреты сохраняются в базе или env, но обратно в интерфейсе не раскрываются.
            Удаление аккаунтов из интерфейса не стирает значения из .env.local.
          </span>
        </div>
      </section>

      <section className="panel guide-section" id="vk-token-refresh">
        <div className="guide-section-head">
          <div>
            <h2 className="panel-title">Как переподключить VK</h2>
            <p className="muted compact-note">
              Используется один и тот же путь: вход через VK OAuth. Админка сама получает и сохраняет актуальный доступ.
            </p>
          </div>
          <Link className="button" href="/settings/connect/vk">
            <Icons.Settings size={16} />
            Подключить VK
          </Link>
        </div>
        <div className="guide-troubles-grid">
          <Trouble
            title="1. Открыть подключение"
            text="В настройках откройте блок VK и нажмите «Войти в VK и подключить»."
          />
          <Trouble
            title="2. Войти руками"
            text="Если VK попросит пароль, SMS или 2FA код, пройдите вход прямо на странице VK."
          />
          <Trouble
            title="3. Разрешить доступ"
            text="После разрешения VK вернет вас обратно в админку. Ничего копировать из адресной строки не нужно."
          />
          <Trouble
            title="4. Что сохраняется"
            text="Админка сама сохранит актуальный VK доступ в пул аккаунтов. Секрет обратно в интерфейсе не показывается."
          />
          <Trouble
            title="5. Проверить"
            text="После возврата в настройки нажмите «Проверить» в строке VK аккаунта."
          />
          <Trouble
            title="6. Несколько аккаунтов"
            text="Чтобы добавить второй аккаунт, войдите в другой VK аккаунт в браузере и нажмите ту же кнопку ещё раз."
          />
          <Trouble
            title="7. Если доступ истек"
            text="Нажмите «Войти в VK и подключить» снова. Для того же VK user_id админка обновит существующую строку."
          />
          <Trouble
            title="8. Если VK не вернул обратно"
            text="Значит callback VK-приложения не настроен. Это техническая настройка проекта, а не второй способ добавления аккаунта."
          />
        </div>
        <div className="guide-warning">
          <Icons.AlertCircle size={18} />
          <span>
            Обычный вход на vk.com сам по себе не подключает аккаунт к сборщику. Нужен именно вход через кнопку в админке,
            потому что VK должен вернуть доступ обратно в приложение.
          </span>
        </div>
      </section>

      <section className="panel guide-section" id="youtube-api-key">
        <div className="guide-section-head">
          <div>
            <h2 className="panel-title">Где взять YouTube API key</h2>
            <p className="muted compact-note">
              Для поиска каналов, видео и shorts нужен ключ от YouTube Data API v3. Для публичных данных достаточно API key,
              OAuth и пользовательский вход не нужны.
            </p>
          </div>
          <a className="button" href="https://developers.google.com/youtube/registering_an_application" target="_blank" rel="noreferrer">
            <Icons.ExternalLink size={16} />
            Документация Google
          </a>
        </div>
        <div className="guide-troubles-grid">
          <Trouble
            title="1. Открыть Google Cloud"
            text="Зайдите в Google Cloud Console под Google аккаунтом. В верхнем селекторе проекта создайте новый проект или выберите существующий."
          />
          <Trouble
            title="2. Включить YouTube Data API v3"
            text="В меню APIs & Services откройте Library, найдите YouTube Data API v3 и нажмите Enable. Без этого ключ будет создан, но запросы YouTube не пойдут."
          />
          <Trouble
            title="3. Создать ключ"
            text="Откройте APIs & Services -> Credentials -> Create credentials -> API key. Google покажет строку, которая обычно начинается с AIza."
          />
          <Trouble
            title="4. Ограничить ключ"
            text="В настройках ключа включите API restrictions и оставьте только YouTube Data API v3. Application restrictions можно оставить None для MVP или ограничить серверным IP, если IP постоянный."
          />
          <Trouble
            title="5. Добавить в админку"
            text="На странице Настройки вставьте ключ в блок YouTube API ключи. Формат: Основной ключ|AIza... Один ключ = одна строка. Можно добавить несколько ключей для резерва."
          />
          <Trouble
            title="6. Если квота закончилась"
            text="Добавьте резервный ключ от другого проекта или дождитесь обновления квоты. В системе ошибка будет видна в Здоровье системы и Сборах."
          />
        </div>
        <div className="guide-warning">
          <Icons.Info size={18} />
          <span>
            Официальная документация Google говорит, что приложения для YouTube Data API используют учетные данные доступа,
            а для общего доступа к публичным данным подходит API key. Ключи и квоты управляются в Google API Console.
          </span>
        </div>
        <div className="guide-link-row">
          <a className="button" href="https://console.cloud.google.com/" target="_blank" rel="noreferrer">
            <Icons.ExternalLink size={16} />
            Google Cloud Console
          </a>
          <a className="button" href="https://console.cloud.google.com/apis/library/youtube.googleapis.com" target="_blank" rel="noreferrer">
            <Icons.ExternalLink size={16} />
            YouTube Data API v3
          </a>
          <a className="button" href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer">
            <Icons.ExternalLink size={16} />
            Credentials
          </a>
        </div>
      </section>

      <section className="guide-two-columns">
        <div className="panel guide-section">
          <h2 className="panel-title">Режимы сбора</h2>
          <div className="guide-mode-list">
            <ModeRow title="Глубокий" text="Больше результатов и проверок. Ставится по умолчанию для новых ключей." />
            <ModeRow title="Осторожный" text="Меньше нагрузки, полезно для Instagram после предупреждений или cooldown." />
            <ModeRow title="Быстрый" text="Подходит для первичной проверки, но может дать меньше кандидатов." />
          </div>
        </div>
        <div className="panel guide-section">
          <h2 className="panel-title">Статусы кандидатов</h2>
          <div className="guide-status-table">
            {statusRows.map(([status, meaning]) => (
              <div key={status}>
                <strong>{status}</strong>
                <span>{meaning}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="panel guide-section">
        <div className="guide-section-head">
          <div>
            <h2 className="panel-title">Где смотреть проблемы</h2>
            <p className="muted compact-note">Если сбор не идет, сначала открывайте «Здоровье системы».</p>
          </div>
          <Link className="button" href="/health">Открыть здоровье</Link>
        </div>
        <div className="guide-troubles-grid">
          <Trouble title="Worker idle, очередь не пустая" text="Worker не запущен или не отвечает. На сервере надо проверить сервис/процесс сборщика." />
          <Trouble title="Instagram login_required" text="Аккаунт просит повторный вход. Не запускайте новый сбор, сначала пройдите вход и дождитесь паузы." />
          <Trouble title="Instagram automation warning" text="Включается ручная пауза. Лучше добавить резервный аккаунт и снизить нагрузку." />
          <Trouble title="VK access error" text="Переподключите VK через кнопку входа и затем нажмите «Проверить» в строке аккаунта." />
          <Trouble title="YouTube quotaExceeded" text="Ключ уперся в квоту. Добавьте еще ключ или дождитесь обновления квоты." />
          <Trouble title="Мало кандидатов" text="Расширьте диапазон подписчиков, добавьте синонимы и запускайте глубокий режим." />
        </div>
      </section>
    </div>
  );
}

function GuideCard({
  icon,
  title,
  href,
  items
}: {
  icon: ReactNode;
  title: string;
  href: string;
  items: string[];
}) {
  return (
    <article className="panel guide-card">
      <div className="guide-card-head">
        <span>{icon}</span>
        <h2>{title}</h2>
      </div>
      <ul>
        {items.map((item) => <li key={item}>{item}</li>)}
      </ul>
      <Link className="guide-card-link" href={href}>Перейти</Link>
    </article>
  );
}

function ModeRow({ title, text }: { title: string; text: string }) {
  return (
    <div className="guide-mode-row">
      <strong>{title}</strong>
      <span>{text}</span>
    </div>
  );
}

function Trouble({ title, text }: { title: string; text: string }) {
  return (
    <article className="guide-trouble-card">
      <strong>{title}</strong>
      <span>{text}</span>
    </article>
  );
}
