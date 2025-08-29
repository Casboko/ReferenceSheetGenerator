# API仕様（MVP）

- 目的: フロント/バック間の契約（入出力/制約/エラー）を明確化する。
- 想定読者: フロント/バック実装者、QA。

## 共通
- ベースURL: 同一オリジン
- 認証: なし（内部利用前提）
- 速度制御: 429時にバックエンドで指数バックオフ＋フロントへエラー戻し
- 制約: 入力画像は最大3枚/各7MB以下、Files URI参照。`candidateCount` はサーバ側で 1 に固定（リクエスト値は無視）。

## モデル（データ構造）
- `Asset`:
  - `id: string`（サーバ生成の一意ID）
  - `name: string`（ファイル名）
  - `fileUri: string`（Files APIの参照URI）
  - `mime: 'image/jpeg' | 'image/png' | 'image/webp'`
  - `size: number`（bytes）
- `GeneratedImage`:
  - `id: string`
  - `dataUrl: string`（`data:image/*;base64,...`）
  - `fileUri: string`（Files APIに登録した出力のURI）
  - `mime: string`（モデル応答準拠：主にimage/webp or image/jpeg）
  - `width?: number`（取得できる場合のみ）
  - `height?: number`（取得できる場合のみ）
- `ErrorResponse`:
  - `error.code: string`（例: `INVALID_MIME`/`SIZE_TOO_LARGE`/`TOO_MANY_REFERENCES`/`RATE_LIMITED`/`SAFETY_BLOCKED`/`EXTERNAL_ERROR`/`VALIDATION_ERROR`）
  - `error.message: string`（日本語のUI表示用メッセージ）
  - `error.details?: object`（任意の補足）

## ヘッダ / コンテンツタイプ
- `POST /api/upload`: `Content-Type: multipart/form-data`
- `POST /api/generate`: `Content-Type: application/json`
- サーバは必要に応じて `Retry-After` を返す（429/503）

## POST /api/upload
- 概要: 画像ファイルを受け取り、Files APIへ登録してURIを返す。
- 入力: `multipart/form-data`
  - フィールド: `file`（単一ファイル。複数は非対応/MVP）
- 出力: `200 OK`
```json
{
  "asset": {
    "id": "string",
    "name": "string",
    "fileUri": "string", 
    "mime": "image/png",
    "size": 123456
  }
}
```
- エラー:
  - `400` 形式不正（MIME は image/jpeg・image/png・image/webp のみ）
  - `413` サイズ超過（各7MB上限）
  - `502/503` 外部API失敗（再試行ヒント含む）

検証ルール（サーバ側必須）
- MIMEホワイトリスト: image/jpeg・image/png・image/webp
- サイズ: 7MB/枚 以下（超過は 413）

例（curl）
```
curl -X POST http://localhost:5173/api/upload \
  -F "file=@./example.png"
```

## POST /api/generate
- 概要: 指示テキストと参照画像URI群から画像を1枚生成。
- 入力: `application/json`
```json
{
  "prompt": "string",
  "fileUris": ["string", "string", "string"],
  "note": "fileUris は 0〜3 件。4 件以上は 400。",
  "options": {
    "temperature": 0.4,
    "candidateCount": 1
  }
}
```
- 出力: `200 OK`
```json
{
  "images": [
    {
      "id": "string",
      "dataUrl": "data:image/webp;base64,....",
      "fileUri": "string",
      "mime": "image/webp",
      "width": 1024,
      "height": 1024
    }
  ],
  "text": "optional: model text output"
}
```
- エラー:
  - `400` 入力不足/枚数超過（fileUris > 3）
  - `413` 画像サイズ超過
  - `429` レート制限（フロントは再試行UI）
  - `5xx` 外部API失敗

検証ルール（サーバ側必須）
- `fileUris.length` は 0〜3（4件以上は 400）
- `candidateCount` はサーバ側で 1 に固定（リクエスト値は無視）
- Safety 情報が閾値超過の場合、`SAFETY_BLOCKED` 等のエラーとして返し、UIへ伝播（文言は error-handling に準拠）

例（curl）
```
curl -X POST http://localhost:5173/api/generate \
  -H 'Content-Type: application/json' \
  -d '{
    "prompt": "正面向きの上半身を明るい背景で",
    "fileUris": ["files://...A", "files://...B"],
    "options": {"temperature": 0.4}
  }'
```

## ステータスコード一覧（抜粋）
- 200 OK: 正常
- 400 Bad Request: 入力不足/形式不正/参照枚数超過
- 413 Payload Too Large: 画像サイズ超過
- 429 Too Many Requests: レート制限（`Retry-After` 付与可）
- 5xx: 外部API失敗/一時障害

## 備考（サーバ固定値/運用）
- `candidateCount` はサーバ側で 1 に固定（将来拡張時はバージョン分岐）。
- Safety 情報は error-handling の方針に従い UI へ最小限の情報で伝達。

## エラー形式（共通）
```json
{
  "error": {
    "code": "RATE_LIMITED",
    "message": "少し待ってから再実行してください"
  }
}
```

## 完成定義（DoD）
- モックサーバで入出力が再現できる
- 実装が本仕様のみで整合を保てる

## 更新トリガー
- パラメータ/エンドポイント/制約に変更が入るとき

---
関連: `./gemini-integration.md`, `./error-handling.md`, `./state-model.md`
