type FolderNameModalProps = {
  mode: "create" | "rename";
  name: string;
  error: string;
  isSaving: boolean;
  onNameChange: (name: string) => void;
  onSave: () => void;
  onClose: () => void;
};

export function FolderNameModal({ mode, name, error, isSaving, onNameChange, onSave, onClose }: FolderNameModalProps) {
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="add-feed-modal folder-name-modal" aria-label={mode === "create" ? "フォルダの追加" : "フォルダ名の変更"} role="dialog">
        <div className="modal-title-bar"><span>{mode === "create" ? "フォルダの追加" : "フォルダ名の変更"}</span><button className="modal-close-button" disabled={isSaving} onClick={onClose} type="button">x</button></div>
        <div className="modal-content">
          <label htmlFor="folder-name-input">フォルダ名:</label>
          <input id="folder-name-input" className="add-feed-input" type="text" value={name} maxLength={200} disabled={isSaving} autoFocus onChange={(event) => onNameChange(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && name.trim()) onSave(); }} />
          {error ? <div className="prompt-status-message text-error">{error}</div> : null}
          <div className="modal-buttons"><button className="btn" disabled={isSaving || !name.trim()} onClick={onSave} type="button">保存</button><button className="btn" disabled={isSaving} onClick={onClose} type="button">キャンセル</button></div>
        </div>
      </section>
    </div>
  );
}
