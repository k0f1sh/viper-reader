import assert from "node:assert/strict";
import test, { after } from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import path from "node:path";

const directory = mkdtempSync(path.join(tmpdir(), "viper-hook-"));
process.env.VIPER_READER_DB_PATH = path.join(directory, "settings.db");
const { CommandHookRunner, assertCommandHookConfig, expandHookCommand } = await import("../dist/main/hooks/commandHookRunner.js");
const { getCommandHook, saveCommandHook, clearCommandHook, runCommandHook } = await import("../dist/main/hooks/commandHookService.js");
const { getDatabase } = await import("../dist/main/db/database.js");
const { saveUserSetting, saveRendererUserSetting, getRendererUserSetting } = await import("../dist/main/settings/settingsService.js");
after(() => { getDatabase().close(); rmSync(directory, { recursive: true, force: true }); });
const url = "https://example.com/article?q=a b&value=$(unused);'\"";
const config = (code, ...args) => ({ command: process.execPath, args: ["-e", code, "--", ...args] });

test("フック設定を保存・再読込・削除できる", () => {
  assert.equal(getCommandHook(), null);
  const value = config("process.exit(0)", "{url}");
  saveCommandHook(value);
  assert.deepEqual(getCommandHook(), value);
  assert.throws(() => saveRendererUserSetting("commandHook", "{}"));
  saveUserSetting("commandHook", "{}");
  assert.throws(() => getCommandHook());
  clearCommandHook();
  assert.equal(getCommandHook(), null);
});

test("不正な設定と実行要求を拒否する", async () => {
  for (const invalid of [null, {}, { command: " ", args: [] }, { command: "x\0", args: [] }, { command: "x", args: ["a\0"] }, { command: "x", args: "{url}" }]) {
    assert.throws(() => assertCommandHookConfig(invalid));
  }
  await assert.rejects(runCommandHook(123));
  await assert.rejects(runCommandHook("missing"), /設定/);
  saveCommandHook(config("process.exit(0)"));
  await assert.rejects(runCommandHook("missing"), /URL/);
  const runner = new CommandHookRunner();
  await assert.rejects(runner.run(config("process.exit(0)"), "file:///tmp/example"));
  clearCommandHook();
});

test("ホーム展開とURLの引数置換はシェルを使わず値を保持する", async () => {
  assert.equal(expandHookCommand("~/bin/example-hook"), path.join(homedir(), "bin/example-hook"));
  assert.equal(expandHookCommand("example-hook"), "example-hook");
  const output = path.join(directory, "args.json");
  const runner = new CommandHookRunner();
  await runner.run(config("require('node:fs').writeFileSync(process.argv[1], JSON.stringify({args: process.argv.slice(2), cwd: process.cwd()}))", output, "{url}", "--source={url}", "{url}{url}", ""), url);
  assert.deepEqual(JSON.parse(readFileSync(output, "utf8")), {
    args: [url, `--source=${url}`, url + url, ""], cwd: homedir()
  });
});

test("実行中の重複を拒否し終了後は再実行できる", async () => {
  const runner = new CommandHookRunner();
  const running = runner.run(config("setTimeout(() => {}, 150)"), url);
  await assert.rejects(runner.run(config("process.exit(0)"), url), /実行中/);
  await running;
  await runner.run(config("process.exit(0)"), url);
});

test("起動失敗・異常終了を通知しロックを解放する", async () => {
  const runner = new CommandHookRunner();
  await assert.rejects(runner.run({ command: path.join(directory, "missing"), args: [] }, url), /起動できません/);
  await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(runner.run(config("process.exit(7)"), url), /終了コード 7/);
  await runner.run(config("process.exit(0)"), url);
});

test("終了要求で実行中の子プロセスを停止する", async () => {
  const runner = new CommandHookRunner();
  const running = runner.run(config("setInterval(() => {}, 1000)"), url);
  const ended = assert.rejects(running, /シグナル/);
  runner.stop();
  await ended;
  await runner.run(config("process.exit(0)"), url);
});


test("DB上の元記事URLを渡し、URLなしのローカルスレを拒否する", async () => {
  const db = getDatabase();
  const stamp = new Date().toISOString();
  db.prepare("INSERT INTO feed_sources (id, kind, title, url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run("hook-rss", "rss", "Example", "https://example.com/feed", stamp, stamp);
  db.prepare("INSERT INTO feed_sources (id, kind, title, url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run("hook-local", "local", "Local", "viper-local://hook", stamp, stamp);
  const insert = db.prepare("INSERT INTO feed_items (id, feed_id, title, url, source_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)");
  insert.run("rss-item", "hook-rss", "Example", url, null, stamp, stamp);
  insert.run("local-item", "hook-local", "Local", "viper-local://item", url, stamp, stamp);
  insert.run("no-url", "hook-local", "Text", "viper-local://text", null, stamp, stamp);
  const output = path.join(directory, "service-url.txt");
  saveCommandHook(config("require('node:fs').writeFileSync(process.argv[1], process.argv[2])", output, "{url}"));
  for (const id of ["rss-item", "local-item"]) {
    await runCommandHook(id);
    assert.equal(readFileSync(output, "utf8"), url);
  }
  await assert.rejects(runCommandHook("no-url"), /URL/);
  clearCommandHook();
});


test("UIズームの既存設定キーを読み書きできる", () => {
  saveRendererUserSetting("ui_zoom_percent_v1", "125");
  assert.equal(getRendererUserSetting("ui_zoom_percent_v1"), "125");
  assert.throws(() => getRendererUserSetting("unknown-setting"));
});

test("異常終了時に標準エラーの末尾をサイズ制限付きで通知する", async () => {
  const runner = new CommandHookRunner();
  await assert.rejects(runner.run(config("require('node:fs').writeSync(2, 'example failure'); process.exit(1)"), url), /終了コード 1[\s\S]*example failure/);
  await assert.rejects(runner.run(config("require('node:fs').writeSync(2, 'x'.repeat(20000) + 'END'); process.exit(2)"), url), (error) => {
    assert.ok(error.message.endsWith("END"));
    assert.ok(error.message.length < 8300);
    return true;
  });
});

test("標準出力と標準エラーを終了前から通知しUTF-8と出力上限を維持する", async () => {
  const runner = new CommandHookRunner();
  let notify;
  const firstOutput = new Promise((resolve) => { notify = resolve; });
  const snapshots = [];
  let finished = false;
  const code = `const fs = require('node:fs');
    fs.writeSync(1, 'x'.repeat(40000));
    const text = Buffer.from('日本語');
    fs.writeSync(1, text.subarray(0, 1));
    setTimeout(() => {
      fs.writeSync(1, text.subarray(1));
      fs.writeSync(2, '\\nexample stderr');
    }, 30);
    setTimeout(() => process.exit(0), 400);`;
  const running = runner.run(config(code), url, (output) => {
    snapshots.push(output);
    notify();
  }).then(() => { finished = true; });
  await firstOutput;
  assert.equal(finished, false);
  await running;
  assert.ok(snapshots.every((text) => text.length <= 32768));
  assert.match(snapshots.at(-1), /日本語/);
  assert.match(snapshots.at(-1), /example stderr/);
  assert.ok(!snapshots.at(-1).includes('\ufffd'));
});


test("外部プロセスのPIDと正常終了・異常終了・起動失敗・シグナルを通知する", async () => {
  const runner = new CommandHookRunner();
  const states = [];
  const report = (state) => states.push(state);
  await runner.run(config("process.exit(0)"), url, undefined, report);
  assert.deepEqual(states.map((state) => state.status), ["running", "completed"]);
  assert.ok(Number.isInteger(states[0].pid) && states[0].pid > 0);
  assert.equal(states[1].pid, states[0].pid);
  assert.equal(states[1].exitCode, 0);
  assert.equal(states[1].signal, null);
  assert.equal(states[0].command, process.execPath);
  states.length = 0;
  await assert.rejects(runner.run(config("process.exit(3)"), url, undefined, report));
  assert.equal(states.at(-1).status, "failed");
  assert.equal(states.at(-1).exitCode, 3);
  states.length = 0;
  await assert.rejects(runner.run({ command: path.join(directory, "missing"), args: [] }, url, undefined, report));
  assert.deepEqual(states.map((state) => state.status), ["spawn-failed"]);
  assert.equal(states[0].pid, null);
  assert.equal(states[0].exitCode, null);
  states.length = 0;
  const running = runner.run(config("setInterval(() => {}, 1000)"), url, undefined, (state) => {
    report(state);
    if (state.status === "running") runner.stop();
  });
  await assert.rejects(running);
  assert.equal(states.at(-1).status, "failed");
  assert.equal(states.at(-1).signal, "SIGTERM");
  assert.equal(states.at(-1).exitCode, null);
});


test("子孫プロセスが出力パイプを保持しても終了を通知し再実行できる", { timeout: 5000 }, async () => {
  const runner = new CommandHookRunner();
  const pidFile = path.join(directory, "descendant.pid");
  const states = [];
  const code = `const {spawn} = require('node:child_process');
    const fs = require('node:fs');
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 4000)'], { stdio: ['ignore', 1, 2] });
    child.unref();
    fs.writeFileSync(process.argv[1], String(child.pid));
    fs.writeSync(1, 'parent output');
    process.exit(0);`;
  let output = "";
  let descendantPid;
  try {
    await runner.run(config(code, pidFile), url, (text) => { output = text; }, (state) => states.push(state));
    descendantPid = Number(readFileSync(pidFile, "utf8"));
    assert.doesNotThrow(() => process.kill(descendantPid, 0));
    assert.deepEqual(states.map((state) => state.status), ["running", "completed"]);
    assert.equal(states.at(-1).exitCode, 0);
    assert.match(output, /parent output/);
    await runner.run(config("process.exit(0)"), url);
  } finally {
    runner.stop();
    if (!descendantPid) {
      try { descendantPid = Number(readFileSync(pidFile, "utf8")); } catch {}
    }
    if (descendantPid) {
      try { process.kill(descendantPid); } catch {}
    }
  }
});
