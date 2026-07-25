# ViperReader

技術系 RSS を、2000年代後半の 2ch ニュー速VIP板・まとめブログ風の文体とUIで楽しむ、個人用のElectron RSSリーダーです。真面目な技術情報を、ネットのジャンクフードのような感覚で読める体験を目指しています。

![ViperReaderのスクリーンショット](./screenshot/viper-reader-v1.png)

## 主な機能

- RSS記事タイトルをVIP風のスレタイへ変換
- 記事本文をもとに、技術的な要点を保ったVIP風レスを生成
- AI住民への書き込みと、続きのレス生成
- レス・IDポップアップ、お気に入り、キーボード操作
- 広告・追跡通信を遮断できる内蔵記事ブラウザ
- RSS、記事本文、生成結果をSQLiteへキャッシュ

## 技術スタック

- Electron / TypeScript / React / Vite
- Gemini API (`@google/genai`)
- SQLite / `rss-parser` / `cheerio`
- `@ghostery/adblocker-electron`

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

## 広告フィルター

元記事ブラウザでは、以下のソフトウェアとフィルターリストを利用します。フィルターは初回利用時に取得し、ローカルへキャッシュします。

- [@ghostery/adblocker-electron](https://github.com/ghostery/adblocker) — MPL-2.0
- [EasyList / EasyPrivacy](https://easylist.to/) — GPL または CC BY-SA
- [AdGuard Japanese filter](https://github.com/AdguardTeam/AdguardFilters) — GPL-3.0

## License

[MIT](./LICENSE)
