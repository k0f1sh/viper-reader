/** null は未生成（または不正な応答）、空配列は判定済みでタグなし。 */
export function normalizeArticleTags(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.some((tag) => typeof tag !== "string")) return null;
  const tags: string[] = [];
  const seen = new Set<string>();
  for (const valueTag of value as string[]) {
    let tag = valueTag.trim().replace(/\s+/g, " ");
    if (/^(ai|人工知能|artificial intelligence)$/i.test(tag)) tag = "AI";
    if (/^(llms?|大規模言語モデル|large language models?)$/i.test(tag)) tag = "LLM";
    if (!tag || seen.has(tag.toLowerCase())) continue;
    seen.add(tag.toLowerCase());
    tags.push(tag);
  }
  if (tags.includes("LLM") && !tags.includes("AI")) tags.unshift("AI");
  return [...tags.filter((tag) => tag === "AI"), ...tags.filter((tag) => tag === "LLM"),
    ...tags.filter((tag) => tag !== "AI" && tag !== "LLM")].slice(0, 5);
}

export function parseArticleTags(json: string | null): string[] | null {
  if (json === null) return null;
  try {
    return normalizeArticleTags(JSON.parse(json));
  } catch {
    return null;
  }
}

export function formatArticleTags(tags: string[] | null): string {
  return tags === null ? "未生成" : tags.length === 0 ? "なし" : tags.join(" / ");
}

export function hasAiArticleTag(tags: string[] | null): boolean {
  return tags?.some((tag) => tag === "AI" || tag === "LLM") ?? false;
}
