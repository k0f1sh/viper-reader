# ViperReader

ViperReader は、手動で登録した技術系 RSS フィードを、2010年代前半の 2ch ニュー速VIP板およびまとめブログ風の文体と UI に変換して閲覧する、個人用 Electron デスクトップアプリです。

真面目な最新技術情報を、エンタメ感覚で日々ブラウズし、自発的な技術インプットを促進することを目的としています。

![ViperReaderのスクリーンショット](./screenshot/viper-reader-v1.png)

---

## 主な機能

- スレタイ・レスの VIP 風自動変換
- AI住民との対話（書き込み）と続きのレス生成
- レスプレビューポップアップ
- スレッドのお気に入り（ブックマーク）登録
- 板（フィード）ごとの住民設定（カスタムプロンプト）
- レス生成 AI モデル（3.5 flash / 3.1 flash lite）切り替え
- SQLite キャッシュによるデータローカル保存
- robots.txt 判定によるアクセス制限

---

## 技術スタック

- Electron, TypeScript
- React, CSS, Vite
- @google/genai (gemini-3.1-flash-lite, gemini-3.5-flash)
- SQLite
- rss-parser, cheerio

---

## セットアップ & 起動方法

### 前提条件
- Node.js (v22 以上推奨)

### 1. パッケージのインストール
```bash
npm install
```

### 2. 環境変数の設定
ルートディレクトリに `.env` ファイルを作成し、Gemini API キーを設定します。
```env
GEMINI_API_KEY=your_gemini_api_key_here
```

### 3. 開発モードでの起動
```bash
npm run dev:app
```

### 4. ビルド
```bash
npm run build
```

---

## 免責事項
本アプリは個人利用専用の情報収集パロディツールです。Web サイト運営者に負荷をかけないよう、キャッシュ機能および robots.txt 判定を備えています。
