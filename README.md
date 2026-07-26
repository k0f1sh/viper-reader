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
- 本アプリは個人利用を想定したパロディツールです。

## License

[MIT](./LICENSE)
