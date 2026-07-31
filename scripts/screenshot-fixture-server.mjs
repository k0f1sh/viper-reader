import { createServer } from "node:http";

const port = Number(process.argv[2] ?? 48765);
const origin = `http://127.0.0.1:${port}`;

const feeds = [
  {
    slug: "ai-dev",
    title: "AI・開発",
    items: [
      ["context-cache", "LLMのコンテキストキャッシュAPI、推論コストを最大60%削減", "長い共通プロンプトをキャッシュし、繰り返し呼び出しのレイテンシと料金を抑えるAPIが公開された。キャッシュの有効期限、無効化、対象モデル、料金計算の注意点を検証する。"],
      ["stacked-pr", "GitHubにスタックプルリクエストが登場、gh stackでPRを分割して積み上げよう", "大きな変更を依存関係のある小さなPRへ分割し、順番にレビューできる新しいワークフローを試す。CLIでの作成、更新、マージまでを紹介する。"],
      ["local-agent", "ローカル実行対応の小型AIエージェントを自作してみた", "ローカルLLMとツール呼び出しを組み合わせ、ファイルを外部へ送らずに動く小型エージェントを実装した。権限制御と失敗時の復旧も扱う。"],
      ["prompt-eval", "プロンプト評価を雰囲気からテストケース管理へ移行した話", "生成品質を目視だけで判断せず、代表入力、期待する性質、回帰判定をコードで管理するまでの設計と運用をまとめる。"],
      ["tokenizer", "日本語向け新トークナイザー、コード混じりの記事で効率が18%改善", "日本語とソースコードが混在する文章を対象に、従来方式とのトークン数、処理時間、検索精度を比較した結果を紹介する。"]
    ]
  },
  {
    slug: "web-ui",
    title: "Webフロントエンド",
    items: [
      ["css-masonry", "CSSだけでmasonry配置できる時代、ついに来る", "JavaScriptで高さを測らず、CSSだけで可変高カードを石組み状に並べる新しいレイアウト機能を試す。フォールバックとアクセシビリティも確認する。"],
      ["browser-db", "ブラウザに新しいKey-Value Storage APIが試験実装", "小さなデータを非同期で保存するブラウザAPIの試験実装が公開された。IndexedDBとの違い、容量、トランザクション、利用場面を整理する。"],
      ["view-transition", "View Transition APIで画面遷移をぬるぬるにしてみた", "一覧から詳細への遷移を少ないCSSで滑らかにする。動きを減らす設定への対応や、大きなDOMでの性能も検証した。"],
      ["react-compiler", "React Compilerを実プロジェクトへ入れたら手書きメモ化が消えた", "段階導入で発生した互換性問題と、削除できた最適化コード、ビルド時間、実行性能の変化を計測する。"],
      ["web-components", "Web Componentsを10年使える社内UI部品にする", "フレームワークをまたいで利用できるUI部品の設計、テーマ、フォーム連携、配布、破壊的変更を避ける方法をまとめる。"]
    ]
  },
  {
    slug: "linux-oss",
    title: "Linux・OSS",
    items: [
      ["sqlite-vector", "SQLiteにベクトル検索を生やす軽量拡張が登場", "単一ファイルDBのまま埋め込みベクトルを保存し、近傍検索できる拡張を試す。インデックス構築時間、検索速度、メモリ使用量を測定する。"],
      ["terminal-ui", "ターミナルUI用の新ライブラリ、1.0で正式リリース", "表、入力フォーム、差分描画を備えたライブラリが安定版になった。小さな監視ツールを作り、描画性能とAPIの使いやすさを確認する。"],
      ["rust-build", "Rustコンパイラのビルドが謎に遅いので可視化して直した", "ビルド時間を段階ごとに計測し、依存関係、リンク、コード生成のボトルネックを特定する。設定変更後の改善幅も示す。"],
      ["container-snapshot", "コンテナ起動を爆速にする差分スナップショット実験", "初期化済みプロセスの状態を保存し、復元して起動時間を短縮する。ファイル記述子やネットワーク接続の扱いと制約を検証する。"],
      ["shell-history", "シェル履歴をSQLiteで管理したら検索が快適になった", "複数端末のコマンド履歴をSQLiteへ集約し、作業ディレクトリや終了コードを含めて全文検索できる小さなツールを作った。"]
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
