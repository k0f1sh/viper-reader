export type Theme = "classic" | "modern" | "dark" | "blue";

export function parseTheme(value: string | null): Theme {
  return value === "modern" || value === "dark" || value === "blue" ? value : "classic";
}
