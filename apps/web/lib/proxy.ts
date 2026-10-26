export function normalizeProxyUrl(value: string) {
  const text = value.trim();
  if (!text) return "";
  if (/^socks5:\/\//i.test(text)) return "socks5h://" + text.slice("socks5://".length);
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) return text;

  const parts = text.split(":");
  if (parts.length >= 4) {
    const [host, port, username, ...passwordParts] = parts;
    return `socks5h://${encodeURIComponent(username)}:${encodeURIComponent(passwordParts.join(":"))}@${host}:${port}`;
  }

  return `http://${text}`;
}

export function normalizeProxyList(values: string[]) {
  return [...new Set(values.map(normalizeProxyUrl).filter(Boolean))];
}
