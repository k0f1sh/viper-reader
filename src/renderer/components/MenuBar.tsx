type MenuBarProps = {
  onOpenSettings: () => void;
  onOpenBrowserSettings: () => void;
  onOpenModelSettings: () => void;
  onOpenStatistics: () => void;
  onOpenResidentPrompts: () => void;
  zoomPercent: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetZoom: () => void;
};

export function MenuBar({
  onOpenSettings,
  onOpenBrowserSettings,
  onOpenModelSettings,
  onOpenStatistics,
  onOpenResidentPrompts,
  zoomPercent,
  onZoomIn,
  onZoomOut,
  onResetZoom
}: MenuBarProps) {
  return (
    <nav className="menu-bar" aria-label="メニュー">
      <button className="menu-item" onClick={onOpenSettings} type="button">
        設定
      </button>
      <button className="menu-item" onClick={onOpenBrowserSettings} type="button">
        ブラウザ設定
      </button>
      <button className="menu-item" onClick={onOpenModelSettings} type="button">
        モデル設定
      </button>
      <button className="menu-item" onClick={onOpenStatistics} type="button">
        統計情報
      </button>
      <button className="menu-item" onClick={onOpenResidentPrompts} type="button">
        住民設定
      </button>
      <div className="zoom-controls" aria-label="UI表示倍率">
        <button aria-label="縮小" disabled={zoomPercent <= 75} onClick={onZoomOut} title="縮小 (Ctrl+-)" type="button">−</button>
        <button aria-label={`表示倍率 ${zoomPercent}%、クリックで100%に戻す`} onClick={onResetZoom} title="100%に戻す (Ctrl+0)" type="button">{zoomPercent}%</button>
        <button aria-label="拡大" disabled={zoomPercent >= 150} onClick={onZoomIn} title="拡大 (Ctrl++)" type="button">＋</button>
      </div>
    </nav>
  );
}
