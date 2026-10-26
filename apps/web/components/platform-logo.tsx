type PlatformLogoProps = {
  platform: string;
  size?: number;
};

export function PlatformLogo({ platform, size = 24 }: PlatformLogoProps) {
  const normalized = platform.toUpperCase();
  if (normalized === "INSTAGRAM") return <InstagramLogo size={size} />;
  if (normalized === "VK") return <VkLogo size={size} />;
  if (normalized === "YOUTUBE") return <YouTubeLogo size={size} />;

  return (
    <span className="platform-logo fallback" style={{ width: size, height: size }}>
      {normalized.slice(0, 2)}
    </span>
  );
}

function InstagramLogo({ size }: { size: number }) {
  const gradientId = `instagram-gradient-${size}`;
  return (
    <svg className="brand-logo-svg" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <defs>
        <linearGradient id={gradientId} x1="4" y1="22" x2="21" y2="3" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#feda75" />
          <stop offset="0.25" stopColor="#fa7e1e" />
          <stop offset="0.52" stopColor="#d62976" />
          <stop offset="0.78" stopColor="#962fbf" />
          <stop offset="1" stopColor="#4f5bd5" />
        </linearGradient>
      </defs>
      <rect x="1.5" y="1.5" width="21" height="21" rx="6" fill={`url(#${gradientId})`} />
      <rect x="6.2" y="6.2" width="11.6" height="11.6" rx="3.6" fill="none" stroke="#fff" strokeWidth="1.7" />
      <circle cx="12" cy="12" r="3" fill="none" stroke="#fff" strokeWidth="1.7" />
      <circle cx="16.35" cy="7.65" r="1.05" fill="#fff" />
    </svg>
  );
}

function VkLogo({ size }: { size: number }) {
  return (
    <svg className="brand-logo-svg" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect x="1.5" y="1.5" width="21" height="21" rx="5" fill="#0077ff" />
      <path
        fill="#fff"
        d="M12.68 16.75c-4.86 0-7.63-3.34-7.75-8.9h2.44c.08 4.08 1.88 5.8 3.31 6.15V7.85h2.3v3.51c1.39-.15 2.85-1.75 3.34-3.51h2.3c-.37 2.17-1.94 3.77-3.05 4.43 1.11.54 2.89 1.93 3.57 4.47h-2.53c-.54-1.69-1.87-3-3.63-3.18v3.18h-.3Z"
      />
    </svg>
  );
}

function YouTubeLogo({ size }: { size: number }) {
  return (
    <svg className="brand-logo-svg" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect x="1.8" y="5" width="20.4" height="14" rx="4" fill="#ff0000" />
      <path d="M10.2 8.7v6.6l5.8-3.3-5.8-3.3Z" fill="#fff" />
    </svg>
  );
}
