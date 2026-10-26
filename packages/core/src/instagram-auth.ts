export type InstagramAuthSource =
  | "helper_session"
  | "session_file"
  | "sessionid"
  | "password"
  | "mixed"
  | "missing";

export interface InstagramAuthMetadataShape {
  username?: unknown;
  password?: unknown;
  sessionId?: unknown;
  sessionSettings?: unknown;
  sessionFile?: unknown;
}

export interface NormalizedInstagramAuthMetadata {
  username?: string;
  password?: string;
  sessionId?: string;
  sessionSettings?: string;
  sessionFile?: string;
}

export interface ResolvedInstagramAuth {
  authSource: InstagramAuthSource;
  metadata: NormalizedInstagramAuthMetadata;
  hasPassword: boolean;
  hasSessionId: boolean;
  hasSessionSettings: boolean;
  hasSessionFile: boolean;
}

export function normalizeInstagramAuthMetadata(value: InstagramAuthMetadataShape | Record<string, unknown> | null | undefined): NormalizedInstagramAuthMetadata {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return compactRecord({
    username: stringValue(record.username),
    password: stringValue(record.password),
    sessionId: stringValue(record.sessionId),
    sessionSettings: stringValue(record.sessionSettings),
    sessionFile: stringValue(record.sessionFile)
  });
}

export function resolveInstagramAuthSource(value: InstagramAuthMetadataShape | Record<string, unknown> | null | undefined): ResolvedInstagramAuth {
  const metadata = normalizeInstagramAuthMetadata(value);
  const hasPassword = Boolean(metadata.password);
  const hasSessionId = Boolean(metadata.sessionId);
  const hasSessionSettings = Boolean(metadata.sessionSettings);
  const hasSessionFile = Boolean(metadata.sessionFile);

  let authSource: InstagramAuthSource = "missing";
  if (hasSessionSettings && !hasSessionId && !hasPassword) {
    authSource = "helper_session";
  } else if (hasSessionSettings || ((hasSessionId ? 1 : 0) + (hasPassword ? 1 : 0) > 1)) {
    authSource = "mixed";
  } else if (hasSessionId) {
    authSource = "sessionid";
  } else if (hasPassword) {
    authSource = "password";
  } else if (hasSessionFile) {
    authSource = "session_file";
  }

  return {
    authSource,
    metadata,
    hasPassword,
    hasSessionId,
    hasSessionSettings,
    hasSessionFile
  };
}

export function normalizeInstagramStoredCredentials(input: {
  username: string;
  sessionFile?: string;
  password?: string;
  sessionId?: string;
  sessionSettings?: string;
}) {
  const metadata = normalizeInstagramAuthMetadata(input);
  const resolved = resolveInstagramAuthSource(metadata);
  switch (resolved.authSource) {
    case "helper_session":
      return {
        authSource: resolved.authSource,
        metadata: compactRecord({
          username: metadata.username,
          sessionSettings: metadata.sessionSettings,
          sessionFile: metadata.sessionFile
        })
      };
    case "sessionid":
      return {
        authSource: resolved.authSource,
        metadata: compactRecord({
          username: metadata.username,
          sessionId: metadata.sessionId,
          sessionFile: metadata.sessionFile
        })
      };
    case "password":
      return {
        authSource: resolved.authSource,
        metadata: compactRecord({
          username: metadata.username,
          password: metadata.password,
          sessionFile: metadata.sessionFile
        })
      };
    case "session_file":
      return {
        authSource: resolved.authSource,
        metadata: compactRecord({
          username: metadata.username,
          sessionFile: metadata.sessionFile
        })
      };
    default:
      return {
        authSource: resolved.authSource,
        metadata
      };
  }
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function compactRecord<T extends Record<string, unknown>>(record: T) {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined)) as Partial<T>;
}

export function isInstagramPreparedAuthSource(source: InstagramAuthSource) {
  return source === "helper_session" || source === "session_file" || source === "sessionid";
}
