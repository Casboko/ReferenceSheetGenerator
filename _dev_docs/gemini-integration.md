# Gemini / Files API 連携仕様（MVP）

- 目的: モデル/Filesの制約・呼び出し方・安全性/コストを集約。
- 想定読者: 実装/運用。

## モデル
- ID: `gemini-2.5-flash-image-preview`
- 応答モダリティ: `responseModalities=["TEXT","IMAGE"]`（画像出力時は必須）
- 入力上限: 画像最大3枚、各7MB以下
- 出力上限: 画像最大10枚/リクエスト（MVPは1枚）
- 候補数: `candidateCount` 既定1（MVPは1固定）

## Files API
- 容量: プロジェクト最大20GB / 1ファイル最大2GB
- 保持期間: 48時間（ダウンロード不可、参照のみ）
- 利用: 画像はFilesへアップロードし、返却される `file.uri`（例: `files/abc123`）をモデル入力に渡す

## レート/コスト（目安）
- レート: プレビュー版の上限を想定（詳細は公式に準拠）
- コスト: 出力トークンベース、画像1枚あたりの目安あり

## 安全 / SynthID
- 生成/編集画像には不可視透かし（SynthID）が付与
- 安全フィルタで不適切内容はブロックされ得る

## 呼び出し（擬似コード / TypeScript）
```ts
import { GoogleGenerativeAI } from '@google/genai';

const genai = new GoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY! });
const model = genai.getGenerativeModel({ model: 'gemini-2.5-flash-image-preview' });

// references: { uri: 'files/<id>', mime: 'image/png' | 'image/jpeg' | 'image/webp' }[]
const parts = references.map(({ uri, mime }) => createPartFromUri(uri, mime));
const res = await model.generateContent({
  contents: [{ role: 'user', parts: [ { text: prompt }, ...parts ] }],
  responseModalities: ['TEXT','IMAGE'],
  generationConfig: { temperature: 0.4, candidateCount: 1 }, // MVPはサーバ側固定
});
```

## 完成定義（DoD）
- 実装が追加調査なしに正しく呼び出せる
- api-spec / performance-ops と整合

## 更新トリガー
- モデル仕様/料金/SDK更新時

---
関連: `./api-spec.md`, `./performance-ops.md`, `./security-config.md`
