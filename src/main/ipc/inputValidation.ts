import type {
  ArticleBrowserBounds,
  ShowArticleBrowserRequest
} from "../../shared/types.js";

const maxIdentifierLength = 512;

export function assertIdentifier(value: unknown, fieldName: string): asserts value is string {
  assertString(value, fieldName, { minLength: 1, maxLength: maxIdentifierLength });
}

export function assertString(
  value: unknown,
  fieldName: string,
  options: { minLength?: number; maxLength: number }
): asserts value is string {
  if (
    typeof value !== "string"
    || value.length < (options.minLength ?? 0)
    || value.length > options.maxLength
  ) {
    throw new Error(`Invalid ${fieldName}.`);
  }
}

export function assertBoolean(value: unknown, fieldName: string): asserts value is boolean {
  if (typeof value !== "boolean") {
    throw new Error(`Invalid ${fieldName}.`);
  }
}

export function assertPage(value: unknown): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > 1_000_000) {
    throw new Error("Invalid page.");
  }
}

export function assertHttpUrl(value: unknown, fieldName: string): asserts value is string {
  assertString(value, fieldName, { minLength: 1, maxLength: 2_048 });
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`Invalid ${fieldName}.`);
  }
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:")
    || parsed.username
    || parsed.password
  ) {
    throw new Error(`Invalid ${fieldName}.`);
  }
}

export function assertStringArray(
  value: unknown,
  fieldName: string,
  options: { maxItems: number; maxItemLength: number }
): asserts value is string[] {
  if (
    !Array.isArray(value)
    || value.length > options.maxItems
    || value.some((item) => typeof item !== "string" || item.length > options.maxItemLength)
  ) {
    throw new Error(`Invalid ${fieldName}.`);
  }
}

export function assertArticleBrowserBounds(
  value: unknown
): asserts value is ArticleBrowserBounds {
  if (
    !value
    || typeof value !== "object"
    || !Number.isFinite((value as ArticleBrowserBounds).x)
    || !Number.isFinite((value as ArticleBrowserBounds).y)
    || !Number.isFinite((value as ArticleBrowserBounds).width)
    || !Number.isFinite((value as ArticleBrowserBounds).height)
    || (value as ArticleBrowserBounds).width <= 0
    || (value as ArticleBrowserBounds).height <= 0
  ) {
    throw new Error("Invalid article browser bounds.");
  }
}

export function assertShowArticleBrowserRequest(
  value: unknown
): asserts value is ShowArticleBrowserRequest {
  if (!value || typeof value !== "object") {
    throw new Error("Invalid article browser request.");
  }
  const request = value as Partial<ShowArticleBrowserRequest>;
  assertIdentifier(request.threadId, "thread ID");
  assertHttpUrl(request.url, "article URL");
  assertArticleBrowserBounds(request.bounds);
  assertBoolean(request.allowUnprotected, "unprotected browsing flag");
}
