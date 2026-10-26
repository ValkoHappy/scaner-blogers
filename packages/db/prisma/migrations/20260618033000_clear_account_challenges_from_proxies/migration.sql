UPDATE "ProxyEndpoint"
SET
  "status" = 'OK',
  "blockedUntil" = NULL,
  "failCount" = 0,
  "lastError" = NULL
WHERE
  LOWER(COALESCE("lastError", '')) LIKE '%challenge_required%'
  OR LOWER(COALESCE("lastError", '')) LIKE '%checkpoint%'
  OR LOWER(COALESCE("lastError", '')) LIKE '%login_required%';
