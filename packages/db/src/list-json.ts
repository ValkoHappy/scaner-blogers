import type { Prisma } from "./generated/prisma/client";
import { SocialPlatform } from "./generated/prisma/enums";

export function stringList(value: unknown, fallback: string[] = []) {
  if (!Array.isArray(value)) return fallback;
  return value.filter((item): item is string => typeof item === "string");
}

export function numberList(value: unknown, fallback: number[] = []) {
  if (!Array.isArray(value)) return fallback;
  return value.filter((item): item is number => typeof item === "number" && Number.isFinite(item));
}

export function socialPlatformList(value: unknown, fallback: SocialPlatform[] = []) {
  const allowed = new Set(Object.values(SocialPlatform));
  return stringList(value)
    .filter((item): item is SocialPlatform => allowed.has(item as SocialPlatform))
    .length
    ? stringList(value).filter((item): item is SocialPlatform => allowed.has(item as SocialPlatform))
    : fallback;
}

export function jsonStringList(value: string[] | undefined, fallback?: string[]) {
  return (value ?? fallback) as Prisma.InputJsonValue | undefined;
}

export function jsonNumberList(value: number[] | undefined, fallback?: number[]) {
  return (value ?? fallback) as Prisma.InputJsonValue | undefined;
}

export function jsonSocialPlatformList(value: SocialPlatform[] | undefined, fallback?: SocialPlatform[]) {
  return (value ?? fallback) as Prisma.InputJsonValue | undefined;
}
