export function normalizePostBody(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/\r\n?/g, "\n");
}
