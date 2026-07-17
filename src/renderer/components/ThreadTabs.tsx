import type { DragEvent, MouseEvent } from "react";

export type OpenThreadTab = {
  id: string;
  feedId: string;
  title: string;
  isLocked: boolean;
};

type ThreadTabsProps = {
  tabs: OpenThreadTab[];
  activeTabId: string | undefined;
  generatingThreadIds: Set<string>;
  completedThreadIds: Set<string>;
  onActivate: (tab: OpenThreadTab) => void;
  onClose: (tabId: string) => void;
  onToggleLock: (tabId: string) => void;
  onMove: (sourceTabId: string, targetTabId: string) => void;
};

export function ThreadTabs({
  tabs,
  activeTabId,
  generatingThreadIds,
  completedThreadIds,
  onActivate,
  onClose,
  onToggleLock,
  onMove
}: ThreadTabsProps) {
  function handleDrop(event: DragEvent<HTMLElement>, targetTabId: string) {
    event.preventDefault();
    const sourceTabId = event.dataTransfer.getData("text/plain");
    if (sourceTabId && sourceTabId !== targetTabId) {
      onMove(sourceTabId, targetTabId);
    }
  }

  function handleAuxClick(event: MouseEvent<HTMLElement>, tab: OpenThreadTab) {
    if (event.button !== 1 || tab.isLocked) {
      return;
    }

    event.preventDefault();
    onClose(tab.id);
  }

  return (
    <div className="thread-tabs" role="tablist" aria-label="開いているスレッド">
      {tabs.length === 0 ? (
        <div className="thread-tabs-empty">スレッドを選択するとタブが開きます</div>
      ) : (
        tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          const isGenerating = generatingThreadIds.has(tab.id);
          const isCompleted = completedThreadIds.has(tab.id);

          return (
            <div
              aria-selected={isActive}
              className={`thread-tab ${isActive ? "is-active" : ""} ${tab.isLocked ? "is-locked" : ""}`}
              draggable
              key={tab.id}
              onAuxClick={(event) => handleAuxClick(event, tab)}
              onDragOver={(event) => event.preventDefault()}
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", tab.id);
              }}
              onDrop={(event) => handleDrop(event, tab.id)}
              role="tab"
            >
              <button
                className="thread-tab-label"
                onClick={() => onActivate(tab)}
                title={tab.title}
                type="button"
              >
                {isGenerating ? <span className="thread-tab-state">処理中:</span> : null}
                {isCompleted ? <span className="thread-tab-state is-completed">新着:</span> : null}
                <span>{tab.title}</span>
              </button>
              <button
                aria-label={tab.isLocked ? `${tab.title}のロックを解除` : `${tab.title}をロック`}
                className="thread-tab-lock"
                onClick={() => onToggleLock(tab.id)}
                title={tab.isLocked ? "タブロックを解除" : "タブをロック"}
                type="button"
              >
                L
              </button>
              <button
                aria-label={`${tab.title}を閉じる`}
                className="thread-tab-close"
                disabled={tab.isLocked}
                onClick={() => onClose(tab.id)}
                title={tab.isLocked ? "ロック中のタブは閉じられません" : "タブを閉じる（中クリックでも閉じます）"}
                type="button"
              >
                ×
              </button>
            </div>
          );
        })
      )}
    </div>
  );
}
