import { normalizeProxyUrl } from "./proxy";

export interface InstagramAccountInput {
  username: string;
  password?: string;
  label: string;
  sessionFile: string;
  proxyUrl?: string;
  sessionId?: string;
  sessionSettings?: string;
  verificationCode?: string;
}

export function parseInstagramAccountLine(line: string): InstagramAccountInput | null {
  const value = line.trim();
  if (!value) return null;

  const parts = value.includes("|")
    ? value.split("|").map((part) => part.trim())
    : value.split(/[,;\t]/).map((part) => part.trim());

  const [first, second, third, fourth, fifth] = parts;
  const credentials = value.includes("|") ? splitCredentials(first) : splitInlineCredentials(first, second);
  if (!credentials) return null;

  const proxy = value.includes("|") ? second : third;
  const sessionFile = value.includes("|") ? third : fourth;
  const label = value.includes("|") ? fourth : fifth;
  const proxyUrl = normalizeProxyUrl(proxy ?? "") || undefined;

  return {
    username: credentials.username,
    password: credentials.password,
    label: label?.trim() || credentials.username,
    sessionFile: sessionFile?.trim() || `.instagram/${credentials.username}.session.json`,
    proxyUrl
  };
}

function splitInlineCredentials(username: string | undefined, password: string | undefined) {
  if (username && password) {
    return normalizeCredentials(username, password);
  }
  return splitCredentials(username);
}

function splitCredentials(value: string | undefined) {
  const credentials = value?.trim();
  if (!credentials) return null;
  const separator = credentials.indexOf(":");
  if (separator <= 0) return null;
  return normalizeCredentials(credentials.slice(0, separator), credentials.slice(separator + 1));
}

function normalizeCredentials(username: string | undefined, password: string | undefined) {
  const safeUsername = username?.trim();
  const safePassword = password?.trim();
  if (!safeUsername || !safePassword) return null;
  return {
    username: safeUsername,
    password: safePassword
  };
}
