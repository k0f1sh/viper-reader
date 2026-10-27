export type Theme = "classic" | "modern" | "dark";

export function parseTheme(value: string | null): Theme {
  return value === "modern" || value === "dark" ? value : "classic";
}
