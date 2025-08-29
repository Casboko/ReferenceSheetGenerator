# API仕様（MVP）

- 目的: フロント/バック間の契約（入出力/制約/エラー）を明確化する。
- 想定読者: フロント/バック実装者、QA。

## 共通
- ベースURL: 同一オリジン
- 認証: なし（内部利用前提）
- 速度制御: 429時にバックエンドで指数バックオフ＋フロントへエラー戻し
- 制約: 入力画像は最大3枚/各7MB以下、Files URI参照。`candidateCount` はサーバ側で 1 に固定（リクエスト値は無視）。

## POST /api/upload
- 概要: 画像ファイルを受け取り、Files APIへ登録してURIを返す。
- 入力: `multipart/form-data` or `application/octet-stream`
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

## 備考（サーバ側固定）
- `candidateCount` はサーバ側で 1 に固定（将来拡張を見据えつつ、MVPでは固定）。
- Safety 情報が閾値超過の場合、UIへブロック/警告を伝達（文言は error-handling に準拠）。

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
