import type { SocialCandidateRow } from "./social";

export interface SocialCandidateScoreOptions {
  minFollowers?: number;
  maxFollowers?: number;
}

export interface SocialCandidateScore {
  score: number;
  signals: string[];
}

export function scoreSocialCandidate(
  row: SocialCandidateRow,
  options: SocialCandidateScoreOptions = {}
): SocialCandidateScore {
  const signals: string[] = [];
  let score = 0;

  if (followersInRange(row.followers, options)) {
    score += 25;
    signals.push("followers_in_range");
  } else {
    const nearRange = followersNearRange(row.followers, options);
    score += nearRange ? 10 : 0;
    signals.push(nearRange ? "followers_near_range" : "followers_out_of_range");
  }

  if (hasContacts(row)) {
    score += 20;
    signals.push("has_contacts");
  } else {
    signals.push("missing_contacts");
  }

  if (row.metrics.postsChecked > 0 || row.lastPosts.length > 0) {
    score += 15;
    signals.push("has_recent_posts");
  } else {
    signals.push("missing_recent_posts");
  }

  if (hasActivity(row)) {
    score += 15;
    signals.push("has_activity");
  } else {
    signals.push("missing_activity");
  }

  if (bioMatchesKeyword(row)) {
    score += 15;
    signals.push("bio_keyword_match");
  }

  if (row.sourceTag?.trim()) {
    score += 5;
    signals.push("has_source_tag");
  }

  if (row.geoGuess?.trim()) {
    score += 5;
    signals.push("has_geo_guess");
  }

  return {
    score: Math.max(0, Math.min(100, Math.round(score))),
    signals
  };
}

function followersInRange(followers: number, options: SocialCandidateScoreOptions) {
  const min = options.minFollowers ?? 0;
  const max = options.maxFollowers ?? Number.POSITIVE_INFINITY;
  return followers >= min && followers <= max;
}

function followersNearRange(followers: number, options: SocialCandidateScoreOptions) {
  const min = options.minFollowers ?? 0;
  const max = options.maxFollowers ?? Number.POSITIVE_INFINITY;
  return followers >= min * 0.75 && followers <= max * 1.5;
}

function hasContacts(row: SocialCandidateRow) {
  return Boolean(
    row.externalUrl?.trim()
    || row.contacts.emails.length
    || row.contacts.phones.length
    || row.contacts.urls.length
  );
}

function hasActivity(row: SocialCandidateRow) {
  return row.metrics.avgViews > 0
    || row.metrics.avgLikes > 0
    || row.metrics.avgComments > 0
    || row.lastPosts.some((post) => (post.viewCount ?? 0) > 0 || (post.likeCount ?? 0) > 0 || (post.commentCount ?? 0) > 0);
}

function bioMatchesKeyword(row: SocialCandidateRow) {
  const bio = row.bio?.toLocaleLowerCase("ru-RU") ?? "";
  const keywordParts = row.sourceKeyword
    .toLocaleLowerCase("ru-RU")
    .split(/[\s,;#/_-]+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 4);

  return Boolean(bio && keywordParts.some((part) => bio.includes(part)));
}
