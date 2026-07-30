import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after } from "node:test";

const testDirectory = mkdtempSync(path.join(tmpdir(), "viper-reader-resident-prompt-test-"));
process.env.VIPER_READER_DB_PATH = path.join(testDirectory, "test.db");

const { getDatabase } = await import("../dist/main/db/database.js");
const { addFeedSource } = await import("../dist/main/db/feedRepository.js");
const {
  clearFeedResidentPrompt,
  ensureFeedResidents,
  getActiveResidentPromptVersion,
  getFeedResidentPrompt,
  listResidentPromptVersions,
  reviewResidentPromptVersion,
  rollbackResidentPromptVersion,
  saveFeedResidentPrompt,
  saveResidentPromptProposal
} = await import("../dist/main/db/residentPromptRepository.js");

const db = getDatabase();
const feed = addFeedSource("テスト板", "https://example.com/resident-feed.xml");

after(() => {
  db.close();
  rmSync(testDirectory, { recursive: true, force: true });
});

test("住民プロンプトを正規化して保存し削除できる", () => {
  saveFeedResidentPrompt(feed.id, "  記事の根拠を確認すること  ");

  const saved = getFeedResidentPrompt(feed.id);
  assert.equal(saved?.prompt, "記事の根拠を確認すること");
  assert.match(saved?.promptHash ?? "", /^[a-f0-9]{12}$/);

  clearFeedResidentPrompt(feed.id);
  assert.equal(getFeedResidentPrompt(feed.id), null);
});

test("固定住民は再初期化しても同じIDで重複しない", () => {
  const first = ensureFeedResidents(feed.id);
  const second = ensureFeedResidents(feed.id);

  assert.equal(first.length, 3);
  assert.deepEqual(second, first);
  assert.equal(new Set(first.map((resident) => resident.stableUid)).size, 3);
});

test("改善版の承認と以前の版へのロールバックを管理する", () => {
  saveResidentPromptProposal({
    id: "prompt-version:first",
    feedId: feed.id,
    parentId: null,
    basePromptHash: "base",
    adaptivePrompt: "最初の改善",
    rationale: "最初の理由",
    changes: ["変更1"],
    model: "test-model",
    feedbackThroughAt: "2026-01-01T00:00:00.000Z"
  });
  reviewResidentPromptVersion("prompt-version:first", "active");

  saveResidentPromptProposal({
    id: "prompt-version:second",
    feedId: feed.id,
    parentId: "prompt-version:first",
    basePromptHash: "base",
    adaptivePrompt: "次の改善",
    rationale: "次の理由",
    changes: ["変更2"],
    model: "test-model",
    feedbackThroughAt: "2026-01-02T00:00:00.000Z"
  });
  reviewResidentPromptVersion("prompt-version:second", "active");

  assert.equal(getActiveResidentPromptVersion(feed.id)?.id, "prompt-version:second");
  rollbackResidentPromptVersion(feed.id);
  assert.equal(getActiveResidentPromptVersion(feed.id)?.id, "prompt-version:first");

  const versions = listResidentPromptVersions(feed.id);
  assert.equal(versions.length, 2);
  assert.deepEqual(versions.find((version) => version.id === "prompt-version:first")?.changes, ["変更1"]);
});
