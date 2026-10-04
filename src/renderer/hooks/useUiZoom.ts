import { useCallback, useEffect, useRef, useState } from "react";

const zoomSettingKey = "ui_zoom_percent_v1";
const zoomLevels = [75, 85, 100, 110, 125, 150] as const;
const defaultZoomPercent = 100;

function normalizeZoomPercent(value: string | null): number {
  const parsed = Number(value);
  return zoomLevels.includes(parsed as (typeof zoomLevels)[number]) ? parsed : defaultZoomPercent;
}

export function useUiZoom() {
  const [zoomPercent, setZoomPercent] = useState(defaultZoomPercent);
  const zoomPercentRef = useRef(defaultZoomPercent);

  const applyZoom = useCallback(async (percent: number, persist: boolean) => {
    if (!window.viperReader) return;
    zoomPercentRef.current = percent;
    const appliedFactor = await window.viperReader.setUiZoomFactor(percent / 100);
    const appliedPercent = Math.round(appliedFactor * 100);
    zoomPercentRef.current = appliedPercent;
    setZoomPercent(appliedPercent);
    if (persist) {
      await window.viperReader.saveUserSetting(zoomSettingKey, String(appliedPercent));
    }
  }, []);

  useEffect(() => {
    if (!window.viperReader) return;
    void window.viperReader.getUserSetting(zoomSettingKey).then((value) => {
      void applyZoom(normalizeZoomPercent(value), false);
    });
  }, [applyZoom]);

  const zoomIn = useCallback(() => {
    const next = zoomLevels.find((level) => level > zoomPercentRef.current) ?? zoomLevels.at(-1)!;
    void applyZoom(next, true);
  }, [applyZoom]);

  const zoomOut = useCallback(() => {
    const next = [...zoomLevels].reverse().find((level) => level < zoomPercentRef.current) ?? zoomLevels[0];
    void applyZoom(next, true);
  }, [applyZoom]);

  const resetZoom = useCallback(() => void applyZoom(defaultZoomPercent, true), [applyZoom]);

  useEffect(() => {
    if (!window.viperReader) return;
    return window.viperReader.onUiZoomChanged((direction) => {
      if (direction === "in") zoomIn();
      else zoomOut();
    });
  }, [zoomIn, zoomOut]);

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
