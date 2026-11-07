export type BrowserDomains = { enabled: boolean; domains: string[] };
export function normalizeDomain(value: string): string {
  const domain = value.trim().toLowerCase().replace(/\.$/, "");
  if (!domain || /[^a-z0-9.-]/.test(domain) || !domain.includes(".") || domain.split(".").some(label => !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))) throw new Error("有効なドメイン名を入力してください。");
  return domain;
}
export function parseBrowserDomains(value: string): BrowserDomains {
  const parsed = JSON.parse(value);
  if (typeof parsed.enabled !== "boolean" || !Array.isArray(parsed.domains) || parsed.domains.some((d: unknown) => typeof d !== "string")) throw new Error("サイト設定が不正です。");
  return { enabled: parsed.enabled, domains: [...new Set<string>(parsed.domains.map(normalizeDomain))] };
}
export function articleHost(url: string): string {
  try { const u = new URL(url); return /^https?:$/.test(u.protocol) ? u.hostname.toLowerCase() : ""; } catch { return ""; }
}
export function matchesDomain(url: string, domains: string[]): boolean {
  const host = articleHost(url);
  return domains.some(d => host === d || host.endsWith("." + d));
}
