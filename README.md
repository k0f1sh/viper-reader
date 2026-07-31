# ViperReader

技術系RSSを、2000年代後半の匿名掲示板風スレッドに変換する、個人用のElectron RSSリーダーです。

記事の要点はAI住民のレスで把握。気になったことを書き込めば、あの頃のノリとヌクモリティで技術的に答えてくれます。

![ViperReaderのスクリーンショット](./screenshot/viper-reader-v1.png)

※ スクリーンショットの記事・RSSは撮影用の架空データです。

## 主な機能

- RSS記事のタイトルや概要をもとに、思わず開きたくなる掲示板風のスレタイへ変換
- 元記事をブラウザで開かなくても内容を追える、情報量のある掲示板風の要約レスを生成
- 記事への書き込みや技術的な質問に、ヌクモリティあふれるAI住民が正確かつ分かりやすく回答
- 未読、生成済み・未確認、確認済みを巡回できる、情報密度の高い3ペインUI
- レス生成を待たずに別の記事を読めるバックグラウンド生成
- 続きのレス生成、スレタイ・レスの再生成、レス・IDポップアップ
- 板ごとの住民設定と、レス評価をもとにした会話改善
- お気に入り、既読管理、キーボード操作、API・RSS統計、生成失敗履歴
- アプリ内で元記事を閲覧できる内蔵ブラウザ
- 記事、生成結果、閲覧状態、設定をSQLiteへ保存

## 技術スタック

- Electron / TypeScript / React / Vite
- Gemini API (`@google/genai`)
- SQLite / `rss-parser` / `cheerio`

## 開発

Node.js 22以上を使用します。

```bash
npm install
npm run dev:app
```

Gemini APIキーは、起動後に「設定」から登録できます。環境変数 `GEMINI_API_KEY` または `GOOGLE_API_KEY` も利用できます。

```bash
npm test          # テスト
npm run typecheck # 型チェック
npm run build     # ビルド
```

Linuxでは次のコマンドでユーザー領域へインストールできます。

```bash
npm run install:local
viper-reader
```

## 注意事項

- アプリ内データとキャッシュはローカルのSQLiteへ保存します。
- APIキーはmacOS・WindowsではElectronの `safeStorage` で暗号化します。LinuxではSQLiteへ平文保存するため、共有端末では環境変数を利用してください。
- 記事本文の取得前にキャッシュを確認し、`robots.txt` による制限を尊重します。
- Geminiを利用する処理では、記事タイトル・本文・要約、スレッド履歴、ユーザーの書き込み、住民プロンプト、評価対象の生成レスがGoogleのGemini APIへ送信される場合があります。機密情報や個人情報を含む記事・書き込みには使用しないでください。
- Gemini APIに送信されたデータの取り扱いは、利用するサービスや契約によって異なります。[Gemini APIの利用規約](https://ai.google.dev/gemini-api/terms)と[不正利用監視に関する説明](https://ai.google.dev/gemini-api/docs/usage-policies)を確認してください。APIの利用料金・割り当ては、ユーザー自身のGoogleアカウントとAPIキーに適用されます。
- AIが生成する要約や技術解説には誤りが含まれる可能性があります。重要な判断では、元記事や製品の公式資料を確認してください。
- 本アプリは個人利用を想定した非公式のパロディツールです。特定の掲示板、まとめサイト、および関連サービスとは関係ありません。

## License

[MIT](./LICENSE)
