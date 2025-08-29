# 開発/デプロイ運用手順（MVP）

- 目的: ローカル～プレビューまでの手順とロールバック方針を統一。
- 想定読者: 全職能。

## 前提
- Node 22（`.nvmrc` 準拠）
- `.env.local` に `GEMINI_API_KEY`

## ローカル
- `npm install`
- `npm run dev` → `http://localhost:5173`

## ビルド/プレビュー
- `npm run build`
- `npm run preview`

## 既知の落とし穴
- フロントから鍵を参照しない（security-config参照）
- 画像サイズ超過（7MB）

## リリース/ロールバック（例）
- タグ発行→プレビュー確認→本番反映
- 問題時は直前タグへ戻す

## トラブルシュート早見表
- 429: 数秒待って再実行、候補数は1のまま
- 画像表示不可: MIME/データURL確認

## 完成定義（DoD）
- 新メンバーでも手順通りに再現可能

## 更新トリガー
- パイプライン/コマンドの変更

---
関連: `./security-config.md`, `./performance-ops.md`

