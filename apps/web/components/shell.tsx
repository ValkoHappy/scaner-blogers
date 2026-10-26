import Link from "next/link";
import { logoutAction } from "@/lib/auth";
import { ActiveNavLink } from "./active-nav-link";
import { formatStatusLabel } from "./display";
import { Icons } from "./icons";
import { BackButton, ThemeToggle } from "./navigation-actions";
import { PendingButton } from "./pending-button";

const nav = [
  { href: "/", label: "Дашборд", icon: Icons.Gauge },
  { href: "/keywords", label: "Ключевые слова", icon: Icons.FileText },
  { href: "/candidates", label: "Кандидаты", icon: Icons.Boxes },
  { href: "/scans", label: "Сборы", icon: Icons.Search },
  { href: "/health", label: "Здоровье", icon: Icons.ShieldCheck },
  { href: "/guide", label: "Методичка", icon: Icons.BookOpen },
  { href: "/settings", label: "Настройки", icon: Icons.Settings }
];

export function AppShell({
  children,
  systemStatus
}: {
  children: React.ReactNode;
  systemStatus?: {
    ok: boolean;
    workerOnline: boolean;
    workerStatus: string;
    queued: number;
    running: number;
  };
}) {
  const hasPendingWork = systemStatus ? systemStatus.queued > 0 || systemStatus.running > 0 : false;
  const warning = systemStatus && (!systemStatus.ok || (!systemStatus.workerOnline && hasPendingWork))
    ? systemStatus.ok
      ? workerWarningText(systemStatus)
      : "База данных недоступна. Проверьте DATABASE_URL и SQLite."
    : null;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link className="brand" href="/">
          <BrandMark />
          <div>
            <div className="brand-title">ScanerBlogers</div>
            <div className="brand-subtitle">Discovery</div>
          </div>
        </Link>
        <nav className="nav-list">
          {nav.map((item) => (
            <ActiveNavLink href={item.href} key={item.href}>
              <item.icon size={18} />
              {item.label}
            </ActiveNavLink>
          ))}
        </nav>
        <div className="sidebar-footer">
          <ThemeToggle />
          <div className="user-box">
            <div className="brand-title">Admin</div>
            <div className="brand-subtitle">закрытый доступ</div>
            <form action={logoutAction} style={{ marginTop: 12 }}>
              <PendingButton className="nav-button" pendingText="Выходим" type="submit">Выйти</PendingButton>
            </form>
          </div>
        </div>
      </aside>
      <main className="main">
        <BackButton />
        {warning ? (
          <div className="system-banner">
            {warning}
            <Link href="/health"> Открыть здоровье системы</Link>
          </div>
        ) : null}
        {children}
      </main>
    </div>
  );
}

function workerWarningText(systemStatus: { workerStatus: string; queued: number; running: number }) {
  if (systemStatus.running > 0) {
    return `Сборщик давно не присылал сигнал во время работы. Статус: ${systemStatus.workerStatus}. В очереди: ${systemStatus.queued}, выполняется: ${systemStatus.running}.`;
  }
  return `В очереди есть задачи, но worker сейчас не активен. Статус: ${systemStatus.workerStatus}. В очереди: ${systemStatus.queued}.`;
}

export function BrandMark() {
  return (
    <div className="brand-mark" aria-hidden="true">
      <svg viewBox="0 0 44 44" role="img">
        <defs>
          <linearGradient id="logoPanel" x1="7" y1="5" x2="37" y2="39" gradientUnits="userSpaceOnUse">
            <stop stopColor="#60A5FA" />
            <stop offset="0.55" stopColor="#2563EB" />
            <stop offset="1" stopColor="#1E3A8A" />
          </linearGradient>
          <linearGradient id="logoSignal" x1="17" y1="13" x2="32" y2="33" gradientUnits="userSpaceOnUse">
            <stop stopColor="#FFFFFF" />
            <stop offset="1" stopColor="#DBEAFE" />
          </linearGradient>
        </defs>
        <rect x="4" y="4" width="36" height="36" rx="10" fill="url(#logoPanel)" />
        <circle cx="19" cy="17.2" r="5.1" fill="rgba(255,255,255,.2)" stroke="rgba(255,255,255,.78)" strokeWidth="1.8" />
        <path d="M10.8 31.2c1.35-5.05 4.05-7.55 8.2-7.55 4.1 0 6.82 2.5 8.2 7.55" fill="none" stroke="rgba(255,255,255,.78)" strokeLinecap="round" strokeWidth="2" />
        <circle cx="29.2" cy="28.7" r="5.6" fill="url(#logoSignal)" />
        <path d="m33.5 32.9 3.2 3.15" stroke="#E9FFF9" strokeWidth="2.3" strokeLinecap="round" />
        <circle cx="29.2" cy="28.7" r="2.25" fill="#1D4ED8" />
      </svg>
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  children
}: {
  title: string;
  subtitle: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="topbar">
      <div>
        <h1 className="page-title">{title}</h1>
        <p className="page-subtitle">{subtitle}</p>
      </div>
      {children ? <div className="toolbar">{children}</div> : null}
    </div>
  );
}

export function StatusBadge({ status }: { status?: string | null }) {
  const value = status ?? "UNKNOWN";
  const color = value === "SUCCESS" || value === "ACTIVE" || value === "SAVED"
    ? "green"
    : value === "FAILED" || value === "STOPPED" || value === "CANCELED" || value === "REJECTED" || value === "MISSING_CREDENTIALS"
      ? "red"
      : value === "BLOCKED" || value === "STOPPING" || value === "CONTACTED" || value === "PRIORITY"
        ? "orange"
        : "blue";
  return <span className={`badge ${color}`}>{value === "STOPPING" ? "Останавливается" : formatStatusLabel(value)}</span>;
}
