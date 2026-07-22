const trackingParameterPrefixes = ["utm_"];
const trackingParameterNames = new Set(["fbclid", "gclid", "mc_cid", "mc_eid"]);

export function canonicalizeArticleUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = "";
    url.hostname = url.hostname.toLowerCase();
    for (const key of [...url.searchParams.keys()]) {
      const normalizedKey = key.toLowerCase();
      if (trackingParameterNames.has(normalizedKey) || trackingParameterPrefixes.some((prefix) => normalizedKey.startsWith(prefix))) {
        url.searchParams.delete(key);
      }
    }
    url.searchParams.sort();
    if (url.pathname.length > 1) {
      url.pathname = url.pathname.replace(/\/+$/, "");
    }
    return url.toString();
  } catch {
    return value.trim();
  }
}
