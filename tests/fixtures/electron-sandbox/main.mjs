import assert from "node:assert/strict";
import { app } from "electron";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

void app.whenReady().then(async () => {
  let firstRenderer;
  let latestRenderer;
  app.on("web-contents-created", (_event, contents) => {
    firstRenderer ??= contents;
    latestRenderer = contents;
    contents.on("console-message", event => console.log(event.message));
    contents.on("preload-error", (_event, _path, error) => console.error(error));
  });

  try {
    const root = process.env.VIPER_READER_TEST_PACKAGE ?? ".";
    const entry = pathToFileURL(resolve(root, "dist/main/scraper/articleFetcherSandbox.js"));
    const { runStandardArticleFetcher, runIsolatedArticleFetcher } = await import(entry.href);
    const url = "https://example.org/article";
    let requests = 0;
    const getPage = async target => {
      assert.equal(target, url);
      requests += 1;
      return { url, text: "<article><p>Fixture article.</p></article>" };
    };

    const probeRenderer = async target => {
      assert.ok(firstRenderer.getLastWebPreferences().sandbox);
      assert.equal(firstRenderer.getLastWebPreferences().nodeIntegration, false);
      const result = await firstRenderer.executeJavaScript(`
        Promise.all([
          typeof require,
          typeof process,
          window.open("https://example.org/") === null,
          fetch("https://example.org/").then(() => false, () => true)
        ])
      `);
      assert.deepEqual(result, ["undefined", "undefined", true, true]);
      return getPage(target);
    };
    assert.equal((await runStandardArticleFetcher(url, probeRenderer)).bodyText, "Fixture article.");
    assert.equal(requests, 1);

    for (const name of ["js-eval", "node-require", "load", "exec", "http-request", "save-article"]) {
      await assert.rejects(runIsolatedArticleFetcher(url, getPage, `
        (define-article-fetcher (item) (${name} "example"))`), /評価に失敗/);
    }

    for (const body of ['(http-get "https://other.example/")', '(http-get (item-url item)) (http-get (item-url item))']) {
      await assert.rejects(runIsolatedArticleFetcher(url, getPage, `
        (define-article-fetcher (item) ${body})`), /許可範囲外/);
    }
    assert.equal(requests, 2);

    let loopPid;
    const loop = runIsolatedArticleFetcher(url, target => {
      loopPid = loopRenderer.getOSProcessId();
      return getPage(target);
    }, `
      (define-article-fetcher (item) (http-get (item-url item)) (let loop () (loop)))`, 3_000);
    const loopRenderer = latestRenderer;
    const other = runStandardArticleFetcher(url, getPage);
    await assert.rejects(loop, /タイムアウト/);
    assert.equal((await other).bodyText, "Fixture article.");
    assert.equal(requests, 4);
    assert.ok(loopPid > 0);
    const isRunning = () => app.getAppMetrics().some(process => process.pid === loopPid);
    for (let attempts = 0; isRunning() && attempts < 20; attempts += 1) await delay(50);
    assert.equal(isRunning(), false, "The timed-out renderer process should exit.");
    assert.equal((await runStandardArticleFetcher(url, getPage)).bodyText, "Fixture article.");

    let signal;
    await assert.rejects(runIsolatedArticleFetcher(url, (_target, abortSignal) => {
      signal = abortSignal;
      return new Promise(() => {});
    }, "(define-article-fetcher (item) (http-get (item-url item)))", 3_000), /タイムアウト/);
    assert.equal(signal?.aborted, true);

    console.log("Electron Scheme sandbox verified");
    app.exit(0);
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
