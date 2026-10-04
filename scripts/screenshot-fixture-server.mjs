import { createServer } from "node:http";

const port = Number(process.argv[2] ?? 48765);
const origin = `http://127.0.0.1:${port}`;

const feeds = [
  {
    slug: "ai-dev",
    title: "AI・開発",
    items: [
      ["cat-reviewer", "AIコードレビュアー、社内猫に褒められると精度が2倍になる", "架空の開発チームがAIコードレビュアーへ社内猫の写真を見せたところ、急に丁寧なレビューを返し始めた。猫の喉鳴らし音と指摘件数の相関を大まじめに検証する。"],
      ["meeting-three-lines", "4時間の会議を必ず3行にするAI、最後は全部『要検討』になる", "長い会議を三行へ圧縮する架空AIを試したところ、議題が増えるほど結論が『要検討』へ収束した。要約率と責任回避率を比較する。"],
      ["bug-applause", "バグを1個直すたび別のバグが拍手してくる開発環境を作った", "テストが落ちるたび拍手音を鳴らす架空の開発環境を実装した。開発者の士気、近所迷惑、バグ修正速度への影響を測る。"],
      ["readme-agent", "READMEを最後まで読んでから質問するAIエージェント、ついに完成", "質問前に必ずREADMEを読む架空AIエージェントを作った。人類には難しかった手順を自動化し、既知の質問がどれだけ減るか試す。"],
      ["rubber-duck-llm", "ゴムのアヒルとLLMをペアプロさせたら人間が不要になりかけた", "架空の実験として、ゴムのアヒルの沈黙をLLMへ入力し続けた。沈黙の長さとコード品質の関係、人間の居場所について考察する。"]
    ]
  },
  {
    slug: "web-ui",
    title: "Webフロントエンド",
    items: [
      ["css-pigeon", "CSSだけで鳩を画面中央に寄せる方法、ついに見つかる", "架空の鳩要素を縦横中央へ配置するため、FlexboxとGridと鳩の気分を比較した。パンくずを使わないフォールバックも紹介する。"],
      ["later-storage", "ブラウザに『あとで考える』Storage APIが試験実装", "値を保存するとブラウザが気の向いた日に返す架空APIを検証する。整合性より気持ちを優先するトランザクション設計を解説する。"],
      ["view-warp", "View Transition APIを盛りすぎて画面がワープし始めた", "すべての要素へ遷移効果を付けた架空サイトが、最終的に別のページへワープした。動きすぎるUIを元へ戻すまでの記録。"],
      ["react-midnight", "React Compiler、消したはずのメモ化を夜中に戻してくる", "架空のReact Compilerが深夜だけ最適化コードを書き戻す現象を調査した。差分、月齢、ビルド時間の関係を確認する。"],
      ["soy-sauce-component", "Web Componentsで醤油差しを実装したらShadow DOMから醤油が漏れた", "架空の醤油差しコンポーネントを題材に、カプセル化の限界と食卓へのデプロイ手順を解説する。"]
    ]
  },
  {
    slug: "linux-oss",
    title: "Linux・OSS",
    items: [
      ["kernel-toaster", "Linuxカーネルにトースター用ドライバを送ったらレビューが白熱", "架空のUSBトースターをLinuxから制御するパッチを投稿した。焼き加減のABIとパンくず例外を巡るレビューをまとめる。"],
      ["sqlite-dream", "SQLiteで夢日記を管理したら寝言にSQLが混ざり始めた", "架空の夢日記データベースを毎朝更新したところ、寝言でSELECT文を話すようになった。睡眠とインデックスの関係を調べる。"],
      ["rust-compliment", "Rustコンパイラを褒めながらビルドすると3秒だけ速くなる", "架空の測定として、コンパイラへ感謝を伝えながらビルドした。褒め方、室温、キャッシュの有無による差を比較する。"],
      ["container-monday", "毎週月曜だけ前回の状態を忘れるコンテナを作った", "週明けにすべてを忘れる架空コンテナを実装した。再現性、休日明けの気分、永続ボリュームとの付き合い方を考える。"],
      ["shell-argument", "シェル履歴が過去のコマンドに説教してくる機能を追加", "危険だった過去のコマンドを検索すると、シェル履歴が当時の自分へ説教する架空機能を作った。反省文の全文検索にも対応する。"]
    ]
  }
];

const itemByPath = new Map();
for (const feed of feeds) {
  for (const [slug, title, description] of feed.items) {
    itemByPath.set(`/articles/${slug}`, { title, description, category: feed.title });
  }
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", origin);
  const feed = feeds.find((candidate) => url.pathname === `/feeds/${candidate.slug}.xml`);
  if (feed) {
    response.writeHead(200, { "content-type": "application/rss+xml; charset=utf-8" });
    response.end(renderFeed(feed));
    return;
  }
  const article = itemByPath.get(url.pathname);
  if (article) {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(renderArticle(article));
    return;
  }
  if (url.pathname === "/robots.txt") {
    response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    response.end("User-agent: *\nAllow: /\n");
    return;
  }
  response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  response.end("Not found");
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`${origin}\n`);
});

function renderFeed(feed) {
  const feedIndex = feeds.indexOf(feed);
  const items = feed.items.map(([slug, title, description], index) => `
    <item>
      <guid>${feed.slug}-${slug}</guid>
      <title>${escapeXml(title)}</title>
      <link>${origin}/articles/${slug}</link>
      <description>${escapeXml(description)}</description>
      <pubDate>${new Date(Date.UTC(2026, 6, 31, 12 - feedIndex - index, 0, 0)).toUTCString()}</pubDate>
    </item>`).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>${escapeXml(feed.title)}</title><link>${origin}</link><description>ViperReader screenshot fixture</description>${items}
</channel></rss>`;
}

function renderArticle(article) {
  return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeXml(article.title)}</title>
<style>
  :root { color: #26323d; background: #f4f7f9; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans JP", sans-serif; }
  * { box-sizing: border-box; }
  body { margin: 0; }
  .topbar { background: #152d3a; color: #fff; }
  .topbar-inner, .nav-inner, .page { width: min(1080px, calc(100% - 48px)); margin: 0 auto; }
  .topbar-inner { height: 62px; display: flex; align-items: center; gap: 30px; }
  .logo { font-size: 23px; font-weight: 850; letter-spacing: -.02em; }
  .logo-mark { display: inline-grid; width: 32px; height: 32px; margin-right: 9px; place-items: center; border-radius: 8px; background: #36c28b; color: #102b36; font-family: ui-monospace, monospace; }
  .tagline { color: #a9bec8; font-size: 12px; }
  .search { margin-left: auto; width: 210px; padding: 8px 12px; border: 1px solid #49616d; border-radius: 5px; color: #b9c9d0; font-size: 12px; }
  nav { border-bottom: 1px solid #dbe2e6; background: #fff; }
  .nav-inner { height: 40px; display: flex; align-items: center; gap: 24px; color: #53636d; font-size: 13px; font-weight: 650; }
  .nav-active { height: 40px; display: flex; align-items: center; border-bottom: 3px solid #27ad7a; color: #162d39; }
  .page { padding: 22px 0 72px; }
  .breadcrumbs { margin-bottom: 18px; color: #74838b; font-size: 12px; }
  .layout { display: grid; grid-template-columns: minmax(0, 1fr) 245px; gap: 24px; align-items: start; }
  article, .side-card { border: 1px solid #dfe5e8; border-radius: 8px; background: #fff; box-shadow: 0 1px 2px rgba(25,45,55,.04); }
  article { padding: 38px 46px 54px; }
  .category { color: #188b64; font-size: 12px; font-weight: 750; letter-spacing: .05em; }
  h1 { margin: 10px 0 18px; color: #172c38; font-size: 32px; line-height: 1.45; letter-spacing: -.025em; }
  .author { display: flex; align-items: center; gap: 10px; padding-bottom: 22px; border-bottom: 1px solid #edf0f2; color: #718089; font-size: 12px; }
  .avatar { display: grid; width: 34px; height: 34px; place-items: center; border-radius: 50%; background: linear-gradient(135deg,#2ab87f,#126c77); color: #fff; font-weight: 800; }
  .author strong { display: block; color: #344852; font-size: 13px; }
  .lead { margin: 26px 0; font-size: 16px; line-height: 1.95; }
  .tags { display: flex; gap: 7px; margin: 18px 0 4px; }
  .tag { padding: 4px 9px; border-radius: 12px; background: #edf8f4; color: #23775c; font-size: 11px; }
  h2 { margin: 38px 0 15px; padding-bottom: 9px; border-bottom: 2px solid #263e4a; color: #1d3440; font-size: 22px; }
  p { line-height: 1.9; }
  pre { overflow: hidden; margin: 20px 0; padding: 17px 19px; border-radius: 6px; background: #172a34; color: #d6e5eb; font: 13px/1.65 ui-monospace, SFMono-Regular, Consolas, monospace; }
  .comment { color: #7f9ba7; }
  .result { width: 100%; border-collapse: collapse; font-size: 13px; }
  .result th, .result td { padding: 10px 12px; border: 1px solid #dfe5e8; text-align: left; }
  .result th { background: #f2f6f7; }
  .demo-note { margin-top: 32px; padding: 14px 16px; border: 1px solid #edcf91; border-radius: 6px; background: #fff9e9; color: #66532f; font-size: 13px; line-height: 1.7; }
  aside { position: sticky; top: 16px; display: grid; gap: 14px; }
  .side-card { padding: 18px; }
  .side-title { margin-bottom: 12px; color: #1f3540; font-size: 13px; font-weight: 800; }
  .toc { display: grid; gap: 10px; padding-left: 18px; color: #536a75; font-size: 12px; }
  .profile { display: flex; align-items: center; gap: 10px; }
  .profile p { margin: 3px 0 0; color: #718089; font-size: 11px; line-height: 1.5; }
  @media (max-width: 760px) { .layout { grid-template-columns: 1fr; } aside { display: none; } article { padding: 28px; } .tagline, .search { display: none; } }
</style></head>
<body><header class="topbar"><div class="topbar-inner"><div class="logo"><span class="logo-mark">&gt;_</span>DevScope</div><span class="tagline">現場で試してわかった技術の話</span><div class="search">記事を検索　⌘ K</div></div></header>
<nav><div class="nav-inner"><span class="nav-active">トップ</span><span>開発</span><span>AI・機械学習</span><span>インフラ</span><span>レビュー</span></div></nav>
<main class="page"><div class="breadcrumbs">トップ › ${escapeXml(article.category)} › 検証レポート</div><div class="layout"><article>
<div class="category">${escapeXml(article.category)}　/　検証レポート</div><h1>${escapeXml(article.title)}</h1>
<div class="author"><span class="avatar">架</span><span><strong>架空技術検証班</strong>2026年7月31日 公開　·　読了 6分</span></div>
<div class="tags"><span class="tag"># ${escapeXml(article.category)}</span><span class="tag"># 開発環境</span><span class="tag"># 検証してみた</span></div>
<p class="lead">${escapeXml(article.description)}</p>
<h2>検証の準備</h2><p>今回は同じリポジトリを複製し、通常環境と実験環境を用意した。キャッシュの影響を避けるため、各試行の前に作業ディレクトリを初期状態へ戻している。</p>
<pre><span class="comment"># 実験用の架空コマンド</span>\n$ fiction-lab run --profile=demo --repeat=10\n✓ experiment completed  (10 / 10)</pre>
<h2>結果</h2><p>それぞれ10回ずつ実行し、レビューが完了するまでの時間と指摘件数を記録した。</p>
<table class="result"><thead><tr><th>条件</th><th>平均時間</th><th>完了率</th></tr></thead><tbody><tr><td>通常環境</td><td>42秒</td><td>90%</td></tr><tr><td>実験環境</td><td>39秒</td><td>100%</td></tr></tbody></table>
<h2>まとめ</h2><p>便利そうに見える仕組みほど、失敗時の振る舞いを先に決めておく必要がある。導入する場合は小さな範囲から試し、既存の手順へ戻せるようにしておくのがよさそうだ。</p>
<div class="demo-note"><strong>この記事は撮影用のフィクションです</strong><br>ViperReaderのスクリーンショット専用に作成した架空の記事です。製品、人物、組織、コマンド、測定値は実在しません。</div>
</article><aside><section class="side-card"><div class="side-title">この記事の目次</div><ol class="toc"><li>検証の準備</li><li>結果</li><li>まとめ</li></ol></section><section class="side-card"><div class="profile"><span class="avatar">架</span><div><strong>架空技術検証班</strong><p>存在しない技術を安全に検証する架空の編集チーム。</p></div></div></section></aside></div></main></body></html>`;
}

function escapeXml(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}
