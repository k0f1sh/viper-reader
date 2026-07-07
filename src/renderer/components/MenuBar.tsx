type MenuBarProps = {
  replyModel: string;
  onReplyModelChange: (model: string) => void;
  onOpenStatistics: () => void;
  onOpenResidentPrompts: () => void;
};

export function MenuBar({
  replyModel,
  onReplyModelChange,
  onOpenStatistics,
  onOpenResidentPrompts
}: MenuBarProps) {
  return (
    <nav className="menu-bar" aria-label="メニュー">
      <button className="menu-item" type="button">
        ファイル
      </button>
      <button className="menu-item" type="button">
        表示
      </button>
      <button className="menu-item" onClick={onOpenStatistics} type="button">
        統計情報
      </button>
      <button className="menu-item" onClick={onOpenResidentPrompts} type="button">
        住民設定
      </button>
      <div className="menu-select-wrapper">
        <label htmlFor="reply-model-select">レスモデル:</label>
        <select
          id="reply-model-select"
          className="menu-select"
          value={replyModel}
          onChange={(event) => onReplyModelChange(event.target.value)}
        >
          <option value="gemini-3.1-flash-lite">3.1 flash lite</option>
          <option value="gemini-3.5-flash">3.5 flash</option>
        </select>
      </div>
    </nav>
  );
}
