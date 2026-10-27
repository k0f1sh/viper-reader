import { useEffect, useState } from "react";
import { parseTheme, type Theme } from "../../shared/theme";

export function useTheme() {
  const [theme, setTheme] = useState<Theme>("classic");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const saved = await window.viperReader?.getUserSetting("theme");
        if (!cancelled) setTheme(parseTheme(saved ?? null));
      } catch {
        if (!cancelled) setError("テーマ設定を読み込めませんでした。再度選択すると保存できます。");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  async function changeTheme(next: Theme) {
    if (isLoading || isSaving) return;
    const previous = theme;
    setTheme(next);
    setError("");
    if (!window.viperReader) return;
    setIsSaving(true);
    try {
      await window.viperReader.saveUserSetting("theme", next);
    } catch {
      setTheme(previous);
      setError("テーマ設定の保存に失敗しました。もう一度お試しください。");
    } finally {
      setIsSaving(false);
    }
  }

  return { theme, changeTheme, isBusy: isLoading || isSaving, error };
}
