import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after } from "node:test";

const testDirectory = mkdtempSync(path.join(tmpdir(), "viper-reader-feed-folder-test-"));
process.env.VIPER_READER_DB_PATH = path.join(testDirectory, "test.db");

const { getDatabase } = await import("../dist/main/db/database.js");
const { addFeedSource, createFeedFolder, deleteFeedFolder, listFeedFolders, listFeeds, renameFeedFolder, saveFeedTreeLayout } = await import("../dist/main/db/repository.js");
const db = getDatabase();

after(() => { db.close(); rmSync(testDirectory, { recursive: true, force: true }); });

test("フォルダをネストし、板とフォルダの混在順を保存できる", () => {
  const first = addFeedSource("1番目", "https://example.com/first.xml");
  const second = addFeedSource("2番目", "https://example.com/second.xml");
  const rootFolder = createFeedFolder(" 開発 ", null);
  const childFolder = createFeedFolder("言語", rootFolder.id);
  const nestedFeed = addFeedSource("Rust", "https://example.com/rust.xml", false, false, childFolder.id);
  assert.equal(listFeeds().find((feed) => feed.id === nestedFeed.id)?.unreadCount, 0);

  saveFeedTreeLayout([
    { type: "folder", id: rootFolder.id, parentFolderId: null },
    { type: "folder", id: childFolder.id, parentFolderId: rootFolder.id },
    { type: "feed", id: nestedFeed.id, parentFolderId: childFolder.id },
    { type: "feed", id: first.id, parentFolderId: null },
    { type: "feed", id: second.id, parentFolderId: null }
  ]);

  assert.equal(rootFolder.name, "開発");
  assert.equal(listFeedFolders().find((folder) => folder.id === childFolder.id)?.parentFolderId, rootFolder.id);
  assert.equal(listFeeds().find((feed) => feed.id === nestedFeed.id)?.parentFolderId, childFolder.id);
  assert.equal(listFeeds().find((feed) => feed.id === first.id)?.sortOrder, 1);
  assert.equal(renameFeedFolder(childFolder.id, "プログラミング言語").name, "プログラミング言語");
});

test("循環配置と中身のあるフォルダ削除を拒否する", () => {
  const root = listFeedFolders().find((folder) => folder.name === "開発");
  const child = listFeedFolders().find((folder) => folder.name === "プログラミング言語");
  assert.throws(() => deleteFeedFolder(root.id), /中身のあるフォルダ/);
  assert.throws(() => saveFeedTreeLayout([
    { type: "folder", id: root.id, parentFolderId: child.id },
    { type: "folder", id: child.id, parentFolderId: root.id },
    ...listFeeds().map((feed) => ({ type: "feed", id: feed.id, parentFolderId: feed.parentFolderId }))
  ]), /自身または子孫/);
  assert.equal(listFeedFolders().find((folder) => folder.id === root.id)?.parentFolderId, null);
});

test("空フォルダだけを削除できる", () => {
  const folder = createFeedFolder("一時", null);
  deleteFeedFolder(folder.id);
  assert.equal(listFeedFolders().some((candidate) => candidate.id === folder.id), false);
});

test("欠落・重複・存在しない親を含む配置は保存せず、既存配置を維持する", () => {
  const beforeFolders = listFeedFolders().map((folder) => ({ id: folder.id, parentFolderId: folder.parentFolderId, sortOrder: folder.sortOrder }));
  const beforeFeeds = listFeeds().map((feed) => ({ id: feed.id, parentFolderId: feed.parentFolderId, sortOrder: feed.sortOrder }));
  assert.throws(() => saveFeedTreeLayout([]), /配置が不正/);
  assert.throws(() => saveFeedTreeLayout([
    ...beforeFolders.map((folder) => ({ type: "folder", id: folder.id, parentFolderId: folder.parentFolderId })),
    ...beforeFeeds.map((feed) => ({ type: "feed", id: feed.id, parentFolderId: "folder:missing" }))
  ]), /配置先フォルダ/);
  assert.deepEqual(listFeedFolders().map((folder) => ({ id: folder.id, parentFolderId: folder.parentFolderId, sortOrder: folder.sortOrder })), beforeFolders);
  assert.deepEqual(listFeeds().map((feed) => ({ id: feed.id, parentFolderId: feed.parentFolderId, sortOrder: feed.sortOrder })), beforeFeeds);
});
