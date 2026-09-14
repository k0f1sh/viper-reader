import { useCallback, useEffect, useState } from "react";

const zoomSettingKey = "ui_zoom_percent_v1";
const zoomLevels = [75, 85, 100, 110, 125, 150] as const;
const defaultZoomPercent = 100;

function normalizeZoomPercent(value: string | null): number {
  const parsed = Number(value);
  return zoomLevels.includes(parsed as (typeof zoomLevels)[number]) ? parsed : defaultZoomPercent;
}

export function useUiZoom() {
  const [zoomPercent, setZoomPercent] = useState(defaultZoomPercent);

  const applyZoom = useCallback((percent: number, persist: boolean) => {
    if (!window.viperReader) return;
    setZoomPercent(percent);
    void window.viperReader.setUiZoomFactor(percent / 100);
    if (persist) {
      void window.viperReader.saveUserSetting(zoomSettingKey, String(percent));
    }
  }, []);

  useEffect(() => {
    if (!window.viperReader) return;
    void window.viperReader.getUserSetting(zoomSettingKey).then((value) => {
      applyZoom(normalizeZoomPercent(value), false);
    });
  }, [applyZoom]);

  const zoomIn = useCallback(() => {
    const next = zoomLevels.find((level) => level > zoomPercent) ?? zoomLevels.at(-1)!;
    applyZoom(next, true);
  }, [applyZoom, zoomPercent]);

  const zoomOut = useCallback(() => {
    const next = [...zoomLevels].reverse().find((level) => level < zoomPercent) ?? zoomLevels[0];
    applyZoom(next, true);
  }, [applyZoom, zoomPercent]);

  const resetZoom = useCallback(() => applyZoom(defaultZoomPercent, true), [applyZoom]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        zoomIn();
      } else if (event.key === "-") {
        event.preventDefault();
        zoomOut();
      } else if (event.key === "0") {
        event.preventDefault();
        resetZoom();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [resetZoom, zoomIn, zoomOut]);

  return { zoomPercent, zoomIn, zoomOut, resetZoom };
}
