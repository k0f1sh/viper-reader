import { useState } from "react";
import type { SetStateAction } from "react";
import type { FeedFolder, FeedSource } from "../../shared/types";

export type AddFeedForm = {
  title: string;
  url: string;
  generateTitleFromSummary: boolean;
  skipTitleConversion: boolean;
  error: string;
  isLoading: boolean;
};

export type FolderForm = {
  mode: "create" | "rename";
  targetId: string | null;
  name: string;
  error: string;
  isSaving: boolean;
};

export type FeedSettingsForm = {
  feed: FeedSource;
  title: string;
  generateTitleFromSummary: boolean;
  skipTitleConversion: boolean;
  error: string;
  isSaving: boolean;
};

export type ReplyComposer = {
  name: string;
  mail: string;
  body: string;
  error: string;
  status: "idle" | "writing" | "generating" | "done" | "error";
  isPosting: boolean;
};

const emptyAddFeedForm: AddFeedForm = {
  title: "",
  url: "",
  generateTitleFromSummary: false,
  skipTitleConversion: false,
  error: "",
  isLoading: false
};

const emptyReplyComposer: ReplyComposer = {
  name: "",
  mail: "sage",
  body: "",
  error: "",
  status: "idle",
  isPosting: false
};

export function useAddFeedForm() {
  const [form, setForm] = useState<AddFeedForm>(emptyAddFeedForm);

  return {
    form,
    update: (patch: Partial<AddFeedForm>) => setForm((current) => ({ ...current, ...patch })),
    reset: () => setForm(emptyAddFeedForm)
  };
}

export function useFolderForm() {
  const [form, setForm] = useState<FolderForm | null>(null);

  return {
    form,
    openCreate: () => setForm({ mode: "create", targetId: null, name: "", error: "", isSaving: false }),
    openRename: (folder: FeedFolder) => setForm({
      mode: "rename",
      targetId: folder.id,
      name: folder.name,
      error: "",
      isSaving: false
    }),
    update: (patch: Partial<FolderForm>) => setForm((current) => current ? ({ ...current, ...patch }) : current),
    close: () => setForm(null)
  };
}

export function useFeedSettingsForm() {
  const [form, setForm] = useState<FeedSettingsForm | null>(null);

  return {
    form,
    open: (feed: FeedSource) => setForm({
      feed,
      title: feed.title,
      generateTitleFromSummary: feed.generateTitleFromSummary,
      skipTitleConversion: feed.skipTitleConversion,
      error: "",
      isSaving: false
    }),
    update: (patch: Partial<FeedSettingsForm>) => setForm((current) => current ? ({ ...current, ...patch }) : current),
    close: () => setForm(null)
  };
}

export function useReplyComposer() {
  const [composer, setComposer] = useState<ReplyComposer>(emptyReplyComposer);

  return {
    composer,
    update: (patch: Partial<ReplyComposer>) => setComposer((current) => ({ ...current, ...patch })),
    setBody: (value: SetStateAction<string>) => setComposer((current) => ({
      ...current,
      body: typeof value === "function" ? value(current.body) : value
    }))
  };
}
