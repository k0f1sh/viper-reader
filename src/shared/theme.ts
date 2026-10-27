export type Theme = "classic" | "modern";

export function parseTheme(value: string | null): Theme {
  return value === "modern" ? "modern" : "classic";
}
