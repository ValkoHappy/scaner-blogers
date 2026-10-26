-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Advertiser" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "googleAdvertiserId" TEXT NOT NULL,
    "name" TEXT,
    "transparencyUrl" TEXT,
    "selectedCountries" JSONB NOT NULL DEFAULT [],
    "lastScanAt" DATETIME,
    "lastSuccessfulScanAt" DATETIME,
    "lastScanStatus" TEXT,
    "totalCreatives" INTEGER NOT NULL DEFAULT 0,
    "activeCreatives" INTEGER NOT NULL DEFAULT 0,
    "dailyScanEnabled" BOOLEAN NOT NULL DEFAULT true,
    "scanMode" TEXT,
    "requestDelayMs" INTEGER,
    "maxPagesPerRun" INTEGER,
    "maxCreativesPerRun" INTEGER,
    "scanStartDate" TEXT,
    "scanEndDate" TEXT,
    "nextScanAt" DATETIME,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "App" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "appId" TEXT NOT NULL,
    "store" TEXT NOT NULL,
    "storeUrl" TEXT,
    "name" TEXT,
    "developer" TEXT,
    "category" TEXT,
    "description" TEXT,
    "shortDescription" TEXT,
    "firstSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Creative" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "creativeId" TEXT NOT NULL,
    "advertiserId" TEXT NOT NULL,
    "appDbId" TEXT,
    "format" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "status" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "previewUrl" TEXT,
    "firstShownAt" DATETIME,
    "lastShownAt" DATETIME,
    "publicDays" INTEGER,
    "impressionsMin" INTEGER,
    "impressionsMax" INTEGER,
    "firstFoundAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastFoundAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rawList" JSONB,
    "rawDetail" JSONB,
    "rawPreview" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Creative_advertiserId_fkey" FOREIGN KEY ("advertiserId") REFERENCES "Advertiser" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Creative_appDbId_fkey" FOREIGN KEY ("appDbId") REFERENCES "App" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CreativeAsset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "creativeId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CreativeAsset_creativeId_fkey" FOREIGN KEY ("creativeId") REFERENCES "Creative" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CreativeCountry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "creativeId" TEXT NOT NULL,
    "googleGeoId" INTEGER NOT NULL,
    "countryCode" TEXT,
    "countryName" TEXT,
    "impressionsMin" INTEGER,
    "impressionsMax" INTEGER,
    "firstShownDate" TEXT,
    "lastShownDate" TEXT,
    "raw" JSONB,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CreativeCountry_creativeId_fkey" FOREIGN KEY ("creativeId") REFERENCES "Creative" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ScanJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "advertiserId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "scanMode" TEXT NOT NULL DEFAULT 'FULL',
    "scheduledFor" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    "errorMessage" TEXT,
    "pagesFetched" INTEGER NOT NULL DEFAULT 0,
    "creativesFound" INTEGER NOT NULL DEFAULT 0,
    "detailsFetched" INTEGER NOT NULL DEFAULT 0,
    "previewsFetched" INTEGER NOT NULL DEFAULT 0,
    "blockedReason" TEXT,
    "requestDelayMs" INTEGER,
    "maxPagesPerRun" INTEGER,
    "maxCreativesPerRun" INTEGER,
    "scanStartDate" TEXT,
    "scanEndDate" TEXT,
    "nextPageToken" TEXT,
    "currentCountryCode" TEXT,
    "chunkStartedAt" DATETIME,
    "completedCountries" JSONB NOT NULL DEFAULT [],
    "retryOfJobId" TEXT,
    "cancelRequested" BOOLEAN NOT NULL DEFAULT false,
    "countries" JSONB NOT NULL DEFAULT [],
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ScanJob_advertiserId_fkey" FOREIGN KEY ("advertiserId") REFERENCES "Advertiser" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Scan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "advertiserId" TEXT NOT NULL,
    "scanJobId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "scanMode" TEXT NOT NULL DEFAULT 'FULL',
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    "pagesFetched" INTEGER NOT NULL DEFAULT 0,
    "creativesFound" INTEGER NOT NULL DEFAULT 0,
    "newCreatives" INTEGER NOT NULL DEFAULT 0,
    "detailsFetched" INTEGER NOT NULL DEFAULT 0,
    "previewsFetched" INTEGER NOT NULL DEFAULT 0,
    "blockedReason" TEXT,
    "errorMessage" TEXT,
    CONSTRAINT "Scan_advertiserId_fkey" FOREIGN KEY ("advertiserId") REFERENCES "Advertiser" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Scan_scanJobId_fkey" FOREIGN KEY ("scanJobId") REFERENCES "ScanJob" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ScanEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scanJobId" TEXT,
    "scanId" TEXT,
    "level" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "data" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ScanEvent_scanJobId_fkey" FOREIGN KEY ("scanJobId") REFERENCES "ScanJob" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ScanEvent_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "Scan" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RawApiSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "creativeId" TEXT,
    "kind" TEXT NOT NULL,
    "url" TEXT,
    "payload" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RawApiSnapshot_creativeId_fkey" FOREIGN KEY ("creativeId") REFERENCES "Creative" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SearchKeyword" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL,
    "normalizedValue" TEXT NOT NULL,
    "topic" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "platforms" JSONB NOT NULL DEFAULT ["INSTAGRAM"],
    "countries" JSONB NOT NULL DEFAULT ["RU","KZ"],
    "minFollowers" INTEGER NOT NULL DEFAULT 20000,
    "maxFollowers" INTEGER NOT NULL DEFAULT 60000,
    "instagramMinFollowers" INTEGER,
    "instagramMaxFollowers" INTEGER,
    "vkMinFollowers" INTEGER,
    "vkMaxFollowers" INTEGER,
    "youtubeMinFollowers" INTEGER,
    "youtubeMaxFollowers" INTEGER,
    "hashtags" JSONB NOT NULL DEFAULT [],
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Candidate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "displayName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "topics" JSONB NOT NULL DEFAULT [],
    "countries" JSONB NOT NULL DEFAULT [],
    "contacts" JSONB,
    "notes" TEXT,
    "reviewedAt" DATETIME,
    "priorityAt" DATETIME,
    "contactedAt" DATETIME,
    "rejectedAt" DATETIME,
    "savedAt" DATETIME,
    "exportedAt" DATETIME,
    "firstFoundAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastFoundAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "CandidateProfile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "candidateId" TEXT NOT NULL,
    "keywordId" TEXT,
    "collectionRunId" TEXT,
    "platform" TEXT NOT NULL,
    "platformProfileId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "displayName" TEXT,
    "profileUrl" TEXT NOT NULL,
    "followers" INTEGER NOT NULL,
    "bio" TEXT,
    "externalUrl" TEXT,
    "contacts" JSONB,
    "sourceKeyword" TEXT,
    "sourceTag" TEXT,
    "matchedBy" TEXT,
    "geoGuess" TEXT,
    "reason" TEXT,
    "qualityScore" INTEGER NOT NULL DEFAULT 0,
    "qualitySignals" JSONB,
    "metrics" JSONB,
    "lastPosts" JSONB,
    "raw" JSONB,
    "firstFoundAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastCollectedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CandidateProfile_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CandidateProfile_keywordId_fkey" FOREIGN KEY ("keywordId") REFERENCES "SearchKeyword" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "CandidateProfile_collectionRunId_fkey" FOREIGN KEY ("collectionRunId") REFERENCES "CollectionRun" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CollectionJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "keywordId" TEXT,
    "platform" TEXT NOT NULL,
    "configHash" TEXT,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "scheduledFor" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    "errorMessage" TEXT,
    "blockedReason" TEXT,
    "minFollowers" INTEGER NOT NULL DEFAULT 20000,
    "maxFollowers" INTEGER NOT NULL DEFAULT 60000,
    "countries" JSONB NOT NULL DEFAULT ["RU","KZ"],
    "hashtags" JSONB NOT NULL DEFAULT [],
    "requestDelayMs" INTEGER,
    "maxProfiles" INTEGER,
    "candidatesFound" INTEGER NOT NULL DEFAULT 0,
    "profilesChecked" INTEGER NOT NULL DEFAULT 0,
    "config" JSONB,
    "retryOfJobId" TEXT,
    "cancelRequested" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CollectionJob_keywordId_fkey" FOREIGN KEY ("keywordId") REFERENCES "SearchKeyword" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CollectionRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "collectionJobId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    "candidatesFound" INTEGER NOT NULL DEFAULT 0,
    "profilesChecked" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "blockedReason" TEXT,
    CONSTRAINT "CollectionRun_collectionJobId_fkey" FOREIGN KEY ("collectionJobId") REFERENCES "CollectionJob" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CollectionSearchHistory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "keywordId" TEXT,
    "collectionJobId" TEXT,
    "collectionRunId" TEXT,
    "platform" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "queryType" TEXT NOT NULL,
    "regionCode" TEXT NOT NULL,
    "searches" INTEGER NOT NULL DEFAULT 0,
    "lastItemsFound" INTEGER,
    "lastProfilesChecked" INTEGER,
    "lastError" TEXT,
    "lastSearchedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "firstSearchedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CollectionSearchHistory_keywordId_fkey" FOREIGN KEY ("keywordId") REFERENCES "SearchKeyword" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "CollectionSearchHistory_collectionJobId_fkey" FOREIGN KEY ("collectionJobId") REFERENCES "CollectionJob" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "CollectionSearchHistory_collectionRunId_fkey" FOREIGN KEY ("collectionRunId") REFERENCES "CollectionRun" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CollectionEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "collectionJobId" TEXT,
    "collectionRunId" TEXT,
    "level" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "data" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CollectionEvent_collectionJobId_fkey" FOREIGN KEY ("collectionJobId") REFERENCES "CollectionJob" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CollectionEvent_collectionRunId_fkey" FOREIGN KEY ("collectionRunId") REFERENCES "CollectionRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RawSocialSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "candidateProfileId" TEXT,
    "collectionRunId" TEXT,
    "platform" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "url" TEXT,
    "payload" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RawSocialSnapshot_candidateProfileId_fkey" FOREIGN KEY ("candidateProfileId") REFERENCES "CandidateProfile" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RawSocialSnapshot_collectionRunId_fkey" FOREIGN KEY ("collectionRunId") REFERENCES "CollectionRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SocialPlatformAccount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "platform" TEXT NOT NULL,
    "accountKey" TEXT NOT NULL,
    "label" TEXT,
    "username" TEXT,
    "status" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "blockedUntil" DATETIME,
    "lastLoginAt" DATETIME,
    "lastSuccessAt" DATETIME,
    "lastErrorAt" DATETIME,
    "lastError" TEXT,
    "consecutiveErrors" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "SystemSettings" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'default',
    "defaultCountries" JSONB NOT NULL DEFAULT [],
    "scanMode" TEXT NOT NULL DEFAULT 'FULL',
    "dailyScanHour" INTEGER NOT NULL DEFAULT 3,
    "scheduleType" TEXT NOT NULL DEFAULT 'DAILY',
    "dailyScanHours" JSONB NOT NULL DEFAULT [3],
    "scanIntervalHours" INTEGER,
    "requestDelayMs" INTEGER NOT NULL DEFAULT 1000,
    "maxPagesPerRun" INTEGER,
    "maxCreativesPerRun" INTEGER,
    "workerConcurrency" INTEGER NOT NULL DEFAULT 1,
    "advertiserDelayMs" INTEGER NOT NULL DEFAULT 60000,
    "probeIntervalMs" INTEGER NOT NULL DEFAULT 3600000,
    "rawSnapshotRetentionDays" INTEGER NOT NULL DEFAULT 30,
    "scanEventRetentionDays" INTEGER NOT NULL DEFAULT 60,
    "exportDefaultFields" JSONB NOT NULL DEFAULT ["creativeId","advertiserName","appName","store","format","status","countries","publicDays","firstShownAt","lastShownAt","impressions"],
    "proxyEnabled" BOOLEAN NOT NULL DEFAULT false,
    "proxyUrl" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "WorkerHeartbeat" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'default',
    "status" TEXT NOT NULL,
    "pid" INTEGER,
    "message" TEXT,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "GoogleHealth" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'default',
    "status" TEXT NOT NULL DEFAULT 'OK',
    "blockedUntil" DATETIME,
    "lastProbeAt" DATETIME,
    "lastSuccessAt" DATETIME,
    "consecutiveBlocks" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ProxyEndpoint" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "url" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OK',
    "lastUsedAt" DATETIME,
    "blockedUntil" DATETIME,
    "failCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Advertiser_googleAdvertiserId_key" ON "Advertiser"("googleAdvertiserId");

-- CreateIndex
CREATE UNIQUE INDEX "App_store_appId_key" ON "App"("store", "appId");

-- CreateIndex
CREATE UNIQUE INDEX "Creative_creativeId_key" ON "Creative"("creativeId");

-- CreateIndex
CREATE UNIQUE INDEX "CreativeAsset_creativeId_kind_url_key" ON "CreativeAsset"("creativeId", "kind", "url");

-- CreateIndex
CREATE INDEX "CreativeCountry_countryCode_idx" ON "CreativeCountry"("countryCode");

-- CreateIndex
CREATE UNIQUE INDEX "CreativeCountry_creativeId_googleGeoId_key" ON "CreativeCountry"("creativeId", "googleGeoId");

-- CreateIndex
CREATE INDEX "RawApiSnapshot_kind_idx" ON "RawApiSnapshot"("kind");

-- CreateIndex
CREATE UNIQUE INDEX "SearchKeyword_normalizedValue_key" ON "SearchKeyword"("normalizedValue");

-- CreateIndex
CREATE INDEX "SearchKeyword_enabled_idx" ON "SearchKeyword"("enabled");

-- CreateIndex
CREATE INDEX "Candidate_status_idx" ON "Candidate"("status");

-- CreateIndex
CREATE INDEX "Candidate_lastFoundAt_idx" ON "Candidate"("lastFoundAt");

-- CreateIndex
CREATE INDEX "CandidateProfile_platform_username_idx" ON "CandidateProfile"("platform", "username");

-- CreateIndex
CREATE INDEX "CandidateProfile_followers_idx" ON "CandidateProfile"("followers");

-- CreateIndex
CREATE INDEX "CandidateProfile_qualityScore_idx" ON "CandidateProfile"("qualityScore");

-- CreateIndex
CREATE INDEX "CandidateProfile_lastCollectedAt_idx" ON "CandidateProfile"("lastCollectedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CandidateProfile_platform_platformProfileId_key" ON "CandidateProfile"("platform", "platformProfileId");

-- CreateIndex
CREATE INDEX "CollectionJob_status_scheduledFor_idx" ON "CollectionJob"("status", "scheduledFor");

-- CreateIndex
CREATE INDEX "CollectionJob_platform_idx" ON "CollectionJob"("platform");

-- CreateIndex
CREATE INDEX "CollectionJob_platform_status_configHash_idx" ON "CollectionJob"("platform", "status", "configHash");

-- CreateIndex
CREATE INDEX "CollectionRun_platform_startedAt_idx" ON "CollectionRun"("platform", "startedAt");

-- CreateIndex
CREATE INDEX "CollectionRun_status_idx" ON "CollectionRun"("status");

-- CreateIndex
CREATE INDEX "CollectionSearchHistory_platform_lastSearchedAt_idx" ON "CollectionSearchHistory"("platform", "lastSearchedAt");

-- CreateIndex
CREATE INDEX "CollectionSearchHistory_keywordId_idx" ON "CollectionSearchHistory"("keywordId");

-- CreateIndex
CREATE UNIQUE INDEX "CollectionSearchHistory_platform_query_queryType_regionCode_key" ON "CollectionSearchHistory"("platform", "query", "queryType", "regionCode");

-- CreateIndex
CREATE INDEX "CollectionEvent_collectionJobId_idx" ON "CollectionEvent"("collectionJobId");

-- CreateIndex
CREATE INDEX "CollectionEvent_collectionRunId_idx" ON "CollectionEvent"("collectionRunId");

-- CreateIndex
CREATE INDEX "CollectionEvent_createdAt_idx" ON "CollectionEvent"("createdAt");

-- CreateIndex
CREATE INDEX "RawSocialSnapshot_platform_kind_idx" ON "RawSocialSnapshot"("platform", "kind");

-- CreateIndex
CREATE INDEX "RawSocialSnapshot_createdAt_idx" ON "RawSocialSnapshot"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SocialPlatformAccount_accountKey_key" ON "SocialPlatformAccount"("accountKey");

-- CreateIndex
CREATE INDEX "SocialPlatformAccount_platform_status_idx" ON "SocialPlatformAccount"("platform", "status");

-- CreateIndex
CREATE INDEX "SocialPlatformAccount_blockedUntil_idx" ON "SocialPlatformAccount"("blockedUntil");

-- CreateIndex
CREATE UNIQUE INDEX "ProxyEndpoint_url_key" ON "ProxyEndpoint"("url");
