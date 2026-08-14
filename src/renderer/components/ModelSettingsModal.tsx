import { useState } from "react";
import { geminiModelOptions } from "../../shared/geminiModels";

type ModelSettingsModalProps = {
  titleModel: string;
  replyModel: string;
  isSaving: boolean;
  onSave: (models: { titleModel: string; replyModel: string }) => void;
  onClose: () => void;
};

export function ModelSettingsModal({
  titleModel,
  replyModel,
  isSaving,
  onSave,
  onClose
}: ModelSettingsModalProps) {
  const [draftTitleModel, setDraftTitleModel] = useState(titleModel);
  const [draftReplyModel, setDraftReplyModel] = useState(replyModel);

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="settings-modal" aria-label="モデル設定" role="dialog">
        <div className="modal-title-bar">
          <span>モデル設定</span>
          <button className="modal-close-button" disabled={isSaving} onClick={onClose} type="button">x</button>
        </div>
        <form
          className="settings-content"
          onSubmit={(event) => {
            event.preventDefault();
            onSave({
              titleModel: draftTitleModel,
              replyModel: draftReplyModel
            });
          }}
        >
          <fieldset disabled={isSaving}>
            <legend>用途ごとの Gemini モデル</legend>
            <ModelSelect label="スレタイ生成" value={draftTitleModel} onChange={setDraftTitleModel} />
            <ModelSelect label="レス生成" value={draftReplyModel} onChange={setDraftReplyModel} />
            <p className="settings-help">変更後に新しく実行する生成から適用されます。生成済みキャッシュはそのまま保持されます。</p>
          </fieldset>
          <div className="settings-buttons">
            <button className="settings-button" disabled={isSaving} type="submit">{isSaving ? "保存中..." : "保存"}</button>
            <button className="settings-button" disabled={isSaving} onClick={onClose} type="button">キャンセル</button>
          </div>
        </form>
      </section>
    </div>
  );
}

function ModelSelect({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <>
      <label htmlFor={`model-${label}`}>{label}:</label>
      <select id={`model-${label}`} className="settings-input" value={value} onChange={(event) => onChange(event.target.value)}>
        {geminiModelOptions.map(([model, name]) => <option key={model} value={model}>{name}</option>)}
      </select>
    </>
  );
}
