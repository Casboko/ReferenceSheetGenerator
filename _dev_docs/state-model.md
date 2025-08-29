# データ/状態モデル（MVP）

- 目的: アプリ内の主要エンティティ/状態/不変条件/更新規則を定義。
- 想定読者: 実装/QA。

## エンティティ
- Asset: { id, name, fileUri, mime, size, previewUrl? }
- AppState: { assets: Asset[], slots: (id|null)[], lastOutputId: string|null, useLastOutput: boolean, promptText: string, isGenerating: boolean }

## 型（擬似TypeScript）
```ts
type AssetId = string;
interface Asset { id: AssetId; name: string; fileUri: string; mime: string; size: number; previewUrl?: string }
interface AppState {
  assets: Asset[];
  slots: [AssetId|null, AssetId|null, AssetId|null];
  lastOutputId: AssetId | null;
  useLastOutput: boolean;
  promptText: string;
  isGenerating: boolean;
}
```

## 不変条件
- slots 内の id は assets に存在する
- 重複割当は許容（MVP）だが、UIで重複表示は避ける

## 主要イベント/更新規則
- uploadSuccess(asset): assets へ追加、空きスロットに割当
- setSlot(index,id|null)
- toggleUseLastOutput(bool)
- generateStart/Success/Failure
- resetSession()

## 永続/揮発
- 永続: なし（MVP）。将来はセッション保存を検討
- 揮発: 上記AppStateはメモリのみ

## 完成定義（DoD）
- 実装が安全に状態更新を書ける
- ui-ux-spec / api-spec と整合

## 更新トリガー
- 型や状態遷移の変更

---
関連: `./ui-ux-spec.md`, `./api-spec.md`, `./mvp-prd.md`

