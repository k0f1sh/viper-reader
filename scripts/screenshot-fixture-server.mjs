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
    itemByPath.set(`/articles/${slug}`, { title, description });
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
    response.end(`<!doctype html><html lang="ja"><head><title>${escapeXml(article.title)}</title></head><body><main><h1>${escapeXml(article.title)}</h1><p>${escapeXml(article.description)}</p><h2>検証内容</h2><p>これはViperReaderのスクリーンショット作成専用に用意した架空の記事です。記載された製品や数値はデモ用であり、実在の発表を示すものではありません。</p></main></body></html>`);
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

function escapeXml(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}
