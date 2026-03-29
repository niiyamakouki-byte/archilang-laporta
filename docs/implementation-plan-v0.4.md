# archilang v0.4 実装計画

> 2026-03-29 作成 — Claude (opus-4.6) + Codex (gpt-5.3) 統合分析
> 前提: scaling-roadmap.md の Tier 分類を踏まえつつ、現フェーズでの最適戦略を再評価

## 方針: 今は「磨く段階」

Tier 3（多層階・GUI・LLM統合）への着手は **時期尚早**。理由:

1. **基盤の信頼性が不十分** — 明示壁のownership不足、開口部重複未検出など、出力を信頼できない場面がある
2. **多層階はデータモデル再設計を伴う** — 現在の技術的負債を抱えたまま進むと広範囲リライトになる
3. **LLM統合は堅牢なコアが前提** — 生成先のエンジンが不安定では検証バックエンドとして成立しない

代わりに、**単一階の完成度を上げつつ、ユーザー獲得チャネルを並行して整備する**。

---

## Phase 1: コア信頼性の確立（〜2週間） ✅ 完了 (2026-03-29)

既知の技術的課題のうち、出力信頼性に直結するものを解消する。

### 1-1. 明示壁の room ownership 付与 ✅

- **対象**: `resolver.ts:470`
- **問題**: 明示壁（`explicit_only` / `additive`）が `rooms: []` のまま。内壁/外壁の分類が不正確になり、wall-renderer の描き分け・validator の到達性チェックが壊れる
- **方針**: 明示壁の各edgeに対し、隣接する部屋を幾何的に判定して `rooms` を埋める。自動壁と同じ ownership ロジックを共有
- **テスト**: 既存の `walls-explicit.test.ts` を拡張し、ownership の正確性を検証
- **実装**: `assignRoomsToWalls()` を追加。`extractRoomPerimeterEdges()` を再利用し、部屋の外周辺との重なりでのみ ownership を付与（内部パーティション壁は対象外）。Codex レビュー7ラウンドで品質確認済み

### 1-2. 開口部重複検出 ✅

- **対象**: `resolver.ts:530`
- **問題**: 同一壁面に窓とドアが重なって配置されてもサイレントに通る
- **方針**: 同一壁辺上の開口部を `position + size` でソートし、区間重複を検出。新バリデーションコード `OPENING_OVERLAP` を追加
- **テスト**: 重複ケースの unit test + サンプル `custom-walls-invalid.yaml` にケース追加
- **実装**: `detectOpeningOverlaps()` を validator.ts に追加。幾何キー（向き+位置）でグルーピングし sweep line で重複検出。wallId が異なっても同一物理壁上の重複を検出可能

### 1-3. 構造グリッドアライメントチェック ✅

- **対象**: scaling-roadmap.md Tier 2 #6
- **問題**: 壁位置がモジュールグリッド（910mm）から逸脱しても警告されない
- **方針**: 各壁edgeの座標が `module` の整数倍かチェック。逸脱時に warning `GRID_MISALIGNMENT` を出力。明示壁のみ対象（自動壁はグリッドから生成されるため必ず整合）
- **テスト**: 意図的にずらした壁を持つサンプルで検証
- **実装**: `WallEdge` に `source`/`hasOffset` フィールド追加。`checkGridAlignment()` で最寄りグリッド線からの距離 `Math.min(r, mod-r)` で判定。grid+offset は意図的逸脱としてスキップ

### 1-4. BFS 到達性チェックの精度向上 ✅

- **対象**: `validator.ts:265`
- **問題**: ドア接続のBFSのみ。サブルーム間の到達性が不十分なケースがある
- **方針**: サブルームノードをBFSグラフに組み込み、サブルーム単位の到達性も検証。既存の `ISOLATED_SUBAREA` と統合
- **実装**: `findSharedWallBetweenSubRooms()` の `rooms.length > 0` ガードを削除し幾何条件のみでフィルタ。Strategy 2 に区間重なり検証を追加。perimeter除外で外周壁の誤選択を防止（部分重なりは許容）

---

## Phase 2: ユーザー体験の改善（〜2週間）

採用障壁を下げる施策。Phase 1 と一部並行可能。

### 2-1. テンプレート/プリセットシステム

- **対象**: scaling-roadmap.md Tier 2 #7
- **方針**:
  - `archilang init --preset 3ldk` で初期YAMLを生成するCLIサブコマンド
  - プリセット定義は `presets/` ディレクトリにYAMLファイルとして配置
  - 初期セット: `1r-studio`, `2ldk-apartment`, `3ldk-house`, `4ldk-house`
  - 既存の `samples/` から抽出・整理
- **効果**: 0からYAMLを書かずに始められる。最も採用障壁を下げるTier 2施策

### 2-2. `--watch` モード + ブラウザ自動リロード

- **方針**:
  - `archilang render --watch plan.yaml` で chokidar によるファイル監視
  - 変更検出 → 再ビルド → WebSocket で HTML プレビューをホットリロード
  - フルGUI（双方向編集）は作らない。YAML編集→即時SVG確認のみ
  - 依存追加: `chokidar`, `ws`（dev dependencies）
- **効果**: GUI開発の1/10のコストで「触りやすさ」を実現。VS Code + ターミナル並べて使う想定

### 2-3. npm publish 準備

- **方針**:
  - `package.json` の `bin`, `files`, `engines` フィールド整備
  - `npx archilang render plan.yaml` で即実行可能にする
  - README に Quick Start セクション追加
  - GitHub Actions で publish ワークフロー作成
- **効果**: 試用までの摩擦を最小化。PropTech/計算設計事務所が評価しやすくなる

---

## Phase 3: 実務価値の拡張（〜3週間）

Phase 1-2 完了後。プロダクトとしての差別化を強化する。

### 3-1. 法的面積計算の拡充

- **対象**: scaling-roadmap.md Tier 1 #3
- **方針**:
  - 既存の面積計算（m²、畳）に加え、法的区分を付与
  - `area_type`: `floor_area`（床面積）, `building_area`（建築面積）, `capacity_target`（容積対象）
  - YAMLに `balcony`, `porch`, `parking` 等の用途属性を追加し、面積算入/不算入を自動判定
  - `--area-table` 出力に法的面積サマリーを追加
- **効果**: 確認申請の初期チェックに使える。デベロッパー企画部門への訴求力大

### 3-2. 法規チェック MVP（高頻度ルールから）

- **方針**: 全法規対応ではなく、企画段階で最も聞かれる3項目に絞る:
  1. **居室の採光** — 窓面積 / 床面積 ≥ 1/7（建築基準法28条）
  2. **居室の換気** — 換気開口 / 床面積 ≥ 1/20（同28条2項）
  3. **廊下幅** — 両側居室: 1.6m以上、片側居室: 1.2m以上（施行令119条）
- **前提**: 開口部に `type: window` と面積情報が必要 → Phase 1-2 の開口部改善が前提
- **出力**: バリデーション warning/error として既存フレームワークに統合

### 3-3. DXF 出力 MVP

- **方針**:
  - 最小限の DXF (R12形式) を生成。壁・開口部・部屋ラベルのみ
  - ライブラリ: `dxf-writer` or 自前（R12 ASCII DXFは単純なテキスト形式）
  - レイヤー構成: `WALL_EXT`, `WALL_INT`, `OPENING`, `LABEL`, `DIM`
  - JW-CAD での読み込み動作確認
- **効果**: 既存CADワークフローへの受け渡しが可能に。ハウスメーカーの評価ポイント

---

## Phase 4: Tier 3 準備（Phase 3 完了後に判断）

Phase 1-3 の完了と実ユーザーフィードバックを踏まえて着手判断する。

### ゲート条件

- [x] Phase 1 の技術的課題4件が全て解消 (2026-03-29)
- [ ] npm publish 済み、実ユーザーからのフィードバックがある
- [ ] 多層階への需要が確認された（フィードバック or 市場調査）

### 着手する場合の順序

1. **多層階データモデル設計** — `BuildingModel` に `floors: Floor[]` を導入。resolver の 1F 固定を解除
2. **階段・EV表現** — 上下階接続トポロジー。到達性検証の垂直方向拡張
3. **LLM → YAML 生成実験** — コアが安定した状態で、生成→検証パイプラインのPoC

---

## タイムライン概要

```
Week 1-2:  Phase 1 (コア信頼性) ──────────────┐
Week 2-3:  Phase 2 (ユーザー体験) ─── 一部並行 ─┤
Week 4-6:  Phase 3 (実務価値拡張)               │
Week 7+:   Phase 4 判断 ←── ユーザーFB待ち ─────┘
```

## 技術的注意事項

- **テストファースト**: 各機能は必ず失敗するテストを先に書く。既存14スイートの構成に合わせる
- **破壊的変更の回避**: YAML v0.2 スキーマとの後方互換を維持。新フィールドは optional
- **依存の最小化**: runtime 依存は `yaml` のみの方針を維持。`chokidar`/`ws` は dev dependency
- **コミット粒度**: 機能単位でコミット。Phase 1 の各項目が1PR = 1マージ単位
