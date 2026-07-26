# ViperReader

技術系 RSS を、平成のネット文化を彩った2chニュー速VIP板・まとめブログ風の文体とUIで楽しむ、個人用のElectron RSSリーダーです。

元記事を開かなくても内容をしっかり把握できる情報量と、スレを眺める楽しさを両立。さらに、記事を読んで気になったことを書き込めば、優秀なエンジニアであるAI住民たちが、あの頃のニュー速VIPを思わせるノリとヌクモリティで分かりやすく答えてくれます。真面目な技術情報を、ネットのジャンクフードのような感覚で味わえる体験を目指しています。

![ViperReaderのスクリーンショット](./screenshot/viper-reader-v1.png)

## 主な機能

- RSS記事タイトルをVIP風のスレタイへ変換
- 元記事なしでも内容を追える、情報量のあるVIP風要約レスを生成
- 記事の深掘りや技術的な質問に、AI住民が正確かつ分かりやすく回答
- ニュー速VIPを思わせる掛け合いと、質問者を置いていかないヌクモリティあるレス生成
- レス・IDポップアップ、お気に入り、キーボード操作
- アプリ内で元記事を閲覧できる内蔵ブラウザ
- RSS、記事本文、生成結果をSQLiteへキャッシュ

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
- 本アプリは個人利用を想定した非公式のパロディツールです。2ちゃんねる、5ちゃんねる、および関連サービスの運営者とは関係ありません。

## License

[MIT](./LICENSE)
