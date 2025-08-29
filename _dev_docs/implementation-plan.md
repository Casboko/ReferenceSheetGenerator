# Gemini 2.5 Flash Image Previewを用いた参照画像UIの実装計画

## エグゼクティブサマリ

Gemini 2.5 Flash Image Previewモデルを活用し、最大3枚の参照画像と直前の出力画像を組み合わせて**対話的に画像生成・編集**できるWebアプリ構築計画です。既存の「ReferenceSheetGenerator」リポジトリを監査した結果、フロントエンド（React+Vite）でGemini APIを直接呼び出す実装となっており、一部コード（画像のBase64埋込送信など）は今回の要件に合わせて改修が必要です。MVPでは**ステートレスなリクエスト構成**を採用し、ユーザが毎ターン送信する画像をUIで明示選択することで、モデルへの暗黙の履歴持ち越しを防ぎます。また、GoogleのFiles APIに画像をアップロードし、リクエストでは参照URIを使用することで大容量画像の送受を最適化します。UIには3つの参照スロットと「直前出力を参照」トグルを設け、各ターンごとに使用画像を明示的にコントロール可能にします。初期実装では既存コードに対し最小限の変更で動作確認可能なMVPを目指し、その後セキュリティ（APIキー秘匿等）とスケーラビリティ（レート制限対策、ログ・監視）を強化します。**初手の一手**として、まずモデルおよびFiles APIの公式仕様を一次情報から再確認し（**最大入力3画像・出力10画像、7MB/画像上限、Filesはプロジェクト20GB/ファイル2GB/保存48時間**[\[1\]](https://cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/2-5-flash#:~:text=Images%20photo)[\[2\]](https://ai.google.dev/gemini-api/docs/files#:~:text=Usage%20info)）、これに沿ってシステム全体のアーキテクチャを設計します。

## 1. 仕様確認（一次情報）

- **モデル選定と機能**: 本アプリはGoogleの**Gemini 2.5 Flash Image Preview**モデル（モデルID: `gemini-2.5-flash-image-preview`）を使用します[\[3\]](https://cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/2-5-flash#:~:text=Note%3A%20To%20use%20the%20,Supported%20inputs%20%26%20outputs)[\[4\]](https://cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/2-5-flash#:~:text=Input%20size%20limit%20500%20MB,Technical%20specifications%20Images%20photo)。従来の`gemini-2.5-flash`モデルではテキスト応答のみで画像生成は非対応であり[\[5\]](https://cloud.google.com/vertex-ai/generative-ai/docs/multimodal/image-generation#:~:text=Gemini%202,modalities%2C%20including%20text%20and%20images)、本モデルで初めて**テキストと画像の両出力**が可能です。画像生成API呼び出し時には、**必ず出力モダリティとして**`IMAGE`**を指定**する必要があります（テキストのみ・画像のみの出力指定は不可）[\[6\]](https://cloud.google.com/vertex-ai/generative-ai/docs/multimodal/image-generation#:~:text=%7D%27%202)。したがって当アプリでは、画像を出力するリクエストでは毎回`responseModalities: ["TEXT","IMAGE"]`を指定します[\[6\]](https://cloud.google.com/vertex-ai/generative-ai/docs/multimodal/image-generation#:~:text=%7D%27%202)。
- **入力/出力制約**: Gemini 2.5 Flash Image Previewでは**1リクエストあたり最大3枚の入力画像**を添付可能で、各画像は**7MB以下**である必要があります[\[1\]](https://cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/2-5-flash#:~:text=Images%20photo)。また**出力画像は1リクエスト最大10枚まで**生成可能です[\[7\]](https://cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/2-5-flash#:~:text=,image%2Fwebp)。この「最大10枚」はモデルが**一度の応答内で複数画像を返す**場合の上限であり、Geminiへの指示によって複数のシーン画像やバリエーションを一度に生成させることができます（例：手順付きレシピの各ステップに画像を含めるなど）[\[8\]](https://cloud.google.com/vertex-ai/generative-ai/docs/multimodal/image-generation#:~:text=generate%20long%20form%20text,interleaved)[\[9\]](https://cloud.google.com/vertex-ai/generative-ai/docs/multimodal/image-generation#:~:text=%2A%20Example%20prompt%3A%20,interleaved)。デフォルトでは候補画像数（candidateCount）は1ですが、最大8まで増やして**複数候補を取得**することも可能です[\[10\]](https://cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/2-5-flash#:~:text=%2A%20Temperature%3A%200.0,default%201)。出力画像の寸法は基本1024px程度の正方形または指定比率で、全画像には透かし（SynthID）も自動付与されます[\[11\]](https://developers.googleblog.com/en/introducing-gemini-2-5-flash-image/#:~:text=All%20images%20created%20or%20edited,generated%20or%20edited)。
- **Files APIによる画像管理**: Gemini APIのFiles機能により、**プロジェクト当たり最大20GB**までファイルをアップロードして保持可能で、**1ファイル最大2GB**です[\[2\]](https://ai.google.dev/gemini-api/docs/files#:~:text=Usage%20info)。アップロードしたファイルは**48時間**保存され、この間API経由でメタデータ参照やモデル入力への利用はできますが**ダウンロードは不可**となっています[\[2\]](https://ai.google.dev/gemini-api/docs/files#:~:text=Usage%20info)（ファイル自体の取得は提供されない仕様）。Files APIの利用自体には料金はかからず、Gemini API提供リージョン全てで使用可能です[\[12\]](https://ai.google.dev/gemini-api/docs/files#:~:text=You%20can%20use%20the%20Files,the%20Gemini%20API%20is%20available)。**モデルへの画像入力は、Base64等で直接インライン埋め込みする方法と、Files APIにアップして得たURIを参照する方法の2通り**があります。大容量データの場合は後者が推奨されます（リクエスト全体サイズ上限500MB[\[4\]](https://cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/2-5-flash#:~:text=Input%20size%20limit%20500%20MB,Technical%20specifications%20Images%20photo)ですが、実運用では20MB程度に抑えるのが望ましいとの指針あり）。当アプリでは**原則としてFiles API経由のURI参照**を採用し、ユーザがアップロードした画像や前段で生成された画像をいったんファイル保存してURIを取得し、それをモデル入力に渡します。これによりネットワーク負荷を軽減し、大きな画像でも安全に扱えます。
- **API利用料金とレート制限**: Gemini 2.5 Flash Image Previewの料金は**出力トークン100万あたり30ドル**で、**画像1枚の生成は約1290トークン（約\\0.039）**と公表されています[\[13\]](https://developers.googleblog.com/en/introducing-gemini-2-5-flash-image/#:~:text=This%20model%20is%20available%20right,5%20Flash%20pricing)。すなわち1回の生成（画像1枚）あたり約4セント、10枚生成指示なら約\\0.39が目安です（テキスト入力のトークン消費も微小ながらあります）。APIのレート制限として、Gemini 2.5 Flash Image Previewモデル（プレビュー版）は**商用利用時でもTier1でRPM=500、1日あたり2000リクエスト**程度に制限されています[\[14\]](https://ai.google.dev/gemini-api/docs/rate-limits#:~:text=Gemini%202,10)。特にプレビュー版モデルは安定版より厳しい制限がある点に注意が必要です[\[15\]](https://ai.google.dev/gemini-api/docs/rate-limits#:~:text=%28TPD%29)[\[14\]](https://ai.google.dev/gemini-api/docs/rate-limits#:~:text=Gemini%202,10)。当初フリーティアではこのモデルは使用不可のため（安定版のみ提供）、**請求先プロジェクトにアップグレード**して利用します。想定するユーザ利用負荷に応じ、レート制限を踏まえて設計（スロットリングやキュー投入）する必要があります。
- **透かし（SynthID）とコンテンツポリシー**: 本モデルで生成・編集された**全画像には不可視のデジタル透かし（SynthID）が埋め込まれ**、AI生成物であることが検知可能になっています[\[11\]](https://developers.googleblog.com/en/introducing-gemini-2-5-flash-image/#:~:text=All%20images%20created%20or%20edited,generated%20or%20edited)。この透かしはDeepMindの技術で、出力画質へ影響なく埋め込まれるものです。ユーザ提供画像にはもちろん透かしは無いものの、モデルがそれを使って新たに生成した画像には自動付与されます。生成画像の利用にはGoogleの利用規約上、透かしの除去は禁止されており適切な利用者表示（場合により「この画像はAIで生成」といった注記）や安全な利用が求められます。モデル自体も安全フィルタを備え、公序良俗に反する画像生成要求や過度の詳細表現はブロックされる可能性があります。実装上は**APIからSafety情報（例えばPROBABILITYメソッドでコンテンツが危険かどうか）**も取得可能[\[16\]](https://cloud.google.com/vertex-ai/generative-ai/docs/multimodal/image-generation#:~:text=response_modalities%3D%5BModality.TEXT%2C%20Modality.IMAGE%5D%2C%20candidate_count%3D1%2C%20safety_settings%3D%5B%20%7B,%5D%2C%20%29%2C)なので、必要に応じて応答を検査し問題ある場合はユーザへ注意表示・マスク処理する設計も検討します。

*(※上記仕様は2025年8月時点のGoogle公式ドキュメントに基づきます[\[4\]](https://cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/2-5-flash#:~:text=Input%20size%20limit%20500%20MB,Technical%20specifications%20Images%20photo)[\[2\]](https://ai.google.dev/gemini-api/docs/files#:~:text=Usage%20info)。最新アップデートやモデルのGA版公開時に変更があれば適宜修正します。例えばプレビュー終了後にモデルIDや制限が変更される可能性もあります。その際は公式情報を再確認し、齟齬があれば本設計を更新します。)*

## 2. リポジトリ監査（現状資産の評価）

**対象リポジトリ**: `Casboko/ReferenceSheetGenerator`（AI StudioからエクスポートされたReact+TypeScriptプロジェクト）。このリポジトリの主要構成は以下のとおりです。

- **プロジェクト構成**: フロントエンド中心の構造で、`vite`をビルド/デブサーバとして使用しています[\[17\]](https://github.com/Casboko/ReferenceSheetGenerator/blob/b13da112f71ba112eb4c331ff23adc45e29fc953/package.json#L6-L14)。依存パッケージはReact 19系, Framer Motion（アニメーション）, Tailwind（CSSユーティリティ）, clsx（クラス名結合）などUI関連が中心で、バックエンドフレームワークは含まれていません[\[18\]](https://github.com/Casboko/ReferenceSheetGenerator/blob/b13da112f71ba112eb4c331ff23adc45e29fc953/package.json#L11-L19)。Gemini API呼び出しにはGoogle公式SDKの`@google/genai`が利用されています[\[19\]](https://github.com/Casboko/ReferenceSheetGenerator/blob/b13da112f71ba112eb4c331ff23adc45e29fc953/services/geminiService.ts#L5-L13)。ディレクトリ構成上、`services/`にAPI呼び出しロジック, `components/`にUIコンポーネント, `lib/`にプロンプト生成やユーティリティ, `assets/`に静的画像ファイル等が配置されています。
- **Gemini API実装**: 現行コードでは`services/geminiService.ts`内に`generateReferenceImage`関数が定義されており、これが**画像生成処理の中核**です[\[20\]](https://github.com/Casboko/ReferenceSheetGenerator/blob/b13da112f71ba112eb4c331ff23adc45e29fc953/services/geminiService.ts#L75-L83)[\[21\]](https://github.com/Casboko/ReferenceSheetGenerator/blob/b13da112f71ba112eb4c331ff23adc45e29fc953/services/geminiService.ts#L86-L94)。この関数は(1)ユーザ入力のキャラクター画像（Base64データURL）、(2)ポーズ参照用画像（ローカルの静的パスをfetchしBase64化）、(3)場合により中間生成画像（データURL）を受け取り、それらをコンテンツとしてGemini APIの`generateContent`に渡しています[\[22\]](https://github.com/Casboko/ReferenceSheetGenerator/blob/b13da112f71ba112eb4c331ff23adc45e29fc953/services/geminiService.ts#L96-L105)[\[23\]](https://github.com/Casboko/ReferenceSheetGenerator/blob/b13da112f71ba112eb4c331ff23adc45e29fc953/services/geminiService.ts#L118-L126)。**モデルID**は `'gemini-2.5-flash-image-preview'` を指定し、`responseModalities`に`IMAGE`と`TEXT`を含めています[\[24\]](https://github.com/Casboko/ReferenceSheetGenerator/blob/b13da112f71ba112eb4c331ff23adc45e29fc953/services/geminiService.ts#L118-L125)。SDKの`GoogleGenAI`クライアントをAPIキーで初期化し、`ai.models.generateContent({...})`でリクエストしています[\[25\]](https://github.com/Casboko/ReferenceSheetGenerator/blob/b13da112f71ba112eb4c331ff23adc45e29fc953/services/geminiService.ts#L15-L23)[\[26\]](https://github.com/Casboko/ReferenceSheetGenerator/blob/b13da112f71ba112eb4c331ff23adc45e29fc953/services/geminiService.ts#L116-L124)。また、最大3回のリトライ実装や、候補応答中の`inlineData`（バイナリ画像）パートを抽出して**Base64データURL文字列**として返す処理も含まれます[\[27\]](https://github.com/Casboko/ReferenceSheetGenerator/blob/b13da112f71ba112eb4c331ff23adc45e29fc953/services/geminiService.ts#L126-L134)[\[28\]](https://github.com/Casboko/ReferenceSheetGenerator/blob/b13da112f71ba112eb4c331ff23adc45e29fc953/services/geminiService.ts#L138-L146)。モデルがテキストだけ返したケース（画像生成失敗）もエラーメッセージにして投げています[\[29\]](https://github.com/Casboko/ReferenceSheetGenerator/blob/b13da112f71ba112eb4c331ff23adc45e29fc953/services/geminiService.ts#L134-L142)。全体的に**単一画像を出力**する前提で書かれており、複数画像候補には未対応です（ループで最初の画像パートを発見すると即returnする実装[\[27\]](https://github.com/Casboko/ReferenceSheetGenerator/blob/b13da112f71ba112eb4c331ff23adc45e29fc953/services/geminiService.ts#L126-L134)）。この点は**今後の拡張**（複数画像生成時の全画像取得）で改修が必要です。
- **UIフロー**: `App.tsx`ではシングルページ内でファイルアップロードから結果表示まで完結する実装になっています[\[30\]](https://github.com/Casboko/ReferenceSheetGenerator/blob/b13da112f71ba112eb4c331ff23adc45e29fc953/App.tsx#L62-L70)[\[31\]](https://github.com/Casboko/ReferenceSheetGenerator/blob/b13da112f71ba112eb4c331ff23adc45e29fc953/App.tsx#L76-L84)。ユーザが画像をアップロードすると、`uploadedImage`ステートにBase64データURLがセットされ[\[32\]](https://github.com/Casboko/ReferenceSheetGenerator/blob/b13da112f71ba112eb4c331ff23adc45e29fc953/App.tsx#L64-L72)、「Generate」ボタン押下で`handleGenerateClick`が動作します[\[31\]](https://github.com/Casboko/ReferenceSheetGenerator/blob/b13da112f71ba112eb4c331ff23adc45e29fc953/App.tsx#L76-L84)。この関数内で**2段階の画像生成**が行われています[\[33\]](https://github.com/Casboko/ReferenceSheetGenerator/blob/b13da112f71ba112eb4c331ff23adc45e29fc953/App.tsx#L99-L108)[\[34\]](https://github.com/Casboko/ReferenceSheetGenerator/blob/b13da112f71ba112eb4c331ff23adc45e29fc953/App.tsx#L123-L131)。まず`Portrait Sheet`（顔の全方向図）を生成し、その出力画像（Base64）をさらに追加参照画像として`Full Body Sheet`（全身の複数ポーズ）生成に使う、という**チェーン処理**です[\[35\]](https://github.com/Casboko/ReferenceSheetGenerator/blob/b13da112f71ba112eb4c331ff23adc45e29fc953/App.tsx#L101-L109)[\[34\]](https://github.com/Casboko/ReferenceSheetGenerator/blob/b13da112f71ba112eb4c331ff23adc45e29fc953/App.tsx#L123-L131)。それぞれ`generateReferenceImage(キャラ画像,`` ``ポーズ画像,`` ``種類名,`` ``追加参照?)`を呼び出し、結果を状態に保存しています。UI上では、2種類の画像（Portrait/Full Body）がPolaroid風のカードに表示され、個別に再生成（Regenerate）ボタンやダウンロード機能があります[\[36\]](https://github.com/Casboko/ReferenceSheetGenerator/blob/b13da112f71ba112eb4c331ff23adc45e29fc953/App.tsx#L232-L240)[\[37\]](https://github.com/Casboko/ReferenceSheetGenerator/blob/b13da112f71ba112eb4c331ff23adc45e29fc953/App.tsx#L244-L253)。再生成処理`handleRegenerate`では、Portrait側を再生成した場合はFull Bodyも連鎖して再実行するロジックが組まれ、両者の一貫性を保とうとしています[\[38\]](https://github.com/Casboko/ReferenceSheetGenerator/blob/b13da112f71ba112eb4c331ff23adc45e29fc953/App.tsx#L152-L161)[\[39\]](https://github.com/Casboko/ReferenceSheetGenerator/blob/b13da112f71ba112eb4c331ff23adc45e29fc953/App.tsx#L180-L189)。逆にFull Bodyのみ再生成する場合は**既存のPortrait出力**を追加参照として使っています[\[40\]](https://github.com/Casboko/ReferenceSheetGenerator/blob/b13da112f71ba112eb4c331ff23adc45e29fc953/App.tsx#L199-L208)。この挙動は、**過去出力を参照に利用する**一例といえ、今回実装する「直前出力参照」のUIコンセプトと近い部分です（ただし前者は内部的に自動処理、後者はUIトグルでユーザ制御する点が異なります）。
- **コード品質・型安全性**: TypeScriptで記述されており、型定義も比較的整っています。`GeneratedImage`インターフェースや`PoseName`型で状態管理に型を付けている他[\[41\]](https://github.com/Casboko/ReferenceSheetGenerator/blob/b13da112f71ba112eb4c331ff23adc45e29fc953/App.tsx#L29-L37)[\[42\]](https://github.com/Casboko/ReferenceSheetGenerator/blob/b13da112f71ba112eb4c331ff23adc45e29fc953/lib/prompts.ts#L8-L16)、Gemini SDKからの型`GenerateContentResponse`等もうまく利用しています[\[19\]](https://github.com/Casboko/ReferenceSheetGenerator/blob/b13da112f71ba112eb4c331ff23adc45e29fc953/services/geminiService.ts#L5-L13)。エラー処理はAPI呼び出し部分でtry-catch＋リトライ実装があり堅牢ですが[\[43\]](https://github.com/Casboko/ReferenceSheetGenerator/blob/b13da112f71ba112eb4c331ff23adc45e29fc953/services/geminiService.ts#L112-L120)[\[28\]](https://github.com/Casboko/ReferenceSheetGenerator/blob/b13da112f71ba112eb4c331ff23adc45e29fc953/services/geminiService.ts#L138-L146)、UI側ではエラー時にステータスとメッセージを表示する程度で、細かなユーザ通知（例: アラート）は最低限です[\[44\]](https://github.com/Casboko/ReferenceSheetGenerator/blob/b13da112f71ba112eb4c331ff23adc45e29fc953/App.tsx#L109-L117)。テストコードはリポジトリ内に見当たらず、CI/CD設定（GitHub Actions等）も存在しません。これはAI Studio由来コードのため想定内ですが、**今後の拡張**ではユニットテスト（特に画像組み合わせロジックやAPI層）や結合テストを追加し品質保証を図る余地があります。
- **再利用箇所と改修箇所**:
- *再利用可能*: フロントエンドの基本構造（Reactによる状態管理とUI描画）は流用できます。特に**画像表示コンポーネント**（PolaroidCardなど）は新UIでも参考になります。またGemini API呼び出し部分の**基本フロー**（画像→DataURL変換→API→結果Base64）は土台として使えます。一連の**2段階生成ロジック**も「出力を次の入力に使う」という点でノウハウが含まれており、UI操作に置き換えつつ概念を活かせます。コード全体が比較的シンプルな構成のため、新機能追加のベースとして理解・改変しやすい状態です。
- *改修が必要*: 大きく**アプリの目的とUIフロー**が変わるため、現行の固定的な処理から**汎用的なマルチターン処理**への書き換えが必要です。例えば`REFERENCE_TYPES`（固定の2種シート）や`prompts.ts`（固定プロンプト文）といったハードコーディングは、ユーザが自由に指示可能なUIでは不要となるため削除・一般化します。`generateReferenceImage`関数も**Files API対応**（Base64直接ではなくファイルURI利用）や**可変長の画像配列入力**に改造する必要があります。また現在APIキーをフロント側で保持・使用していますが[\[45\]](https://github.com/Casboko/ReferenceSheetGenerator/blob/b13da112f71ba112eb4c331ff23adc45e29fc953/vite.config.ts#L6-L14)、これは**セキュリティ上問題**なのでバックエンド経由に変更するか、少なくともデプロイ時に環境変数で安全に扱う方法を導入します（詳細は後述のセキュリティ章で言及）。さらに、**複数画像出力**への対応（複数候補や手順付き画像）や**新UI要件**（参照スロットやトグル操作）を満たすため、UI状態管理ロジック（ステートマシン）を一新する必要があります。既存コードを土台に、各ファイルごとに下記のような変更を実施します（詳細は後述の実装計画節にてファイル別TODOとして列挙します）。

## 3. アーキテクチャ提案（ステートレス vs. Chat方式）

本章では、要求を満たすためのシステムアーキテクチャを**ステートレス方式**（各ターンごとに独立したリクエスト組立て）と**Chatベース方式**（会話履歴を持たせる）で比較検討します。それぞれMVPに適した構成か、将来的拡張性やリスクも踏まえて評価します。

- **(A) ステートレス版パイプライン**:

- **概要**: 各画像生成ターンごとに、必要な**参照画像（最大3枚）とテキスト指示**だけを含むリクエストを作成し、Gemini APIの`generateContent`を呼び出す方式です。過去の履歴や暗黙のコンテキストはリクエストに含めず、常に**現在ユーザが選択した要素のみ**をモデルに与えます。

- **実現方法**: フロントエンドでユーザの操作に応じて、例えば「参照スロットに画像A,B,Cを設定」「直前出力利用トグルON」「指示テキスト'○○な画像にして'入力」→「生成ボタン押下」という流れで、アプリは内部で`contents`配列を構築します。具体的には、Files API上のURI参照パート（例: `{"file_data":{"mime_type":"image/png","file_uri":"..."} }`）を最大3つと、最後にユーザのプロンプトテキスト（`{"text": "..."}`）を入れた配列を`generateContent`に渡します（下記コード例参照）。各ターン終了時、モデル出力（画像+テキスト）は都度処理してUIに反映し、必要ならその出力画像を次ターンの参照に組み込む準備をします。**モデル側では会話履歴を持たない**ため、前ターン内容を参照したい場合は明示的に前出力画像を入力に含めるしかなく、逆に不要なら入れなければ完全にコンテキストが切り替わります。この性質により、ユーザが「新しいコンセプトを開始」操作をした際も、単に参照画像スロットを全てクリアし新規の入力だけでリクエストすれば**以前の画像や指示の影響は一切残りません**。

- **利点**: 実装が比較的シンプルで、**予期せぬ履歴干渉を防げる**点が最大の利点です。Gemini 2.5 Flash Image Previewは会話補完（Chat completion）機能を持たず[\[46\]](https://cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/2-5-flash#:~:text=,Chat%20completions)、`generateContent`単発呼び出しに特化しているため、このステートレス方式は**モデルの想定利用法に合致**します。履歴管理ロジックが不要なので、**バグの少ない堅牢なシステム**になり、スコープ切替時の持ち越し問題もUI制御のみで確実に解決できます。さらに、不要な履歴を送らないことで**リクエストサイズ節約**や**コスト削減**（テキストトークンを無駄にしない）にも繋がります。

- **欠点**: 毎ターンのリクエスト構築に必要な情報を全てアプリ側で保持・管理する必要があります。例えばユーザが「前の画像をもう少し明るくして」と指示した場合、前の画像自体を再送しなければモデルは参照できません。Chat方式なら暗黙に覚えている文脈も、ステートレスでは全て**アプリが責任を持って明示**する必要があります。このため実装側で**状態管理（現在の前出力や参照群の管理）**が重要になります。また、モデルに長い一連の文脈を理解させたいケース（物語の流れなど）は、常に過去内容をプロンプトに再掲する必要があり、現実的でない場合があります。ただし本アプリの用途（画像の反復編集・合成）では過去テキスト履歴より**画像参照の明示**が肝となるため、大きな問題にはならない見込みです。

- **(B) Chat（履歴維持）版**:

- **概要**: Chat方式では、モデルに過去の対話履歴（ユーザ発話・モデル応答）を渡しつつ追加の発話をしていくアプローチです。例えばTurn1で画像A→出力X、Turn2で「明るくして」を送る際、履歴として「ユーザ: 画像Aを入力して生成 / モデル: 出力Xを返した」が含まれ、モデルはそれを文脈として参照できます。通常のGeminiモデルではChat APIや会話メモリがありますが、**当該画像モデルはチャット完了に未対応**（2025年8月時点）であり[\[46\]](https://cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/2-5-flash#:~:text=,Chat%20completions)、厳密なChat APIエンドポイントは存在しません。しかし、`generateContent`でも`contents`配列に過去のテキストや画像を付加すれば擬似的に会話履歴を前段コンテキストとして与えることは可能です（例: role=systemや冒頭のテキストで過去状況を説明する等）。そのため、本方式を採るとすれば**アプリ側で履歴を要約・整形して毎回送信**する形になります。

- **利点**: ユーザにとっては**対話的な操作感**が得られます。極力テキスト入力を減らし「前の続きで…」のような指示も許容したい場合、履歴がモデルにあると自然に解釈してもらえます。また、テキストによる長いストーリー生成＋画像生成を交互に行うような高度シナリオでは、履歴を維持するChat形式が適しています。

- **欠点**: 現状このモデルには**公式にチャットモードが無い**ため、使用は難があります[\[47\]](https://cloud.google.com/vertex-ai/generative-ai/docs/multimodal/image-generation#:~:text=Note%3A%20Multimodal%20response%20generation%20is,flash)。無理に履歴テキストを付加すると、モデルが**過去画像を内部記憶する保証は無く**、結局その画像を再アップしなければ影響を与えられません。つまり**「暗黙の参照」は機能しにくい**と考えられます。仮にChat APIが将来提供されても、画像は履歴に埋め込まないほうが良い（コンテキスト長消費が大きいため）ですし、**不要画像が混入するリスク**もあります。また、履歴が長くなるとコンテキストウィンドウ（32kトークン）の制限に近づき、**性能低下やコスト増**に繋がります。さらに会話切替（新コンセプト開始）の際に、過去履歴を明示的にクリア（新セッションID発行等）しないとモデルが前内容を引きずる危険があります。この設計は**実装複雑性が高くバグを生みやすい**ため、今回の要件（過去画像を混入させない）には不向きです。

**採用方針**: 上記比較より、**ステートレス方式 (A)** を基本方針とします。Gemini 2.5 Flash Image Previewの使用モデル上もChat方式は正式サポートされておらず、UIで参照画像を明示選択する要件と合致するためです。Chat的な履歴保持は行わず、**各ターン独立＋ユーザが画像参照をトグルで指定**するデザインとします。ただし、実装面では「前ターン出力を自動参照する」トグルON時の挙動など**Chatに近い体験**をUIでエミュレートします。これによりユーザ体験上は「前の続きで」という操作を**ワンクリックで再現**できますが、モデルにはしっかり前画像を送り直す形です。また将来的に、モデル側に画像用のセッション管理機能や履歴トラッキングが追加された場合には、上位互換的に組み込めるよう考慮します（例えばGemini APIに会話モードが導入された際は、当面ステートレスを維持しつつ、履歴テキストだけ参考にさせるなど段階的対応）。**比較表**としてまとめると:

| 手法 | モデル対応 | 履歴影響 | 実装難度 | 本要件適合度 |
|----|----|----|----|----|
| ステートレス (A) | ◎ （公式想定） | 過去の影響は一切無し（明示分のみ） | 低（状態管理のみ） | ◎ 暗黙参照ゼロを保証 |
| Chat風 (B) | × （未対応） | 暗黙で影響残存の恐れあり | 高（独自工夫要） | △ リスク高 |
| **結論** | **採用** | （履歴切替しやすい） | **シンプル** | **要件に最適** |

## 4. データモデル設計とAPI設計

続いて、ユーザがアップロード・生成する画像やセッション情報を管理する**データモデル**と、フロントエンド・バックエンド間、およびバックエンド・Gemini API間の**API設計**について示します。

### データモデル設計

**エンティティ**: アプリ内で扱う主なデータ要素は以下の通りです。

- **Asset（画像アセット）**: ユーザがアップロードした画像、またはモデルが生成した画像を一括して管理する概念です。それぞれに一意IDとメタ情報を付与します。属性例：

- `id`: ユニークID（生成順やUUIDなど）

- `source`: `"user"`（ユーザ提供）or`"generated"`（AI出力）の種別

- `fileUri`: Files APIにアップロードした際のURI（例: `generativelanguage.googleapis.com/v1beta/files/PROJECT/locations/...`）

- `mimeType`: 画像種別（`image/png`等）

- `dataUrl`: Base64データURL文字列（UI表示用。生成直後など一時的に保持）

- `timestamp`: 生成またはアップロード日時（ISO文字列）

- `expiresAt`: （任意）当該ファイルURIの有効期限。Files APIではアップロード後48時間なので、`timestamp + 48h`で算出しておく。**UI上で寿命表示**に用います。

- **ReferenceSlot（参照スロット）**: UI上の3つの参照枠それぞれに対応するデータ。各スロットに0または1つのAssetを割り当て可能です。属性：

- `slotIndex`: 0,1,2（UIでの位置）

- `assetId`: 現在セットされているAssetのid（なければnull）

- （将来的拡張: 役割ラベルなど。Whiskにならい、Slot1=主題, Slot2=シーン, Slot3=スタイル といったタグ付けも検討可能ですが、MVPではフリースロットとします）

- **Session（セッション）**: これはUI上の概念で、1つのコンセプトや一連の編集操作のまとまりを表します。属性：

- `sessionId`: 一意ID（新しいコンセプト開始で新規発行）

- `assets`: そのセッション内で扱われたAssetのリスト（またはID配列）

- `history`: （必要なら）各ターンの操作履歴（ユーザ操作ログやメタデータ）。MVPでは履歴をモデルに送らないため必須ではありませんが、UX改善や解析のためクライアント側に保持しても良いでしょう。

- **GenerationRequest/Response**: 1回の生成要求と結果。バックエンドAPIの入力/出力仕様として定義します。属性例：

- GenerationRequest:
  - `prompt`: ユーザ入力テキスト（string、空許可：無入力で画像のみ変換も可能に）
  - `referenceAssetIds`: 参照に使うAssetのID配列（長さ0〜3）
  - `useLastOutput`: 前回出力を参照に含めるかのフラグ（boolean。ただしこの情報だけでは曖昧なので、フロントでON時にreferenceAssetIdsに直前のassetIdを含めて送る実装にする可能性が高いです。従ってバックエンド側では結果的にIDsのみあれば十分とも言えます）
  - `candidateCount`: 出力候補数（省略時1。ユーザが「バリエーション4枚」等選択できるUIなら指定）
  - 他：将来的に`size`（画像サイズ指定）や`safetySettings`など高度な設定も考えられますが、MVPでは固定値。

- GenerationResponse:
  - `images`: 生成画像のAsset情報配列（付与されたid、dataUrlなど）。ここでレスポンス時にすでに**Files APIへのアップロードも完了済み**で、各画像の`fileUri`も得た状態にします。複数枚ある場合は全て。
  - `text`: モデルが生成したテキスト応答（string、画像説明や付随コメント。用途に応じUI表示するか決定）
  - `error`: エラー発生時のエラーメッセージ（正常時null）
  - `sessionId`: （任意）このリクエストが属するセッションID（バックエンドはセッション管理しない場合、クライアント側で付与して無視してもOK）

**データフロー**: 1. ユーザが画像をアップロード→フロントで一時的にBase64保持しプレビュー表示→バックエンドに`/upload`API（仮称）呼び出し→バックエンドでFiles API `upload`実行→`fileUri`取得→Asset生成（DB不要ならクライアント側でAssetリストに保持、またはバックエンドで軽量なインメモリ管理かファイルに記録）→`assetId`とプレビュー用URLをフロントに返す。 2. ユーザが参照スロットにAssetをセット/解除→UI上でstate更新のみ（サーバ通信不要）。 3. ユーザがテキスト指示入力→state更新のみ。 4. ユーザが「生成」実行→フロントが現在の`referenceAssetIds`と`prompt`をバックエンドの`/generate`APIにPOST。 5. バックエンド`/generate`受信→リクエスト内Asset IDsを元に、対応するFiles API `file_uri`とmimeTypeを取得（データストア参照）。Gemini SDKで`generateContent`を呼び出し、contents配列に各`createPartFromUri(fileUri, mimeType)`を、テキストがあれば最後に`{text: prompt}`パートを構築。さらに`responseModalities: ["TEXT","IMAGE"]`と`candidateCount`（必要なら）を設定してAPI呼び出し。 6. Gemini APIレスポンス（画像部分はinlineData base64列）を受信→バックエンドでそのデータを**一旦デコードして画像バイナリを取得**→**再度Files APIにアップロード**（ここ重要: モデル出力画像もFilesに入れておけば以後48h再利用可能。ただし、すぐ次のリクエストで使う場合は実はインラインでもよいのですが、一貫性のためアップします）。それぞれのアップロード結果から`fileUri`取得→新しいAssetレコードを生成（source=`"generated"`, dataUrlはここでは生成できないのでフロントにも送るため**バイナリからBase64に変換**します）。複数画像あれば全て同様に処理します。最後にレスポンスJSONとして`GenerationResponse`をフロントに返却。 7. フロントは受信した`images`配列のdataUrlを使って画面に画像を表示し、新たなAssetを内部リストにも追加。直前出力トグルがONであれば自動的にその出力Assetを次ターンの参照スロット（例えばSlot1）にセットする、等の更新を行います。エラー時はモーダル表示かトースト通知。

上記のように、**バックエンドが中心となりFiles APIとGemini APIを橋渡し**し、フロントは極力ロジックを持たずUI操作と状態管理に専念する構成です。MVP段階ではバックエンドを省きフロントから直接Gemini APIを叩く実装も可能ですが（現在のリポジトリがまさにそう）、APIキー漏洩リスクやCORS設定など課題が多いので、本提案では**早期に簡易バックエンドを導入**する計画としています。

### API設計

**バックエンド**（Node/ExpressやNext.js API Routes想定）に実装する主要エンドポイントは以下です。

- `POST /api/upload` – ユーザアップロード画像を受け取り、Files APIに保存してAssetを登録。

- **リクエスト**: multipartまたはbase64 JSONで画像ファイル（MVPではフロントからBase64文字列を送る簡易実装でもOK）。ファイル名やMIMEタイプも含めます。

- **レスポンス**: 新規作成されたAssetの`id`, `fileUri`, （プレビュー用の）`dataUrl`など。フロントはこれを受けて参照スロットにセットしたり、アセット一覧に表示。

- **処理**: `ai.files.upload` SDKメソッド（またはREST API直接）でファイル保存[\[48\]](https://ai.google.dev/gemini-api/docs/files#:~:text=async%20function%20main%28%29%20,%7D%2C)。戻りで`myfile.uri`等取得[\[49\]](https://ai.google.dev/gemini-api/docs/files#:~:text=const%20response%20%3D%20await%20ai.models.generateContent%28,%5D%29%2C)。Assetをデータ構造に追加。MVPではバックエンドで状態を長く持たないので、フロント側Assetリストにも保持させ、id管理はフロント主体でもよいでしょう。

- `POST /api/generate` – 画像生成リクエスト。上記GenerationRequestに相当。

- **リクエスト**: JSONで`prompt`, `referenceAssetIds`, `candidateCount`等。

- **レスポンス**: GenerationResponse（生成画像Asset群とテキスト）。

- **処理**: 前述データフロー(5)-(6)を実行。複数のFiles URIとテキストから`ai.models.generateContent`呼び出し[\[49\]](https://ai.google.dev/gemini-api/docs/files#:~:text=const%20response%20%3D%20await%20ai.models.generateContent%28,%5D%29%2C)。`response.candidates[0].content.parts`から画像バイト列を抽出[\[50\]](https://developers.googleblog.com/en/introducing-gemini-2-5-flash-image/#:~:text=for%20part%20in%20response.candidates,generated_image.png)しファイルアップロード（SDKで`ai.files.upload({file: <Buffer>, config:{mimeType}})`を使用）。なおSDKでは`createPartFromUri`を使うと自動でfileDataパートを生成できます[\[51\]](https://ai.google.dev/gemini-api/docs/files#:~:text=model%3A%20%22gemini,%5D%29%2C)。擬似コード例:

<!-- -->

- import { GoogleGenAI, Modality, createUserContent, createPartFromUri } from '@google/genai';
      const ai = new GoogleGenAI({ apiKey: API_KEY });
      // 参照画像のPartsを準備
      const parts = [];
      for (const assetId of referenceAssetIds) {
        const asset = getAsset(assetId);
        parts.push(createPartFromUri(asset.fileUri, asset.mimeType));  // Filesにある既存画像を参照
      }
      if (promptText) parts.push(promptText);
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image-preview',
        contents: createUserContent(parts),
        config: { responseModalities: [Modality.IMAGE, Modality.TEXT], candidateCount: req.candidateCount ?? 1 }
      });
      // 応答処理
      const outImages = [];
      for (const part of response.candidates[0].content.parts) {
        if (part.text) {
          outputText = part.text;
        } else if (part.inlineData) {
          const mime = part.inlineData.mimeType;
          const imageBuffer = Buffer.from(part.inlineData.data, 'base64');
          // モデル出力画像をファイルアップロード
          const uploaded = await ai.files.upload({ file: imageBuffer, config: { mimeType: mime } });
          const fileUri = uploaded.uri;
          const dataUrl = `data:${mime};base64,${part.inlineData.data}`;  // フロント表示用
          const newAssetId = addAsset({ source: 'generated', fileUri, mimeType: mime, dataUrl });
          outImages.push({ id: newAssetId, dataUrl, fileUri });
        }
      }
      res.json({ images: outImages, text: outputText });

  上記のように各出力画像をAsset化しつつ、フロントに送り返します。

<!-- -->

- （必要なら）`GET /api/assets` – 現在有効なAsset一覧を取得。MVPではフロント側状態が正となるため必須ではありませんが、バックエンドが記憶を持つ場合に備え、一覧・整理用APIを用意できます（例えば長期間放置で期限切れAssetを除去するなど）。

- （必要なら）`POST /api/delete` – 特定Asset（Files上のファイル）削除。標準では48hで自動削除されますが、ユーザが明示的にクリアしたい場合や容量整理で使います。ただしMVP範囲では優先度低です。

**APIレスポンス設計**: いずれもJSONで返し、フロントではこれを受けて状態を更新・UI反映します。エラー時はHTTPステータスと`{ error: "message" }`を返し、フロントでメッセージ表示します。

**セキュリティ**: APIキーはバックエンド内部で保持し、`GoogleGenAI`初期化に使用します。フロントからバックエンド通信はHTTPS経由＆適切なCORS設定で限定します。これによりAPIキーはブラウザに露出せず、直接Gemini API呼び出しより安全です。

## 5. UI/UX設計

UIはユーザが直感的に参照画像を操作し、生成結果を確認・再編集できるよう設計します。**Whisk的な体験**を参考にしつつ、当アプリの要件に合わせたインターフェースを構築します。

- **メイン画面レイアウト**: 画面中央に生成画像のプレビューエリア、左側に参照画像スロット、右側に操作パネル（テキスト入力・各種ボタン）を配置する三カラム構成を想定します（レスポンシブ対応として、縦積みにも変形可能に）。背景には現行アプリのような装飾（例えばポラロイド風カード重畳アニメーション）でクリエイティブな雰囲気を維持しつつ、操作要素は見やすく整理します。
- **参照スロット (3枠)**: 画面左に縦または横に3つの画像ドロップエリアを配置します。各スロットは「画像未設定」時は薄い枠と「+ 画像をドロップ/選択」ヒントを表示し、画像がセットされたらそのサムネイルを表示します。スロットごとに✕ボタンでクリア（外す）機能を付け、ユーザは任意に組み合わせを変更可能です。Whiskでは「Subject / Scene / Style」の3役割でしたが、本アプリでは特定の役割区別は設けず、ユーザの発想で自由に使える汎用スロットとします（必要に応じてテキスト指示で「1枚目の画像の対象を、2枚目の背景に…」等指定する運用）。
- **「直前出力を参照」トグル**: 操作パネル上部にスイッチを配置します。ONにすると**直前の生成結果画像**を次回リクエストの参照に自動追加します。具体的には、トグルON時はUI上で例えばスロット1を「前回出力」扱いに予約し、残り2スロットのみユーザが自由に使えるようにします（UI上スロット1に「前回出力が使用されます」といった表示、ユーザはそこを操作不可にする等）。トグルOFFに戻すとスロット1が解放され、3枠すべてユーザ指定に戻ります。これにより**ワンクリックで出力画像の連続利用**が可能になります。なお、直前出力Asset自体はAssetsリストにもあるため、トグルOFFでもユーザが手動でその画像をドラッグすれば参照可能です。トグルは**単なるUI便宜機能**として扱い、送信するデータ自体はreferenceAssetIdsに前回Assetが含まれるか否かで判断します。
- **テキストプロンプト入力欄**: 画面右側に配置。プレースホルダとして「例: 髪の色を金髪に変更して背景に夕焼けを追加」など具体例を入れ、ユーザがどう指示を書けるかを示唆します（Whiskはテキストレス志向でしたが、本アプリでは**テキスト指示を許容**してクリエイティビティを高めます）。空欄でも送信は許可し、その場合は画像のみの変換（例: スタイル画像を与えて**スタイル転写**）なども実現可能にします。過去生成のテキスト応答（モデルが返した説明など）は基本非表示か、希望により薄いグレーで参考表示するか検討します。多くの場合モデルのテキストは「～な画像を生成しました」程度なのでUI上は省略で問題ない見込みです。
- **「生成」ボタンとローディング**: テキスト欄下に主要CTAとして「✨ 生成する」ボタン（Permanent Markerフォントなど既存テイストを踏襲）を配置します。押下時はスピナー表示やボタン非活性化で**重複実行防止**し、バックエンド応答待ちとなります[\[52\]](https://github.com/Casboko/ReferenceSheetGenerator/blob/b13da112f71ba112eb4c331ff23adc45e29fc953/App.tsx#L79-L87)。特に画像生成は数秒～十数秒程度要するので、その間進捗UI（くるくるアニメや「魔法を生成中…」メッセージ）を表示して**ユーザが待てる設計**にします。生成完了するとボタンを復活させ、新しい出力画像を画面中央に表示します。
- **出力画像表示と履歴**: 最新の出力画像は中央プレビュー枠で大きく表示し、その下または横に**サムネイル履歴一覧**を表示します。例えば下部にフィルムストリップ風にこれまでの生成画像（各セッション内）を小さく並べ、ユーザがクリックするとその画像を拡大プレビュー or 参照スロットにセットできるようにします。Whiskでは逐一上書き型でしたが、本アプリでは**過去出力も資産として保持**し、比較検討や再利用ができるようにします。必要に応じページがリセットされても再度結果を見返せるよう、ブラウザローカルストレージ等にAsset情報を保存しておくことも検討します（ただし画像を大量に保存すると容量課題があるため、最近数件に留めるかダウンロード誘導に留める）。
- **セッション切替ボタン**: 画面上部（ヘッダー部）に「🔄 新しいコンセプトを開始」ボタンを配置します。これをクリックすると**現在の参照スロットとテキスト入力をクリア**し、セッションIDを新規発行して以後の生成を新セッション扱いにします。UI上は出力履歴も一旦リセットされます（前セッションの履歴サムネイルは消すか、別タブで保存）。ユーザにとっては「別のテーマで最初からやり直す」操作です。内部的には現在Assetリストは保持しつつ、新セッションでは**過去Assetを自動では参照に使わない**ようにするだけです（必要ならユーザがドラッグで古いAssetも使えるため、完全に隔離はせず、あくまでUI上初期化で心理的区切りを付けるイメージ）。
- **Asset一覧・ドラッグ&ドロップ**: 画面右下またはモーダルで「📂 アセット一覧」を表示できるようにします。ここには現在のセッションおよび過去セッションのAsset（画像）がサムネイルと簡易情報付きで並び、ユーザはそこから**任意のスロットへドラッグ&ドロップ**可能です。各Assetにはアイコン等で**出所**（アップロードか生成か）を示し、ホバーで**残り寿命**（例: あと36時間有効）を表示します。寿命計算は`expiresAt`から現在時刻を引いて行い、「有効期限: 約X時間」などと表示します。期限切れが近いAssetは色を変えるなど視覚的注意を促し、実際期限超過でモデル利用不能になった場合は選択時に再アップロード（ローカルにデータがあれば）するかエラーメッセージを出します。アセット一覧から不要な画像を削除するUI（ゴミ箱ボタン）も提供し、押すとFiles APIからの削除リクエストと内部Assetリストからの除去を行います。
- **デザイン/スタイル**: 現行アプリの雰囲気（手書き風フォント、ポラロイド写真のようなシャドウ）は引き継ぎつつ、新機能UIを違和感なく組み込みます。Tailwind CSSで実装し、レスポンシブ対応（モバイルでは参照スロットを小さく上部にまとめ、生成画像を大きく、操作ボタンは下部に配置する等）。**ユーザが参照画像を認識しやすく**するため、例えばスロットに番号を振る・出力テキスト中で「1枚目」など参照しやすい工夫も検討します。
- **アクセシビリティ**: 画像操作主体のツールですが、テキスト入力やボタンはラベル付け、キーボード操作対応も検討します。生成中の待ち時間を視覚効果だけでなくスクリーンリーダー向けに「生成中」と発声させるなど配慮します。

以上により、**ユーザはドラッグ&ドロップとスイッチ操作で直感的に画像を合成・編集**でき、Whisk同様のビジュアル主導のプロンプト体験を提供します。例えばユーザは: 1. 画像A（主題）をアップロード→スロット1に配置、画像B（スタイル）をアップ→スロット2に配置、テキスト「背景を森にして」を入力→生成→結果X表示。 2. 「直前出力を参照」をON、さらに画像C（別のスタイル）をスロット2にセット差替え、テキスト「夜の雰囲気で」と変更→生成→結果Y表示（Xを元に夜の森風に変化）。 3. コンセプト切替ボタン→スロット初期化、新テーマでまた最初から… といった操作が可能になります。

このようにUI各要素が連動し、**暗黙の履歴を持ち込まない明示的な操作UX**を実現します。UI仕様についてはワイヤーフレーム図（テキストベース）として:

    [ ヘッダー: 新しいコンセプト 🔄 | 「Gemini画像ジェネレーター」タイトル ]
    ---------------------------------------------------------------
    参照画像:
     [Slot1: (+) ] [Slot2: (+) ] [Slot3: (+) ]    |   指示: [ テキスト入力__________ ]
     (toggle □ 前回出力を参照)                     |   [✨生成する] 
                                                  | 
    出力:
     [ 大きな生成画像プレビュー枠 ]                |   アセット一覧 📂
     [ (履歴サムネイル一覧 →) ]                  |   ダウンロード ▼ 再生成 🔁
    ---------------------------------------------------------------
    [ フッター: Powered by Google Gemini / 注意書き等 ]

と表現できます。実際の実装ではこれを基に細部調整します。

## 6. 実装計画（最短MVPとファイル別TODO）

**目標**: 既存コードに対し**最小の差分**でMVPを動作させ、その後段階的に機能拡張していきます。ここでは開発タスクをコンポーネント/ファイル単位に整理し、どの箇所に何を実装・修正するか列挙します。

**まずはMVP**: ステートレスな1ユーザ用システムを構築。**安全なAPIキー管理**のためバックエンド導入は早めに行いますが、その他高度なUI機能（アセット一覧や複数画像出力など）は最初の動作確認では簡易化し、順次追加します。最小限のMVPで実現する機能は: - 画像アップロード→参照スロット設定→テキスト指示→1枚画像生成→表示→繰り返し - 直前出力トグルで前の画像を再利用 - 新コンセプト開始でリセット - エラー時の簡易通知

これらを動かすための**主要改修点**:

- **プロンプト生成削除**: `lib/prompts.ts` と既存のgeneratePrompt関数は固定シナリオ向けのため、**廃止**または汎用に改修。MVPではユーザ入力テキストをそのまま使用し、この関数は不要になる見込みなので関連呼び出しを除去。

- **Geminiサービス修正**: `services/geminiService.ts` の `generateReferenceImage` 関数を**汎用generateImages**関数に書き換えます。具体的TODO:

- 引数を `(promptText: string, imageUris: string[])` 等に変更。最大3枚のimage URI（Files API）とテキストを受け取り、Gemini APIを呼び出すようにする。

- `imageUrlToDataUrl`等、ブラウザ用fetch＋FileReaderでBase64化する処理は**不要**になるため削除。代わりにバックエンド側でファイルを読み込むか、SDKのfileDataを使う。

- **Files API利用**: 画像を`dataUrlToGeminiPart`でinline構築する部分[\[53\]](https://github.com/Casboko/ReferenceSheetGenerator/blob/b13da112f71ba112eb4c331ff23adc45e29fc953/services/geminiService.ts#L96-L104)は、Files URIを使うよう変更します。もしフロントからfileUriを直接受け取れるならSDKの`createPartFromUri`関数を使い、Parts配列を構築します[\[51\]](https://ai.google.dev/gemini-api/docs/files#:~:text=model%3A%20%22gemini,%5D%29%2C)。Node環境ではfetchが使えないので注意（`createPartFromUri`内部でどう実装されているかSDK次第だが、おそらくHTTP GETせずURI文字列をそのまま組み立てるだけ）。**MVPではフロントJSからGemini直呼び**を残すなら、環境的にfetch可能なので既存Base64送信でも動くが、7MB以上対応やパフォーマンス改善のためにもバックエンド実装に移行します。

- **複数画像対応**: `contents`配列に3枚まで追加するようループ実装にします。既存では1枚目固定+（if chainedで2枚目）+3枚目固定でしたが[\[53\]](https://github.com/Casboko/ReferenceSheetGenerator/blob/b13da112f71ba112eb4c331ff23adc45e29fc953/services/geminiService.ts#L96-L104)、これを柔軟に。

- **レスポンス処理**: 現状は1枚目の`inlineData`見つけてreturnでしたが[\[27\]](https://github.com/Casboko/ReferenceSheetGenerator/blob/b13da112f71ba112eb4c331ff23adc45e29fc953/services/geminiService.ts#L126-L134)、**ループして全画像を取得**するよう変更。複数候補（`candidateCount>1`）はMVPでは使わない想定ですが、対応するなら`response.candidates`を全て走査し各のparts内画像を取る処理が必要です（出力10枚を超える可能性は低いが構造上最大8 candidate \* 各最大10画像と理論値高いので念のため注意。もっともそんな大きな応答はUIで扱いきれないのでUI側でcandidateCount制限します）。

- **リトライ**: 既存の3回リトライロジック[\[43\]](https://github.com/Casboko/ReferenceSheetGenerator/blob/b13da112f71ba112eb4c331ff23adc45e29fc953/services/geminiService.ts#L112-L120)[\[28\]](https://github.com/Casboko/ReferenceSheetGenerator/blob/b13da112f71ba112eb4c331ff23adc45e29fc953/services/geminiService.ts#L138-L146)はそのまま活かします。Backoffを入れるなら`await new Promise(r=>setTimeout(r, 1000*attempt))`などで増加待ちしています[\[54\]](https://github.com/Casboko/ReferenceSheetGenerator/blob/b13da112f71ba112eb4c331ff23adc45e29fc953/services/geminiService.ts#L140-L145)。HTTPステータス429（レート制限）時はこれで対処、その他エラーは即時再試行。

- **エラーハンドリング**: 最終的にthrowするエラー文はユーザ向けには生/raw過ぎる可能性があるので、バックエンドなら`res.status(500).json({error: message})`に変換、フロントでユーザ向けメッセージにします。「AIモデルが画像生成に失敗しました（○○）」のように日本語化も検討。

- **バックエンド新規作成**: 現行は純フロント。開発効率のため**Next.js**への移行を提案します。Next.jsならページ/コンポーネントはReactそのまま移行でき、`/pages/api/*.ts`としてAPIエンドポイントも同居可能です。CI設定も比較的簡単です。もし既存構成維持なら、`server.js`を用意しExpressを組み込む方法もあります。ここではNext.js採用前提で:

- `pages/api/upload.ts`: 上述`/api/upload`の実装。

- `pages/api/generate.ts`: 同`/api/generate`の実装。

- 環境変数: `.env.local`に`GEMINI_API_KEY`等を設定（Nextならサーバーサイドでは`process.env.GEMINI_API_KEY`直接使用可）。**APIキーは公開されないように注意**（Nextの場合`NEXT_PUBLIC_`接頭辞を付けない限りサーバ限定）。

- SDK初期化は各リクエスト内で行ってもよいですが、**頻繁だと遅延**が気になる場合、`GoogleGenAI`クライアントを一度作ってグローバルに保持する方法も。Thread-safeかは要確認ですが、ざっとSDK docsを見る限りシンプルなREST wrapperなので大丈夫でしょう。

- CORS: Next APIは同一ドメイン内から使うので基本不要ですが、別ドメイン配信ならヘッダ付与検討。

- **フロントエンド**:

- `App.tsx`（またはNextに移行なら`pages/index.tsx`に相当）を大幅改修。状態管理を**参照スロット・Assetリスト中心**に変更します。現行の`uploadedImage`（単一画像）や`generatedImages`（Portrait/FullBodyのMap）といった特殊構造[\[55\]](https://github.com/Casboko/ReferenceSheetGenerator/blob/b13da112f71ba112eb4c331ff23adc45e29fc953/App.tsx#L53-L61)は廃止し、代わりに:
  - `assets: Asset[]`（全Asset配列）
  - `slots: [assetId|null, assetId|null, assetId|null]`（3スロットに対応するAsset ID）
  - `lastOutputId: assetId|null`（直前出力のID。トグルONならslotsにこれを自動設定する際に使用）
  - `useLastOutput: boolean`（トグルのUI状態）
  - `promptText: string`
  - `isGenerating: boolean`（ローディング表示用）
  - などのstateをuseStateで管理。

- UI要素に対応するハンドラ:

  - ファイル選択/ドロップイベント -\> `handleUpload`を実装。ファイルを取り、まずプレビュー用に一旦URL.createObjectURLかFileReaderでDataURL作成しつつ、すぐ`api/upload`にPOST。返ってきたAsset情報で`assets`にpushし、適切なslotに割り当てる（ユーザがどこにドロップしたかイベントでわかる場合はそのslot、そうでなければ空いている最初のslotに入れるなど）。
  - スロットのクリアボタン -\> 対応slotのassetIdをnullにしstate更新。
  - トグルON/OFF -\> `setUseLastOutput(true/false)`。ONにした時、もし`lastOutputId`が存在すればslot0にそのidをセットし、他のslotでそのidがあれば重複しないようどちらか調整。OFFにしたらslot0をnull解除（ただし元からユーザが入れてた画像があればどうするか…トグルON前にslot0に何かあった場合、それを上書きしていたのでOFFにすると復元する？UI簡略のためトグルON時、slot0に元々あったAssetは一時的に避難しておき、OFFで戻す実装も考えられます。MVPでは「ONにするとslot0の現在画像は外れます」と注意喚起して、戻らなくてもよい仕様でも許容範囲でしょう）。
  - 「生成する」ボタン -\> `handleGenerate`。現在の`promptText`と`slots`配列を基に`referenceAssetIds`を準備。ここで`useLastOutput`がtrueなら`lastOutputId`も含める（実質slotsに入っているはずなので二重管理にならないよう調整）。バックエンド`/api/generate`にPOSTし、`isGenerating=true`に。返答が来たら成功時:
  - `response.images`配列を順次処理し、各Assetを`assets`stateに追加。lastOutputIdをこれらのうち最後の（通常一つだけならそれ）に更新。
  - 参照トグルONならlastOutputIdが自動セット済みなのでslot0維持、それ以外のslotsはそのまま。トグルOFFなら全slotsは維持（過去出力は入ってない前提なので何もしない）。
  - 生成画像をUIに表示（中央プレビューはlastOutputIdに対応するAssetを表示する実装にすれば、自動で最新出力が映る）。
  - モデルのtext応答は`response.text`で受け取り、もし表示するなら別のstate e.g. `lastOutputText`に保存し、プレビュー下に表示する等。MVPでは表示スキップ可。
  - エラー時: `response.error`があればalertか、UI上部に赤字表示等し、可能なら詳細（例えばrate limitなら「少し待って再実行ください」等）を表示。`isGenerating=false`に戻す。
  - 「新しいコンセプト🔄」ボタン -\> `handleResetSession`。`slots`を全null、`promptText`クリア、`useLastOutput=false`、`lastOutputId=null`、`lastOutputText=null`等リセットし、新しい`sessionId`をもし管理するなら更新。UI上履歴サムネイルもクリア（または過去セッション履歴として別枠に移す）。
  - 「アセット一覧📂」ボタン -\> モーダル開閉stateで切り替え。モーダル内は`assets`一覧表示、クリックorドラッグでslotに適用。ドラッグ実装は後述。
  - 「再生成🔁」ボタン（出力画像用） -\> 現行App.tsxにはありました[\[36\]](https://github.com/Casboko/ReferenceSheetGenerator/blob/b13da112f71ba112eb4c331ff23adc45e29fc953/App.tsx#L232-L240)。新設計では前回出力を参照に用いるのが容易なので、明示の再生成ボタンは不要化するかもしれません。Whiskでもパラメータを微調整して再実行するUIはなく、新たな指示を与えて再度生成する流れでした。一方、特定出力そのままでseedを変えてもう一度、のような機能要望も考えられるので、MVPでは実装せず次フェーズ検討とします。
  - ダウンロード機能 -\> 現行ではアルバム合成して1枚JPGにしていました[\[37\]](https://github.com/Casboko/ReferenceSheetGenerator/blob/b13da112f71ba112eb4c331ff23adc45e29fc953/App.tsx#L244-L253)。MVPでは**単一画像の直接DL**（\<a\>タグのdownload属性を利用[\[36\]](https://github.com/Casboko/ReferenceSheetGenerator/blob/b13da112f71ba112eb4c331ff23adc45e29fc953/App.tsx#L232-L240)）を実装。複数画像を一括DLはzip化など必要なので後回し。アルバム合成（複数画像を並べて1画像出力）は本プロジェクト本来の目的でしたが、新用途では必須でないので一旦省きます（付録に残す決定事項オプションとして記載）。

- **ドラッグ&ドロップ**: Reactでのドラッグ実装はHTML5 DnD APIか、ライブラリ（react-dnd等）利用が考えられます。MVPではシンプルに:

  - スロットは`<div onDragOver={e=>e.preventDefault()} onDrop={handleDrop(slotIndex)}`を持ち、アセット一覧側の画像に`draggable=true`と`onDragStart={e=>e.dataTransfer.setData('assetId', id)}`を設定。
  - handleDropでdataTransferからassetIdを取得し、そのslotにセット。これで基礎はOKです。細かいプレビュー効果やDrag Ghost表示は後で調整。
  - ファイルの直接ドロップ（PCからスロット上に画像ファイルをドラッグ）は、ブラウザにとってはファイル扱いとなるので、`onDrop`イベントで`e.dataTransfer.files`を見れば取得できます。それがあればhandleUploadを呼んでslotに入れる処理に繋げます。これにより**PCから直接スロットへ画像ドラッグ**でアップロードが可能になります。UX向上のためぜひ対応します。

- **CSS/レイアウト**: TailwindCSSを用いて実装します。既存プロジェクトはTailwind有効（tailwind-merge導入[\[56\]](https://github.com/Casboko/ReferenceSheetGenerator/blob/b13da112f71ba112eb4c331ff23adc45e29fc953/package.json#L14-L18)）なので設定済みでしょう。新UI用のCSSクラス（flex layoutやgrid, marginなど）を各要素に付与し、適宜レスポンシブメディアクエリ（Tailwindのmd:, sm:等）を使います。PolaroidCardコンポーネントも活かし、例えば参照スロット内表示や履歴サムネイルに使えそうです。要件とずれる部分（タイトル文言等）はテキスト差し替えます。Fontは既存でPermanent Markerなど読み込んでいます[\[57\]](https://github.com/Casboko/ReferenceSheetGenerator/blob/b13da112f71ba112eb4c331ff23adc45e29fc953/App.tsx#L36-L43)。デザインガイドはプロトタイピングしながら調整します。

- **CI/CD**: 今回MVP開発にはまずローカルで動作確認し、その後デプロイ（GitHub経由でVercelやCloud Run等）を行います。CI構築として、**GitHub Actions**でプッシュ時に型チェック・ビルド・簡易テストを回すワークフローを追加します。テンプレートを利用し、`npm install && npm run build && npm run test`程度を行うCIを設定。CDは、例えばVercelにNext.jsプロジェクトを接続すればプッシュ自動デプロイされます。Nodeサーバの場合はCloud RunにDockerで上げるなどが必要ですが、選択は要検討です（接続先顧客環境次第）。

以上が各ファイル・要素別の実装TODOです。MVP実装が完了したら、一通りE2Eテストを行い、要件に沿っているか確認します。特に**直前出力が混入しない**動作（トグルOFF時）や、3枚以上選べない制限、エラーハンドリングの表示あたりは念入りにチェックします。

## 7. テスト計画

実装後、品質を担保するため段階的にテストを行います。以下の観点でユニットテストから統合テストまで計画します。

- **ユニットテスト**:

- **ユーティリティ関数**: 例えばAsset寿命計算関数（expiresAtから残時間算出）や、Files APIレスポンス処理関数など個別の純粋関数はJest等で自動テストを書きます。

- **Geminiサービス**: バックエンドの`generateContent`呼び出し部分は外部API依存なのでモック化します。SDKの`ai.models.generateContent`をモックし、`responseModalities`やcontents構造が正しく組み立てられているか確認します（例えば3つ以上画像を渡したらエラーになるとか、candidateCount\>1設定時の処理とか）。また`inlineData`抽出→Filesアップロードまで通しで試すにはIntegration寄りになりますが、モックでinlineData含む偽レスポンスを与えてAssetが正しく生成されるか検証します。

- **フロントの状態管理**: 複雑な状態更新ロジック（特にトグルON時のslot移動、OFF時の復元など）は、Reactのコンポーネントをレンダリングせずロジック部分を関数化してテストします。例えば`applyLastOutputToggle(slotsBefore, lastOutputId)`が期待通りslots配列を返すかなどをチェックします。Edgeケース（slot埋まっているときトグルON/OFF、lastOutput無いときON、等）も試します。

- **結合テスト（Integration Test）**:

- **バックエンドAPI**: エンドポイントに対し、偽のGemini APIを立てて通しで試します。例えば`/api/generate`に対し、expressを立てJestでfetchして、Gemini側呼び出しをモックして所定のinlineDataを返すようにするなど。期待通り`GenerationResponse`が返ってくるか、エラー時500ステータスになるか検証します。

- **フロント＆バックエンド連携**: Next.jsなら`jest`や`react-testing-library`でフロントからAPIをコールする流れをテストできます。ファイルアップロード→generateまでシミュレートし、DOMに画像結果が表示されるかを確認します。モック画像を使い、アップロード後に参照slotにthumbが出現→生成ボタンクリック→ローディング→結果画像\<img\>要素出現、などUIの変化を疑似DOMで検査します。

- **ブラウザE2Eテスト**: 可能ならCypressやPlaywrightで実ブラウザ自動テストを導入します。シナリオ: 「画像ファイルをドラッグ→slot1にセット→テキスト入力→生成クリック→出力表示→直前出力トグルON→別画像ドラッグslot2→生成→新画像出力→新コンセプト押下→UI初期化確認」といった一連操作を自動化し、期待するDOM状態やAPI呼び出しが行われたか確認します。これにより**反復編集の合格率**（手順通り操作して期待通り画像変化するか）を確認します。

- **回帰テスト**:

- 既存のReferenceSheetGeneratorにあった機能（キャラターンアラウンド画像生成）が新アプリ内でも**シミュレート可能**か検証します。例えば旧アプリのPortrait+FullBody生成は、新アプリで「画像A（キャラ）+画像B（全方向頭部テンプレ）→生成（頭部シート）、続けて直前出力+画像C（全身ポーズテンプレ）→生成」で同様の結果が得られるかを試します。これは「過去機能が新実装でも実現可能である」ことを保証し、ReferenceSheetGeneratorの要件も満たせていることを確認する意味があります。

- UIの**異常系**: スロットに何も入れずテキストも空で生成押下したらどうなるか、極端に大きい画像（\>7MB）アップしたらどう処理されるか、などを手動含め検証します。大きい画像はアップロード時にエラーにするか、Files API的には2GBまでOKなので受け付け、モデルは7MB超ならエラーになる可能性があるのでバックエンドで事前チェック→413エラー返しするなど実装するか決め、その挙動テストをします。

- **性能テスト**:

- 1リクエストあたり画像3枚（合計例えば15MB）でもタイムアウトせず処理できるか、本番環境相当で計測します。特にバックエンド経由にすると通信2往復増えるため、許容範囲か確認（ブラウザ→サーバ、サーバ→Gemini）。この遅延を測定し、必要に応じて**並列処理**（複数ファイルupload並行、など）や、**プログレス表示**実装を検討します。例えば5MBの3枚=15MBアップロードは数秒かかる可能性あるため、UX向上策が必要か見極めます。

- レート制限近くまで連打した場合の挙動もテストします。自動で10回/秒押下をscriptで行い、適切に「待機中」or「リクエスト拒否」になるかを確認します。期待は二重送信防止でキューイングし、最後のを実行するなど。ここは必要に応じ**同時実行**を直列化する設計にしておくのが望ましいです。

テスト計画は以上ですが、リリース前には**ステークホルダーによる受け入れテスト**も行います。成功指標として、「N回連続の編集で内容が破綻しない（例: 5ターン連続で同じキャラが保持されている）」「新コンセプト切替後の生成に前のキャラが混ざらない率100%」「UI操作が直感的である（テストユーザ数名によるアンケート評価）」「既知バグが再現しない」といった点を確認します。

## 8. コスト・運用・監視

サービス運用段階で予想されるコスト、必要な運用タスク、監視項目を整理します。

- **API利用コスト**:

- *推定計算*: 画像生成1枚 ≈ \\0.04[\[13\]](https://developers.googleblog.com/en/introducing-gemini-2-5-flash-image/#:~:text=This%20model%20is%20available%20right,5%20Flash%20pricing)。仮に1ユーザが1日20回操作し各1枚生成で\\0.8/日。ユーザ100人規模なら\\80/日、月\\2400程度が上限見込み。出力枚数やThinking機能使わない前提なので大きくは増えません。**高画質長文**応答をさせるとトークン増で多少上振れしますが、主は画像トークン。従って**ユーザ数と生成頻度**がコストドライバです。

- *対策*: 過剰な連打を避けるUI制御（既に実装）や、利用ポリシーで節度を促す。必要なら**日次上限**を設定し、それ以上は警告するような仕組みを導入します。社内ツールならそこまでシビアでなくとも、**モデルプレビューステージ**ゆえAPI料金変動にも注意します。

- *Files APIコスト*: Files API自体は無料[\[12\]](https://ai.google.dev/gemini-api/docs/files#:~:text=You%20can%20use%20the%20Files,the%20Gemini%20API%20is%20available)ですが、アップロード/保存にストレージIO的コストが微小ながらかかる可能性があります（ただしドキュメント上は無料）。CDN的配信はないのでそこは無視可能。

- **サーバ・ストレージコスト**: Next.jsをVercel運用するなら月一定額程度（Hobbyなら無料枠内か）。Cloud Runなら使った分だけ（軽負荷想定なので微小）。**ストレージ**は基本Files API(無料)＋ユーザブラウザ上保存なので、本システムとしては極少です。Assetメタデータ保存をDBにする場合でも容量はごくわずか（文字情報のみ）。**ログ**保存するならそのサイズ次第ですが、テキストなので長期でも問題ありません。

- **監視（Monitoring）**:

- *可用性/エラーレート*: バックエンドAPIの応答率、エラー発生率を監視します。例えばCloud MonitoringやSentryを導入し、`/api/generate`の500エラーや応答時間をトラッキング。成功率が98%未満になったらアラートとか、応答遅延が平均5秒超ならSlack通知など設定します。

- *モデルエラー*: Gemini APIの応答で`lastError`やSafetyによるブロックが頻発していないか、バックエンドログに仕込みます。例えば「Content filter triggered」メッセージがどれくらい出るか統計を取り、ユーザが不適切な指示を多発していないか把握します。必要ならUIに「安全な利用を～」メッセージ表示や、悪用検知も視野に。

- *性能*（レイテンシ）: 各リクエストの処理時間を計測しログ出力。Gemini API自体が数秒かかるため全体では5~10秒程度想定ですが、もし大幅に遅延するケース（例えばFiles APIやネットワーク障害）は逐次検知します。フロントにもタイマー入れて、一定時間（15秒など）経過したらユーザに「時間がかかっています...」と案内する工夫も考えます。

- *リソース消費*（バックエンドCPU/Mem）: 画像バイナリ処理が多いので、CPUやRAM使用量も監視対象です。特にNodeは画像バッファを全メモリに持つので、100MB級が同時多数だとメモリ不足懸念があります。実運用で同時生成がどの程度か見極め、**並列数制限**や**Queue**の導入判断を行います（Gemini API自体もRPM500上限なので並列は自然とそこまで増えない想定ですが、前後処理含め慎重に）。

- *Files使用量*: Files APIは20GB上限なので、現在のアップロード総容量を定期チェックします。48hで自動消去されるとはいえ、一気に大人数が高頻度アップすると20GBに達するリスクがあります。実際には2日間の合計生成量が20GB超（例えば1画像500KBとして4万枚）などまず無いと思われますが、念のため`files.list`で件数や総量を監視し、閾値超なら警告します。ユーザには不要ファイルは都度削除できるUIも提供予定です。

- **運用タスク**:

- *ログ管理*: ログにはリクエストパラメータ（Asset IDs, テキスト長など）とレスポンス概要（成功/失敗, 処理時間, 生成画像IDなど）を記録します。個人情報となるユーザアップ画像を直接保存しない（内容テキスト化もしない）方針とし、あくまでメタデータのみにします。ログはバックエンドサーバのstdoutもしくは外部ログ収集（Stackdriver, Datadog等）を使い、問題発生時に解析可能にします。**デバッグ**目的で一時的にBase64全長やファイル名をログ出力することはあっても、本番では控えます。

- *エラー対応フロー*: ユーザ報告や自動アラートを受けた際、原因調査→緊急パッチ適用までの手順を決めます。たとえばモデルAPIが一時停止した場合、一時的にUIで「サービスメンテ中」の表示に切り替えるなど運用対処します。バックエンドの再起動要件（メモリリーク対策で定期Restartなど）も検討します。

- *モデルアップデート対応*: Google側でモデルがGA版に移行・Preview終了する際、モデルID変更（例えば`gemini-2.5-flash-image`になる可能性）やAPI仕様変更が予想されます。公式発表[\[58\]](https://cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/2-5-flash#:~:text=Versions)をウォッチしつつ、適宜コード中のモデル名定数やパラメータを更新します。こうした変更への追随コストも運用として見積もっておきます。

- **セキュリティ運用**:

- APIキーの漏洩監視: リポジトリにキーをコミットしないのは当然として、公開環境でキーが万一露出した際の検知（Google Cloudコンソールで不審な使用量が無いか、GitHubのSecretスキャン）も行います。キーは必要に応じローテーションします。

- ユーザアップ画像の扱い: サービス提供者としてはユーザのアップロードした画像を勝手に利用しない、一定期間後に削除するなどプライバシー配慮が必要です。Files APIは48hで自動削除なので大半カバーされますが、フロントに残るBase64やダウンロード履歴などには注意を喚起します。規約や利用ガイドラインを提示し、AI生成物の二次利用ポリシー（商用利用可否などGoogleの規約準拠）も明示します。

- 画像安全対策: モデル出力はSynthIDでトラッキングできますが、不適切画像（例: 現実人物似顔絵など規約違反）はモデル側で抑制されています。それでも漏れた場合に備え、**ユーザからのフィードバック機能**（「不適切を報告」ボタン）を用意し、報告があれば運営が該当Assetを確認・削除する運用とします。出力画像に透かし検出ツール（DeepMind提供予定のSynthID検出器）が将来あれば、それを用いてAI生成であることを裏付けデータとして記録することも検討します。

## 9. リスクと対応策

本プロジェクトにおける技術的・運用上のリスクと、その緩和策・代替案を整理します。

- **モデル仕様変更**: Gemini 2.5 Flash Image Previewはまだプレビュー段階であり、将来**API仕様や制限が変わるリスク**があります。例えば入力画像数やサイズ上限、料金体系の変更、あるいはモデルIDの名称変更などです。*対応策*: 常に公式ドキュメントの更新をチェックし、変更があれば迅速にコードを改修します。モデルが非推奨・停止となった場合には後継モデル（2.5 Flash ImageのGA版、あるいはImagen系モデル）への切替を検討します。コード上はモデルIDを定数化してあり、一箇所変更で済むようにしておきます。
- **レート制限超過**: 想定以上の利用があり、Gemini APIから429エラー（Too Many Requests）が返るリスクがあります[\[59\]](https://ai.google.dev/gemini-api/docs/rate-limits#:~:text=Your%20usage%20is%20evaluated%20against,your%20TPM%20or%20other%20limits)。*対応策*: フロント側で連打を抑制するUIの他、バックエンドで**リクエストキュー**を実装し、同時に捌く数を制限します。例えば1ユーザにつき1リクエストまで、それ以上は待たせる/拒否する設定。またGoogleに申し込みTierアップすれば上限緩和も可能[\[60\]](https://ai.google.dev/gemini-api/docs/rate-limits#:~:text=Usage%20tiers)[\[61\]](https://ai.google.dev/gemini-api/docs/rate-limits#:~:text=Gemini%202,50)。一時的な急増なら**指数的バックオフ**で自動再試行し、ユーザには「混み合っています」と表示するなどUX対応します。恒常的に上限近いなら、**画像生成ジョブを非同期に受け付け後で結果通知**（メールやWebSocketで）する運用も検討します。だたしリアルタイム性が重要な本ツールでは優先度低です。
- **コスト暴騰**: ユーザ予想を超える利用や悪意ある過剰使用で課金額が急増するリスク。*対応策*: まず**Google Cloudの予算アラート**を設定し、閾値超で通知・自動停止するようにします。アプリ側でも**ユーザあたりの上限**（例: 1日50枚まで無料、それ以上は要承認）を設け、超過時はそれ以上生成させない仕組みを導入可能です。また将来的に**ユーザ登録＆課金**システムを組み込み、ヘビーユーザにはコスト負担してもらうモデルも検討します。
- **大容量画像の取扱**: ユーザが超高解像度画像（例えば20MBのPNG）をアップした場合、Files API上は問題なくてもフロントの表示・処理やバックエンド経由送信で負荷がかかります。*対応策*: **ダウンサンプリング**を自動適用します。例えばアップロード時に`<img>`を用いてCanvasで1280px程度に縮小する、またはバックエンドでSharp等画像ライブラリを使いリサイズする方法です。モデルへの効果も、あまりに大きい画像より適度なサイズの方が処理しやすいと思われます（公式に最適サイズ言及は無いが、1024px出力ならそれ以上は効果薄と推測）。なおDocumentsとしてPDFも送れますが今回は対象外です。ダウンサンプリングにより色や細部劣化のリスクはありますが、安全運用上は許容します。ユーザに「高解像度は自動縮小されます」と注記しておきます。
- **大量同時利用**: 同時に多数のユーザがアクセスした際、サーバやAPIが耐えられない可能性。*対応策*: バックエンドをスケーラブルな環境（Serverless, Auto-scaling containers）で動かし、急な負荷にも対応します。しかしGemini API自体にproject単位制限があり、結局500RPM(Tier1)の壁はあるので**ユーザ招待制**や**意図的にユーザ数を絞る**運用を最初行い、負荷を慣らします。仮に大規模公開するならGoogleと相談してQuota増枠の契約も検討します。
- **ファイル期限切れ**: 48hを過ぎて参照したいAssetがFiles上から消えると、モデルに渡しても404エラーとなります[\[2\]](https://ai.google.dev/gemini-api/docs/files#:~:text=Usage%20info)。*対応策*: Asset一覧に表示する寿命インジケータでユーザに期限を意識させるとともに、**期限間近のAssetを再アップロード**する機能を用意します。例えば残り1時間を切ったAssetを参照に選んだ際、自動でバックエンドがファイルを再Uploadして新しいfileUriを発行・更新する処理を挟みます。あるいはユーザに「この画像の期限が近いため更新します」ダイアログを出し承諾後実行する形でも良いでしょう。根本的にはPersistしたい画像は別に**永続ストレージ**（Google Cloud Storage等）に保存し、Gemini APIにはFileではなく**公開URLを渡す**手もあります（Gemini APIはネット上の画像URLは直接使えませんが、**URLコンテキスト機能**で追加できる可能性あり[\[62\]](https://googlecloudplatform.github.io/applied-ai-engineering-samples/genai-on-vertex-ai/gemini/prompting_recipes/multimodal/multimodal_prompting_image/#:~:text=Multimodal%20Prompting%20with%20Gemini%3A%20Working,0)）。ただ公開URLはセキュリティ課題があるため、MVPでは扱いません。
- **バックエンドダウン時のフォールバック**: バックエンドが不調の場合、現在の実装だとフロントからGemini API直呼びするfallbackも難しい（CORSやキー露出問題あり）。*対応策*: 可用性高い構成（例えばVercel冗長化、Cloud Run max-instances設定など）でバックエンドダウンを避けます。どうしても落ちた場合は**緊急モード**として一時的にフロント直呼び機能を有効にする開発者スイッチを仕込む案もあります。ただリスク高なので、運用でダウンを迅速に検知・復旧する体制を整える方が現実的です。
- **モデル非対応時フォールバック**: 仮にGemini 2.5 Flash Imageが何らかの理由で使えなくなった場合、**代替モデル**を検討します。Google内ではImagenが類似出力可能ですがAPI非公開です。オープンソースではStable Diffusion等ありますが、**画像+画像+テキストの合成**という同等機能は難しく、置換すると製品価値が変わります。段階的フォールバックとして、Geminiの**画像理解**能力だけ使い、出力はImagen 3などで生成する2段構成も理論上可能です（Whiskがまさにそれをしているように[\[63\]](https://www.maginative.com/article/meet-whisk-googles-new-visual-first-approach-to-ai-image-generation/#:~:text=drag%20and%20drop%20reference%20images,approach%20is%20funky%20and%20fun)[\[64\]](https://www.maginative.com/article/meet-whisk-googles-new-visual-first-approach-to-ai-image-generation/#:~:text=,3%20to%20create%20new%20variations)）。つまり参照画像→Geminiがテキスト説明生成→それを他の画像モデルへ投入する方法。ただ、精密なキャラ一貫性は失われるでしょう。従ってこれは**最終手段**であり、リスク顕在化時に改めて評価します。基本はGeminiサービス継続利用を前提にします。
- **コンテンツの正確性**: マルチターン編集で**キャラクターの特徴が徐々にブレる**等のリスクがあります。例えば何度も変換すると顔が変わってしまう等。これはモデルの限界によるため、**中間にユーザ確認**を挟むUXで対処します。一気に10ターン進ませず、各ターンで「OKか?」確認し、ブレてきたら一度オリジナルとの再比較→必要なら参照に初期画像をまた加えるなどの指導をドキュメントします。また「クリップアウト」という機能（Geminiでは未公開ですが）で特定領域を維持するテクもあるかもしれませんが、現状は**ユーザが上手く画像を組み合わせる**形に委ねます。このリスクは評価指標（キャラ持ち越し率）でモニタし、大きな問題なら例えば**2段階生成プロンプト**（現在もFullBodyでやっているように）をテンプレとして提供するなど、アプリ側でモデルを助ける方向も検討します。

## 10. ロードマップ

MVPから拡張機能、ベータ版リリースまでのステップをマイルストーン形式で示します。

- **Milestone 1: MVP実装完了（～2週間）**  
  *機能*: 3参照画像＋直前出力トグルUI、単一画像生成、一人のユーザが想定通り編集できる。バックエンド導入済みだが簡易。  
  *受入基準*:

  - 画像を2枚まで参照に選びテキスト指示で新画像を得られる。
  - トグルONで前出力を再利用して変化をつけられる（例: 色変更→背景変更と2ターンできる）。
  - 新コンセプトボタンで前の内容が影響しない新規生成ができる（旧画像混入ゼロ【例えば黒髪キャラ→新規→金髪指示で黒髪混ざらない】）。
  - APIキーがフロントに露出していない。
  - 基本的なエラーケース（大画像アップ、空入力など）で適切なメッセージが出る。
  - コードがレビューで致命的問題なく、READMEに簡単な起動方法と注意が記載されている。

- **Milestone 2: 基盤拡張（+1〜2週間）**  
  *内容*: セキュリティ・性能・信頼性を向上させる改良を実施。具体的には:

  - **アセット一覧UI**実装（寿命表示含む）。
  - **複数画像出力**オプション（candidateCount選択UI、ギャラリー表示と選択機能）。
  - **ドラッグ&ドロップUX洗練**（プレビューやハイライト効果）。
  - **ユニット/統合テスト充実**とCIセットアップ。
  - **エラーメッセージの国際化**や調整（ユーザフレンドリな文言に）。
  - **コストガード**（一定以上生成で警告）。
  - **ログ収集/アラート**仕込み。 *受入基準*:
  - 5人程度のテストユーザに触ってもらい、「操作が直感的である」とのフィードバックが得られる（例えばWhisk経験者に試してもらう）。
  - 重大バグなしで1日50リクエスト程度の負荷テストを通過する（例: 並列5ユーザで各10回操作）。
  - CI上で全テストグリーン、コード品質指標（ESLint, Prettier適用など）クリア。

- **Milestone 3: ベータ版公開（+2週間）**  
  *内容*: 機能面完成。**ユーザ管理/保護**など運用面考慮:

  - 認証や利用ログイン仕組み（もし社内限定ならGoogle OAuth等で限定公開）。
  - 利用規約・プライバシーポリシー明示、SynthID透かしの注意文言をUIに表示。
  - バージョン情報・フィードバックフォーム追加。
  - 軽微なUI改善（レスポンシブ最終調整、デザイン磨き）。
  - **本番ホスティング**環境での検証と調整（ドメイン設定、HTTPS確認）。 *受入基準*:
  - 実際のユーザ5〜10名程度で数日試用してもらい、大きな不具合報告が無い。
  - 監視アラートが正常動作し、異常検知テストで通知受け取れる。
  - ステークホルダーとの最終レビューで仕様満たしていると合意得る。

- **将来の拡張** (Roadmap beyond Beta):

- **共同編集/共有**: マルチユーザで編集内容を共有したり、生成結果をギャラリーに投稿・共有する機能。

- **モバイル最適化**: スマホでの操作性向上（ドラッグ難しいのでファイル選択誘導など）。

- **他モデル対応**: 例えば音声合成や動画生成（Veo）との組合せアプリへの発展。

- **評価指標に基づく改善**: 例として「持ち越しゼロ率」をさらに高めるため、ユーザが間違って過去Asset混入しないようUIガイダンスを強化、などPDCAを回します。Whiskとの比較調査も継続し、良いUXは積極的に取り入れます。

以上をもって、本プロジェクトの包括的な実装計画・検証戦略を示しました。今後は上記ロードマップに従い段階的に開発・展開を進め、ユーザにとって快適かつ信頼性の高い画像生成体験を提供していきます。

## 付録

**A. 主要コード断片（最小実装例）**:

以下はGemini API呼び出しおよびFiles API利用の**最小例**をTypeScriptで示したものです。実際の実装ではエラーハンドリングや非同期制御を適切に行いますが、概念理解のため簡略化しています。

    import { GoogleGenAI, Modality, createPartFromUri } from "@google/genai";
    // 環境変数からAPIキー取得（バックエンド環境下）
    const apiKey = process.env.GEMINI_API_KEY!;
    const ai = new GoogleGenAI({ apiKey });

    // 例: すでに Files API にアップロード済みの画像ファイルURIとMIMEタイプ
    const fileUri1 = "generativelanguage.googleapis.com/v1beta/files/PROJECT/locations/LOCATION/files/123";
    const mimeType1 = "image/png";
    // 他の参照画像（2枚目, オプション）
    const fileUri2 = "generativelanguage.googleapis.com/v1beta/files/PROJECT/locations/LOCATION/files/456";
    const mimeType2 = "image/jpeg";
    // ユーザの指示テキスト
    const userPrompt = "最初の画像のキャラクターを2番目の画像の背景に合成してください。";

    // generateContent 呼び出し組み立て
    const parts = [
      createPartFromUri(fileUri1, mimeType1),  // 参照画像1
      createPartFromUri(fileUri2, mimeType2),  // 参照画像2（なければ省略可）
      { text: userPrompt }                     // テキストプロンプト
    ];
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-image-preview",
      contents: parts,
      config: { responseModalities: [Modality.IMAGE, Modality.TEXT] }
    });
    // 応答処理
    const imageParts = response.candidates[0].content.parts;
    for (const part of imageParts) {
      if (part.text) {
        console.log("モデル応答テキスト:", part.text);
      } else if (part.inlineData) {
        // 受け取った画像を保存する例（Bufferに変換しファイル出力）
        const buffer = Buffer.from(part.inlineData.data, "base64");
        require("fs").writeFileSync("output.png", buffer);
        console.log("生成画像を output.png として保存しました");
      }
    }

上記コードでは2枚の参照画像（`fileUri1`, `fileUri2`）とテキストをまとめてGeminiに送り、画像とテキスト両方の出力を取得しています。**重要**: `responseModalities: ["TEXT","IMAGE"]` を指定することで、モデルから画像が返ってきます[\[6\]](https://cloud.google.com/vertex-ai/generative-ai/docs/multimodal/image-generation#:~:text=%7D%27%202)。また`createPartFromUri`によりFiles API上の画像を参照パートとして渡しています[\[51\]](https://ai.google.dev/gemini-api/docs/files#:~:text=model%3A%20%22gemini,%5D%29%2C)。モデル応答からは`part.inlineData.data`でBase64の画像バイト列が取得でき、それを保存・表示できます[\[50\]](https://developers.googleblog.com/en/introducing-gemini-2-5-flash-image/#:~:text=for%20part%20in%20response.candidates,generated_image.png)。

**B. 出荷前/運用前チェックリスト**:

開発完了後、リリース前に確認すべき項目をリストアップします。

- \[ \] **仕様適合**: モデルID・モダリティ指定など仕様通りか（公式Doc再チェック済み[\[4\]](https://cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/2-5-flash#:~:text=Input%20size%20limit%20500%20MB,Technical%20specifications%20Images%20photo)[\[6\]](https://cloud.google.com/vertex-ai/generative-ai/docs/multimodal/image-generation#:~:text=%7D%27%202)）。
- \[ \] **APIキー秘匿**: `.env`運用やバックエンド化でキーが露出していない。
- \[ \] **大容量テスト**: 6MB程度の画像3枚入力で正常動作、レスポンス時間許容範囲か。
- \[ \] **エラー挙動**: オフライン時/429時などエラーケースでユーザにわかりやすいメッセージが出る。
- \[ \] **透かし/注意**: UIに「生成画像にはデジタル透かしが埋め込まれます」等の表記をどこかに記載済み。
- \[ \] **ライセンス**: プロジェクト内ライブラリのライセンスや、引用画像（テンプレート画像Face.png等）の出所明記。Apache-2.0表記も残す[\[65\]](https://github.com/Casboko/ReferenceSheetGenerator/blob/b13da112f71ba112eb4c331ff23adc45e29fc953/lib/prompts.ts#L2-L5)。
- \[ \] **依存更新**: `@google/genai`など最新安定版を利用。将来rename（例えばgoogle-ai-sdkとか）に備え対応可能に。
- \[ \] **セキュリティ**: HTTP経由でAPIキー送信していないか（https必須）。ユーザ画像保存先は限定アクセスか。バックエンドに不要ポート開放無いか。
- \[ \] **パフォーマンス**: 初回ロードで不要な巨大ライブラリ読み込んでいないか（バンドルサイズ確認）。画像は\<img\>遅延読み込みを必要に応じ設定。
- \[ \] **アクセシビリティ**: altテキスト適切設定、色使いコントラスト、キーボード操作可能性を軽く検証。
- \[ \] **モニタリング**: ログ/メトリクスが実際出力されているかテスト環境で確認。アラートは意図通り発報するかテスト。
- \[ \] **バックアップ**: 万一Files API不調のときの代替や、重要Asset（できればユーザダウンロード以外はない想定だが）のバックアップ戦略検討。

**C. 未確定事項と選択肢の検討**:

プロジェクト進行中に明確にすべき点、および考えられる選択肢をまとめます。

- **バックエンド技術スタック**: 今回Next.js（Node）案を示しましたが、*代替*: Python FastAPI + frontend別ホストの構成もあり得ます。メリットはGoogle公式Python SDKが充実している点や、画像処理ライブラリ（PIL等）活用しやすいこと。一方で既存TS資産を活かしにくい。*推奨*: TypeScriptで一貫しており開発効率良いNext.js案。
- **モデルのプロンプト設計**: ユーザ自由入力に任せていますが、*代替*: テキスト生成AIでユーザプロンプトを補助・修正する案もあります（例: 短すぎる指示に自動で詳細付加）。WhiskのようにGeminiが画像から説明文を生成→Imagen実行というプロンプト補完手法も検討価値があります。ただ現状は複雑化するため*MVPでは不採用*、将来の改善オプションに留めます。
- **複数画像出力UI**: 1リクエストで複数画像が出せますが、UIでどう見せるか未確定です。*案1*: サムネイル一覧で全部表示し、ユーザが1つ選んで「これを次に使う」ボタン。*案2*: 1枚ずつ表示と「次へ」ボタンで順に見せる。迷いやすいので*MVPではシングル出力*に限定し、ユーザからの要望次第で実装します。
- **画像の恒久保存**: Files API任せで48h制限がありますが、ユーザが1週間後に前画像を使いたいケースは起こり得ます。*案*: ユーザ端末に保存を促す or サーバに安全に蓄積する。後者はストレージ費用や権利管理の課題あり。*推奨*: 現段階では48h以内の短期利用想定とし、恒久利用はユーザ自身にダウンロードしてもらう運用とします（UIにその旨注意を出す）。
- **「再生成」機能**: Seed指定や乱数変更で微妙なバリエーションを得る機能（Stable Diffusionにはある）ですが、Gemini APIではコントロールできません（温度を変えるぐらい）。*案*: 温度パラメータ調整UIや、「もう一度同じ指示で生成」ボタンを用意。後者は`lastOutputId`を参照から除いて同じpromptをもう一度送る想定ですが、Geminiは同じ入力ならほぼ同じ出力になる可能性が高いです（温度1.0でも劇的には変わらない？未検証）。*現状*: この機能は優先度低と判断し、必要ならcandidateCount\>1でまとめて出して選ばせる方式で代替します。
- **モバイルUI**: パソコン向けUIを前提に設計しています。スマホでドラッグ操作は難しく、*代替UI*: 参照枠をタップ→ファイル選択→埋め込み、や過去生成をリストからタップ選択など。画面狭く出力プレビューも小さくなります。対応は検討事項ですが、**タブレット以上推奨**と案内する方針もあります。現実にはスマホ需要高いかもしれないので、β以降の課題として残します。

以上、未定事項は今後の議論とユーザヒアリングで方向付けし、必要に応じて計画修正します。現時点での推奨案を示しつつ、柔軟に対応できるよう備えておきます。

------------------------------------------------------------------------

[\[1\]](https://cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/2-5-flash#:~:text=Images%20photo) [\[3\]](https://cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/2-5-flash#:~:text=Note%3A%20To%20use%20the%20,Supported%20inputs%20%26%20outputs) [\[4\]](https://cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/2-5-flash#:~:text=Input%20size%20limit%20500%20MB,Technical%20specifications%20Images%20photo) [\[7\]](https://cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/2-5-flash#:~:text=,image%2Fwebp) [\[10\]](https://cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/2-5-flash#:~:text=%2A%20Temperature%3A%200.0,default%201) [\[46\]](https://cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/2-5-flash#:~:text=,Chat%20completions) [\[58\]](https://cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/2-5-flash#:~:text=Versions) Gemini 2.5 Flash  \|  Generative AI on Vertex AI  \|  Google Cloud

<https://cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/2-5-flash>

[\[2\]](https://ai.google.dev/gemini-api/docs/files#:~:text=Usage%20info) [\[12\]](https://ai.google.dev/gemini-api/docs/files#:~:text=You%20can%20use%20the%20Files,the%20Gemini%20API%20is%20available) [\[48\]](https://ai.google.dev/gemini-api/docs/files#:~:text=async%20function%20main%28%29%20,%7D%2C) [\[49\]](https://ai.google.dev/gemini-api/docs/files#:~:text=const%20response%20%3D%20await%20ai.models.generateContent%28,%5D%29%2C) [\[51\]](https://ai.google.dev/gemini-api/docs/files#:~:text=model%3A%20%22gemini,%5D%29%2C) Files API  \|  Gemini API  \|  Google AI for Developers

<https://ai.google.dev/gemini-api/docs/files>

[\[5\]](https://cloud.google.com/vertex-ai/generative-ai/docs/multimodal/image-generation#:~:text=Gemini%202,modalities%2C%20including%20text%20and%20images) [\[6\]](https://cloud.google.com/vertex-ai/generative-ai/docs/multimodal/image-generation#:~:text=%7D%27%202) [\[8\]](https://cloud.google.com/vertex-ai/generative-ai/docs/multimodal/image-generation#:~:text=generate%20long%20form%20text,interleaved) [\[9\]](https://cloud.google.com/vertex-ai/generative-ai/docs/multimodal/image-generation#:~:text=%2A%20Example%20prompt%3A%20,interleaved) [\[16\]](https://cloud.google.com/vertex-ai/generative-ai/docs/multimodal/image-generation#:~:text=response_modalities%3D%5BModality.TEXT%2C%20Modality.IMAGE%5D%2C%20candidate_count%3D1%2C%20safety_settings%3D%5B%20%7B,%5D%2C%20%29%2C) [\[47\]](https://cloud.google.com/vertex-ai/generative-ai/docs/multimodal/image-generation#:~:text=Note%3A%20Multimodal%20response%20generation%20is,flash) Generate images with Gemini  \|  Generative AI on Vertex AI  \|  Google Cloud

<https://cloud.google.com/vertex-ai/generative-ai/docs/multimodal/image-generation>

[\[11\]](https://developers.googleblog.com/en/introducing-gemini-2-5-flash-image/#:~:text=All%20images%20created%20or%20edited,generated%20or%20edited) [\[13\]](https://developers.googleblog.com/en/introducing-gemini-2-5-flash-image/#:~:text=This%20model%20is%20available%20right,5%20Flash%20pricing) [\[50\]](https://developers.googleblog.com/en/introducing-gemini-2-5-flash-image/#:~:text=for%20part%20in%20response.candidates,generated_image.png) Introducing Gemini 2.5 Flash Image, our state-of-the-art image model - Google Developers Blog

<https://developers.googleblog.com/en/introducing-gemini-2-5-flash-image/>

[\[14\]](https://ai.google.dev/gemini-api/docs/rate-limits#:~:text=Gemini%202,10) [\[15\]](https://ai.google.dev/gemini-api/docs/rate-limits#:~:text=%28TPD%29) [\[59\]](https://ai.google.dev/gemini-api/docs/rate-limits#:~:text=Your%20usage%20is%20evaluated%20against,your%20TPM%20or%20other%20limits) [\[60\]](https://ai.google.dev/gemini-api/docs/rate-limits#:~:text=Usage%20tiers) [\[61\]](https://ai.google.dev/gemini-api/docs/rate-limits#:~:text=Gemini%202,50) Rate limits  \|  Gemini API  \|  Google AI for Developers

<https://ai.google.dev/gemini-api/docs/rate-limits>

[\[17\]](https://github.com/Casboko/ReferenceSheetGenerator/blob/b13da112f71ba112eb4c331ff23adc45e29fc953/package.json#L6-L14) [\[18\]](https://github.com/Casboko/ReferenceSheetGenerator/blob/b13da112f71ba112eb4c331ff23adc45e29fc953/package.json#L11-L19) [\[56\]](https://github.com/Casboko/ReferenceSheetGenerator/blob/b13da112f71ba112eb4c331ff23adc45e29fc953/package.json#L14-L18) package.json

<https://github.com/Casboko/ReferenceSheetGenerator/blob/b13da112f71ba112eb4c331ff23adc45e29fc953/package.json>

[\[19\]](https://github.com/Casboko/ReferenceSheetGenerator/blob/b13da112f71ba112eb4c331ff23adc45e29fc953/services/geminiService.ts#L5-L13) [\[20\]](https://github.com/Casboko/ReferenceSheetGenerator/blob/b13da112f71ba112eb4c331ff23adc45e29fc953/services/geminiService.ts#L75-L83) [\[21\]](https://github.com/Casboko/ReferenceSheetGenerator/blob/b13da112f71ba112eb4c331ff23adc45e29fc953/services/geminiService.ts#L86-L94) [\[22\]](https://github.com/Casboko/ReferenceSheetGenerator/blob/b13da112f71ba112eb4c331ff23adc45e29fc953/services/geminiService.ts#L96-L105) [\[23\]](https://github.com/Casboko/ReferenceSheetGenerator/blob/b13da112f71ba112eb4c331ff23adc45e29fc953/services/geminiService.ts#L118-L126) [\[24\]](https://github.com/Casboko/ReferenceSheetGenerator/blob/b13da112f71ba112eb4c331ff23adc45e29fc953/services/geminiService.ts#L118-L125) [\[25\]](https://github.com/Casboko/ReferenceSheetGenerator/blob/b13da112f71ba112eb4c331ff23adc45e29fc953/services/geminiService.ts#L15-L23) [\[26\]](https://github.com/Casboko/ReferenceSheetGenerator/blob/b13da112f71ba112eb4c331ff23adc45e29fc953/services/geminiService.ts#L116-L124) [\[27\]](https://github.com/Casboko/ReferenceSheetGenerator/blob/b13da112f71ba112eb4c331ff23adc45e29fc953/services/geminiService.ts#L126-L134) [\[28\]](https://github.com/Casboko/ReferenceSheetGenerator/blob/b13da112f71ba112eb4c331ff23adc45e29fc953/services/geminiService.ts#L138-L146) [\[29\]](https://github.com/Casboko/ReferenceSheetGenerator/blob/b13da112f71ba112eb4c331ff23adc45e29fc953/services/geminiService.ts#L134-L142) [\[43\]](https://github.com/Casboko/ReferenceSheetGenerator/blob/b13da112f71ba112eb4c331ff23adc45e29fc953/services/geminiService.ts#L112-L120) [\[53\]](https://github.com/Casboko/ReferenceSheetGenerator/blob/b13da112f71ba112eb4c331ff23adc45e29fc953/services/geminiService.ts#L96-L104) [\[54\]](https://github.com/Casboko/ReferenceSheetGenerator/blob/b13da112f71ba112eb4c331ff23adc45e29fc953/services/geminiService.ts#L140-L145) geminiService.ts

<https://github.com/Casboko/ReferenceSheetGenerator/blob/b13da112f71ba112eb4c331ff23adc45e29fc953/services/geminiService.ts>

[\[30\]](https://github.com/Casboko/ReferenceSheetGenerator/blob/b13da112f71ba112eb4c331ff23adc45e29fc953/App.tsx#L62-L70) [\[31\]](https://github.com/Casboko/ReferenceSheetGenerator/blob/b13da112f71ba112eb4c331ff23adc45e29fc953/App.tsx#L76-L84) [\[32\]](https://github.com/Casboko/ReferenceSheetGenerator/blob/b13da112f71ba112eb4c331ff23adc45e29fc953/App.tsx#L64-L72) [\[33\]](https://github.com/Casboko/ReferenceSheetGenerator/blob/b13da112f71ba112eb4c331ff23adc45e29fc953/App.tsx#L99-L108) [\[34\]](https://github.com/Casboko/ReferenceSheetGenerator/blob/b13da112f71ba112eb4c331ff23adc45e29fc953/App.tsx#L123-L131) [\[35\]](https://github.com/Casboko/ReferenceSheetGenerator/blob/b13da112f71ba112eb4c331ff23adc45e29fc953/App.tsx#L101-L109) [\[36\]](https://github.com/Casboko/ReferenceSheetGenerator/blob/b13da112f71ba112eb4c331ff23adc45e29fc953/App.tsx#L232-L240) [\[37\]](https://github.com/Casboko/ReferenceSheetGenerator/blob/b13da112f71ba112eb4c331ff23adc45e29fc953/App.tsx#L244-L253) [\[38\]](https://github.com/Casboko/ReferenceSheetGenerator/blob/b13da112f71ba112eb4c331ff23adc45e29fc953/App.tsx#L152-L161) [\[39\]](https://github.com/Casboko/ReferenceSheetGenerator/blob/b13da112f71ba112eb4c331ff23adc45e29fc953/App.tsx#L180-L189) [\[40\]](https://github.com/Casboko/ReferenceSheetGenerator/blob/b13da112f71ba112eb4c331ff23adc45e29fc953/App.tsx#L199-L208) [\[41\]](https://github.com/Casboko/ReferenceSheetGenerator/blob/b13da112f71ba112eb4c331ff23adc45e29fc953/App.tsx#L29-L37) [\[44\]](https://github.com/Casboko/ReferenceSheetGenerator/blob/b13da112f71ba112eb4c331ff23adc45e29fc953/App.tsx#L109-L117) [\[52\]](https://github.com/Casboko/ReferenceSheetGenerator/blob/b13da112f71ba112eb4c331ff23adc45e29fc953/App.tsx#L79-L87) [\[55\]](https://github.com/Casboko/ReferenceSheetGenerator/blob/b13da112f71ba112eb4c331ff23adc45e29fc953/App.tsx#L53-L61) [\[57\]](https://github.com/Casboko/ReferenceSheetGenerator/blob/b13da112f71ba112eb4c331ff23adc45e29fc953/App.tsx#L36-L43) App.tsx

<https://github.com/Casboko/ReferenceSheetGenerator/blob/b13da112f71ba112eb4c331ff23adc45e29fc953/App.tsx>

[\[42\]](https://github.com/Casboko/ReferenceSheetGenerator/blob/b13da112f71ba112eb4c331ff23adc45e29fc953/lib/prompts.ts#L8-L16) [\[65\]](https://github.com/Casboko/ReferenceSheetGenerator/blob/b13da112f71ba112eb4c331ff23adc45e29fc953/lib/prompts.ts#L2-L5) prompts.ts

<https://github.com/Casboko/ReferenceSheetGenerator/blob/b13da112f71ba112eb4c331ff23adc45e29fc953/lib/prompts.ts>

[\[45\]](https://github.com/Casboko/ReferenceSheetGenerator/blob/b13da112f71ba112eb4c331ff23adc45e29fc953/vite.config.ts#L6-L14) vite.config.ts

<https://github.com/Casboko/ReferenceSheetGenerator/blob/b13da112f71ba112eb4c331ff23adc45e29fc953/vite.config.ts>

[\[62\]](https://googlecloudplatform.github.io/applied-ai-engineering-samples/genai-on-vertex-ai/gemini/prompting_recipes/multimodal/multimodal_prompting_image/#:~:text=Multimodal%20Prompting%20with%20Gemini%3A%20Working,0) Multimodal Prompting with Gemini: Working with Images

<https://googlecloudplatform.github.io/applied-ai-engineering-samples/genai-on-vertex-ai/gemini/prompting_recipes/multimodal/multimodal_prompting_image/>

[\[63\]](https://www.maginative.com/article/meet-whisk-googles-new-visual-first-approach-to-ai-image-generation/#:~:text=drag%20and%20drop%20reference%20images,approach%20is%20funky%20and%20fun) [\[64\]](https://www.maginative.com/article/meet-whisk-googles-new-visual-first-approach-to-ai-image-generation/#:~:text=,3%20to%20create%20new%20variations) Meet Whisk, Google's New Visual-First Approach to AI Image Generation

<https://www.maginative.com/article/meet-whisk-googles-new-visual-first-approach-to-ai-image-generation/>
