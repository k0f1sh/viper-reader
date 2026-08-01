type MenuBarProps = {
  onOpenSettings: () => void;
  onOpenBrowserSettings: () => void;
  onOpenModelSettings: () => void;
  onOpenStatistics: () => void;
  onOpenResidentPrompts: () => void;
};

export function MenuBar({
  onOpenSettings,
  onOpenBrowserSettings,
  onOpenModelSettings,
  onOpenStatistics,
  onOpenResidentPrompts
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
    </nav>
  );
}
