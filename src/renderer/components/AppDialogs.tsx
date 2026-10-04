import type { ComponentProps, ElementType } from "react";
import { AddFeedModal } from "./AddFeedModal";
import { BrowserSettingsModal } from "./BrowserSettingsModal";
import { FeedSettingsModal } from "./FeedSettingsModal";
import { FolderNameModal } from "./FolderNameModal";
import { GenerationFailureModal } from "./GenerationFailureModal";
import { ModelSettingsModal } from "./ModelSettingsModal";
import { ReplyPopup } from "./ReplyPopup";
import { ResidentPromptsModal } from "./ResidentPromptsModal";
import { SettingsModal } from "./SettingsModal";
import { StatisticsModal } from "./StatisticsModal";
import { TitleGenerationStatusModal } from "./TitleGenerationStatusModal";

type OptionalDialog<T extends ElementType> = ComponentProps<T> | null;

type AppDialogsProps = {
  statistics: OptionalDialog<typeof StatisticsModal>;
  settings: OptionalDialog<typeof SettingsModal>;
  browserSettings: OptionalDialog<typeof BrowserSettingsModal>;
  modelSettings: OptionalDialog<typeof ModelSettingsModal>;
  residentPrompts: OptionalDialog<typeof ResidentPromptsModal>;
  addFeed: OptionalDialog<typeof AddFeedModal>;
  folder: OptionalDialog<typeof FolderNameModal>;
  feedSettings: OptionalDialog<typeof FeedSettingsModal>;
  generationFailure: OptionalDialog<typeof GenerationFailureModal>;
  titleGenerationStatus: OptionalDialog<typeof TitleGenerationStatusModal>;
  replyPopup: OptionalDialog<typeof ReplyPopup>;
};

export function AppDialogs(props: AppDialogsProps) {
  return (
    <>
      {props.statistics ? <StatisticsModal {...props.statistics} /> : null}
      {props.settings ? <SettingsModal {...props.settings} /> : null}
      {props.browserSettings ? <BrowserSettingsModal {...props.browserSettings} /> : null}
      {props.modelSettings ? <ModelSettingsModal {...props.modelSettings} /> : null}
      {props.residentPrompts ? <ResidentPromptsModal {...props.residentPrompts} /> : null}
      {props.addFeed ? <AddFeedModal {...props.addFeed} /> : null}
      {props.folder ? <FolderNameModal {...props.folder} /> : null}
      {props.feedSettings ? <FeedSettingsModal {...props.feedSettings} /> : null}
      {props.generationFailure ? <GenerationFailureModal {...props.generationFailure} /> : null}
      {props.titleGenerationStatus ? <TitleGenerationStatusModal {...props.titleGenerationStatus} /> : null}
      {props.replyPopup ? <ReplyPopup {...props.replyPopup} /> : null}
    </>
  );
}
