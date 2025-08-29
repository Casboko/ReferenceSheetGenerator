# アーキテクチャ概要 / 方針

- 目的: ステートレス方針と外部制約に基づき、構成/責務/データ流を明確化する。
- 想定読者: PM/開発/デザイン/運用。

## 全体構成（テキスト図）
- Frontend (React + Vite)
  - 参照スロットUI / アップロード / 生成操作
  - Dev: Vite 5173 → `/api` を Express 8787 へプロキシ
- Backend (Node 22 + Express)
  - `POST /api/upload`: 受信 → Files API 登録 → fileUri 返却
  - `POST /api/generate`: 受信（prompt, references[{uri,mime}]）→ Gemini 呼び出し → 画像バイト取得 → Files へ出力登録 → 画像データ + fileUri 返却
- External
  - Gemini 2.5 Flash Image Preview（画像入出力）
  - Gemini Files API（48h 保存 / 20GB / 2GB/ファイル）

```
Browser (Vite:5173)
  ├─ POST /api/upload   ─proxy→  Express:8787  ─→  Files API   ─→ fileUri
  └─ POST /api/generate ─proxy→  Express:8787  ─→  Gemini      ─→ image bytes
                                           └─→  Files(output) ─→ fileUri
  ←──────────── image data (blob/dataURL) + fileUri ───────────────
```

## ステートレス設計の根拠
- モデル側の暗黙履歴を持ち越さず、毎ターンの入力をUIで明示選択。
- 冪等性/再実行容易性/デバッグ性を向上。

## コンポーネント境界
- フロント: UI/入力検証/最小の整形のみ。
- バック: 認証/鍵秘匿/Files登録/モデル呼び出し/再試行。

## データフロー（概要）
1. アップロード: フロント → `POST /api/upload` →（Express: Multer メモリ受信）→ Files API 登録 → `fileUri` 受領 → フロントへ返却 → スロットへ割当。
2. 生成: フロントは `prompt` と使用中の `references`（`{ uri: 'files/<id>', mime: 'image/*' }` の配列, 0〜3）を `POST /api/generate` へ送信（candidateCount=1）。
3. 生成結果: Backend が Gemini を呼び出し、画像（1枚）バイトを取得。直後に Files へ出力も登録し、その `fileUri` と画像データをフロントへ返却。
4. 表示/参照: フロントは最新出力を表示し、トグルON時は次ターンの参照に `lastOutput.fileUri` を使用（ステートレス）。トグルOFF時の自動復元は行わない（PRD準拠）。

## 入力/検証（MVP）
- `/api/upload` は MIME を `image/jpeg`・`image/png`・`image/webp` のみ許可し、サイズは 7MB/枚以下を強制する。違反時は `400`（種類）/`413`（サイズ）を返す。
- `/api/generate` は `references.length ≤ 3` を必須とし、超過時は `400` を返す。各参照は `{ uri: 'files/<id>', mime: 'image/*' }`。`candidateCount` はサーバ側で 1 に固定し、リクエスト値があっても無視/丸める。

## MIME 解決方針（MVP）
- 低レイテンシのため、クライアントが `references[{ uri, mime }]` として MIME を併せて送る（Files メタ取得は行わない）。将来、厳密性が必要になればサーバ側で Files メタデータ照会に切替可能。

- 429: 指数バックオフ（例: 1s→2s→4s, 最大3回, ジッター推奨）→ 失敗時はユーザ通知。UIは同時実行1件に直列化（生成中はボタン非活性）。レート制限の上限値は Tier/時期で変動するため数値を仕様に固定しない。
- 安全ブロック: 日本語メッセージ表示と再プロンプト誘導。モデル応答の Safety 情報が閾値超過の場合はブロック/警告を返し、UIへ伝播（詳細は error-handling を参照）。
- 400/413: 枚数/サイズ/形式不正はサーバでバリデーションしエラー返却。フロントは事前検証で抑止。

## 代替案（チャット方式）
- 長所: 過去文脈を活かした創作が可能。
- 短所: 暗黙依存/再現困難/モデル挙動の不確実性。
- 結論: MVPはステートレスを採用（詳細は ADR 参照）。

## 採用技術
- React 19 / Vite 6 / TypeScript
- Node 22 / Express / Multer (memoryStorage) / @google/genai SDK

## 開発/本番運用
- 開発: Vite(5173) と Express(8787) を並走、`/api` は Vite のプロキシで Express へ。
- 本番: Express が `dist/` を静的配信しつつ API を提供（単一オリジン）。
- 代替（将来）: 静的ホスティング + 別ホストAPI の場合は CORS 設定を追加。
 - 公開運用へ移行する場合、認証（例: OIDC/OAuth）と厳格な CORS/Rate Limit 政策を導入（MVP外）。
 - 生成画像には AI 透かし（SynthID）が含まれる旨を UI に告知（文言は PRD/UX 側で定義）。ダウンロード方針は PRD の「ダウンロードUX方針」に準拠。

## 実装詳細（MVP）
- Upload: Multer のメモリストレージで受け取り、ディスクを経由せずに Files へ登録（<=7MB/枚）。
- Generate: `responseModalities=['TEXT','IMAGE']`, `candidateCount=1`（サーバ側で固定）。出力画像は毎回 Files に登録して `fileUri` を返却。UI表示は受領した画像バイトを使用。Safety 情報はエラーフローに従い UI へ伝播。
- 画像変換: サーバ側変換なし。UI側で正方形プレビュー（必要に応じパディング/クロップ）。
- ブラウザ: 最新 Chrome を主サポート（Evergreen）。

## 完成定義（DoD）
- 実装者が層/責務/データの所在で迷わない。
- API仕様/UI仕様/運用要件と整合。
 - サーバ側の入力/出力バリデーション（MIME・サイズ・枚数・candidateCount固定）が実装済み。

## 更新トリガー
- 主要依存や構成の変更、Files/Gemini仕様更新時。

---
関連: `./adr/0001-stateless-vs-chat.md`, `./api-spec.md`, `./gemini-integration.md`
