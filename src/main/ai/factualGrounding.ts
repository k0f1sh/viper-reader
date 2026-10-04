const factualNumberPattern =
  /(?:v(?:ersion)?\s*)?\d+(?:\.\d+)+(?:[a-z0-9.-]*)?|\d+(?:\.\d+)?(?:%|gb|mb|kb|tb|ms|秒|分|時間|日|週|か月|ヶ月|月|年|件|個|回|倍|人|社|円|ドル)/giu;

export function findUngroundedNumericClaims(
  generatedText: string,
  sourceTexts: Array<string | null | undefined>
): string[] {
  const generated = normalizeForGrounding(generatedText.replace(/>>\d+/g, ""));
  const source = normalizeForGrounding(sourceTexts.filter(Boolean).join("\n"));
  const claims = generated.match(factualNumberPattern) ?? [];

  return [...new Set(claims.filter((claim) => !source.includes(claim)))];
}

function normalizeForGrounding(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/％/g, "%");
}
