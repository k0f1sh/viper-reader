import crypto from "node:crypto";
import type { FeedFolder, FeedTreePlacement } from "../../shared/types.js";
import { getDatabase } from "./database.js";

type FolderRow = {
  id: string;
  name: string;
  parent_folder_id: string | null;
  sort_order: number;
};

export function listFeedFolders(): FeedFolder[] {
  return (getDatabase().prepare(`
    SELECT id, name, parent_folder_id, sort_order
    FROM feed_folders
    ORDER BY parent_folder_id ASC, sort_order ASC, created_at ASC
  `).all() as FolderRow[]).map(mapFolder);
}

export function createFeedFolder(name: string, parentFolderId: string | null): FeedFolder {
  const normalizedName = validateFolderName(name);
  const db = getDatabase();
  assertFolderExists(db, parentFolderId);
  const now = new Date().toISOString();
  const id = `folder:${crypto.randomUUID()}`;
  const sortOrder = nextChildSortOrder(db, parentFolderId);
  db.prepare(`
    INSERT INTO feed_folders (id, name, parent_folder_id, sort_order, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, normalizedName, parentFolderId, sortOrder, now, now);
  return { id, name: normalizedName, parentFolderId, sortOrder };
}

export function renameFeedFolder(folderId: string, name: string): FeedFolder {
  const normalizedName = validateFolderName(name);
  const db = getDatabase();
  const result = db.prepare("UPDATE feed_folders SET name = ?, updated_at = ? WHERE id = ?")
    .run(normalizedName, new Date().toISOString(), folderId);
  if (result.changes === 0) throw new Error(`Folder not found: ${folderId}`);
  const row = db.prepare("SELECT id, name, parent_folder_id, sort_order FROM feed_folders WHERE id = ?")
    .get(folderId) as FolderRow;
  return mapFolder(row);
}

export function deleteFeedFolder(folderId: string): void {
  const db = getDatabase();
  const childFolder = db.prepare("SELECT 1 FROM feed_folders WHERE parent_folder_id = ? LIMIT 1").get(folderId);
  const childFeed = db.prepare("SELECT 1 FROM feed_sources WHERE parent_folder_id = ? LIMIT 1").get(folderId);
  if (childFolder || childFeed) throw new Error("中身のあるフォルダは削除できません。");
  const result = db.prepare("DELETE FROM feed_folders WHERE id = ?").run(folderId);
  if (result.changes === 0) throw new Error(`Folder not found: ${folderId}`);
}

export function saveFeedTreeLayout(placements: FeedTreePlacement[]): void {
  const db = getDatabase();
  const feedIds = new Set((db.prepare("SELECT id FROM feed_sources").all() as Array<{ id: string }>).map((row) => row.id));
  const folderIds = new Set((db.prepare("SELECT id FROM feed_folders").all() as Array<{ id: string }>).map((row) => row.id));
  if (placements.length !== feedIds.size + folderIds.size) throw new Error("板ツリーの配置が不正です。");

  const seen = new Set<string>();
  const folderParents = new Map<string, string | null>();
  for (const placement of placements) {
    if (!placement || (placement.type !== "feed" && placement.type !== "folder") || typeof placement.id !== "string") {
      throw new Error("板ツリーの配置が不正です。");
    }
    if (placement.parentFolderId !== null && typeof placement.parentFolderId !== "string") {
      throw new Error("板ツリーの配置が不正です。");
    }
    const key = `${placement.type}:${placement.id}`;
    const expectedIds = placement.type === "feed" ? feedIds : folderIds;
    if (!expectedIds.has(placement.id) || seen.has(key)) throw new Error("板ツリーの配置が不正です。");
    if (placement.parentFolderId !== null && !folderIds.has(placement.parentFolderId)) {
      throw new Error("配置先フォルダが見つかりません。");
    }
    seen.add(key);
    if (placement.type === "folder") folderParents.set(placement.id, placement.parentFolderId);
  }
  for (const folderId of folderIds) {
    const visited = new Set<string>();
    let current: string | null | undefined = folderId;
    while (current !== null && current !== undefined) {
      if (visited.has(current)) throw new Error("フォルダを自身または子孫へ移動できません。");
      visited.add(current);
      current = folderParents.get(current);
    }
  }

  const siblingIndexes = new Map<string, number>();
  const now = new Date().toISOString();
  const updateFeed = db.prepare("UPDATE feed_sources SET parent_folder_id = ?, sort_order = ?, updated_at = ? WHERE id = ?");
  const updateFolder = db.prepare("UPDATE feed_folders SET parent_folder_id = ?, sort_order = ?, updated_at = ? WHERE id = ?");
  db.exec("BEGIN");
  try {
    for (const placement of placements) {
      const parentKey = placement.parentFolderId ?? "__root__";
      const sortOrder = siblingIndexes.get(parentKey) ?? 0;
      siblingIndexes.set(parentKey, sortOrder + 1);
      const update = placement.type === "feed" ? updateFeed : updateFolder;
      update.run(placement.parentFolderId, sortOrder, now, placement.id);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function validateFolderName(name: string): string {
  if (typeof name !== "string") throw new Error("フォルダ名が不正です。");
  const normalized = name.trim();
  if (!normalized || normalized.length > 200) throw new Error("フォルダ名が不正です。");
  return normalized;
}

function assertFolderExists(db: ReturnType<typeof getDatabase>, folderId: string | null): void {
  if (folderId !== null && !db.prepare("SELECT id FROM feed_folders WHERE id = ?").get(folderId)) {
    throw new Error("配置先フォルダが見つかりません。");
  }
}

function nextChildSortOrder(db: ReturnType<typeof getDatabase>, parentFolderId: string | null): number {
  const feed = db.prepare("SELECT COALESCE(MAX(sort_order), -1) AS value FROM feed_sources WHERE parent_folder_id IS ?")
    .get(parentFolderId) as { value: number };
  const folder = db.prepare("SELECT COALESCE(MAX(sort_order), -1) AS value FROM feed_folders WHERE parent_folder_id IS ?")
    .get(parentFolderId) as { value: number };
  return Math.max(Number(feed.value), Number(folder.value)) + 1;
}

function mapFolder(row: FolderRow): FeedFolder {
  return { id: row.id, name: row.name, parentFolderId: row.parent_folder_id, sortOrder: Number(row.sort_order) };
}
