# Graph-CAD アプローチの archilang への適用計画

> 2026-04-04 作成
> 参考論文: Gong et al., "Learning Hierarchical and Geometry-Aware Graph Representations for Text-to-CAD" (ICLR 2026)
> リポジトリ: https://github.com/EESJGong/Graph-CAD

## 意図

archilang の Tier 3（LLM統合）に向けて、Graph-CAD の「中間グラフ表現による段階的生成」アーキテクチャを適用する。LLM に直接 YAML 座標を書かせるのではなく、構造的中間表現を経由することで生成精度と制約充足率を向上させる。

## Graph-CAD の核心と archilang への対応

### Graph-CAD パイプライン

```
自然言語 → 階層分解グラフ → アクション列 → Blender Python
```

- 階層分解グラフ: パーツの親子関係・空間配置・幾何制約をノード/エッジで表現
- 段階的生成で探索空間を削減（end-to-end より高精度）
- SAPCL: 制約境界の合成例でカリキュラム学習

### archilang への写像

```
自然言語 → 間取りグラフ → グリッド配置 → YAML → validate → SVG
           ^^^^^^^^^^^^   ^^^^^^^^^^^^
           新規実装        新規実装
```

| Graph-CAD 概念 | archilang 対応 | 備考 |
|---|---|---|
| 分解グラフのノード | 部屋ノード（id, type, 目標面積） | rooms + sub_rooms |
| エッジ（幾何制約） | 隣接・接続・方位制約 | connects, orientation |
| 階層関係 | 部屋 → sub_room、ゾーン → 部屋群 | 既存の親子構造を活用 |
| アクション列 | グリッド割当アルゴリズム | 新規：グラフ→座標変換 |
| Blender コード | YAML spec | 既存フォーマット |
| 実行＆検証 | validate → auto-fix → render | 既存パイプライン |

## 実装計画

### Phase A: 間取りグラフスキーマ定義

**目的**: LLM が生成しやすく、archilang が消費できる中間表現を定義する

```typescript
// 間取りグラフ（LLM出力）
interface FloorplanGraph {
  meta: {
    building_type: string;      // "木造軸組2階建て"
    module: "shaku" | "meter";
    orientation: WallSide;
    target_area_m2?: number;
  };
  zones: Zone[];                // ゾーニング（パブリック/プライベート/水回り）
  rooms: RoomNode[];
  connections: ConnectionEdge[];
  constraints: Constraint[];
}

// 部屋ノード
interface RoomNode {
  id: string;
  type: string;               // "LDK", "寝室", "トイレ"
  zone: string;               // 所属ゾーン
  target_area_tatami?: number; // 目標面積（畳数）
  sub_rooms?: SubRoomNode[];
  equipment?: string[];        // ["kitchen_counter", "refrigerator"]
}

// 接続エッジ
interface ConnectionEdge {
  from: string;
  to: string;
  type: "door" | "opening" | "adjacent"; // 扉接続 / 開口 / 隣接のみ
  opening_style?: string;                 // "片開き", "引き戸"
}

// 配置制約
interface Constraint {
  type: "orientation" | "adjacency" | "cluster" | "separation";
  rooms: string[];
  value: string;  // "south_facing", "water_cluster", "separate_from_ldk"
}
```

**archilang の既存資産との関係**:
- `inspect.ts` の隣接グラフ → `ConnectionEdge` の逆変換で検証に使える
- `types.ts` の `RoomSpec` → `RoomNode` からの変換ターゲット

### Phase B: グラフ → YAML 変換エンジン (`graph-to-yaml`)

**目的**: 間取りグラフからグリッド座標を決定し、有効な YAML を自動生成する

#### アルゴリズム概要

```
1. ゾーニング配置
   - orientation に基づきゾーンの大まかな方位を決定
   - 例: south_facing → LDK を南側、水回りを北側

2. 部屋サイズ推定
   - target_area_tatami → グリッド数に変換
   - 例: 8畳 → 4×4グリッド（shaku module, 910mm）

3. グリッド割当（制約充足）
   - 隣接制約を満たすように部屋を配置
   - 矩形パッキング問題として解く
   - 初期実装: 貪欲法（ゾーン順に配置）
   - 将来: 制約ソルバー or 強化学習

4. 開口部・設備の自動配置
   - ConnectionEdge の door/opening → openings セクション生成
   - equipment リスト → equipment セクション生成
   - position: center をデフォルト

5. YAML 出力
   - archilang v0.2 フォーマットで出力
```

#### 実装ファイル

```
src/
  graph/
    types.ts          # FloorplanGraph 型定義
    graph-to-yaml.ts  # メイン変換ロジック
    zone-placer.ts    # ゾーニング → 方位配置
    room-sizer.ts     # 畳数 → グリッドサイズ
    grid-packer.ts    # 矩形パッキング（制約付き）
    opening-placer.ts # 接続エッジ → 開口部配置
```

### Phase C: LLM → グラフ生成プロンプト

**目的**: LLM に FloorplanGraph JSON だけを生成させる（座標計算は archilang 側で担う）

#### プロンプト設計方針

Graph-CAD の知見: **LLM には構造（何が何と繋がるか）だけ生成させ、幾何（どこに配置するか）はアルゴリズムで解く**

```
[System Prompt]
あなたは建築間取りの構造設計アシスタントです。
ユーザーの要望から「間取りグラフ」をJSON形式で出力してください。

出力するのは部屋の接続関係と制約のみです。
座標やグリッド位置は出力しないでください。

[出力スキーマ]
{FloorplanGraph の JSON Schema}

[Few-shot Examples]
入力: "南向き3LDK、LDKは16畳以上、水回りは北側にまとめて"
出力: { ... }
```

#### バリデーションループ（Graph-CAD の SAPCL に相当）

```
LLM → FloorplanGraph JSON
  → スキーマ検証（JSON Schema）
  → graph-to-yaml 変換
  → archilang validate（13ルール）
  → エラーあり？ → エラー内容を LLM にフィードバック → 再生成
  → エラーなし？ → render → SVG 出力
```

既存の 13 バリデーションルールがそのまま学習シグナルになる。Graph-CAD が BlendGeo データセット（12,000例）で SAPCL を訓練したのと同様に、archilang では **validate 通過率** を品質指標として使える。

### Phase D: 評価とデータ蓄積

#### 評価指標（Graph-CAD に倣う）

| 指標 | 内容 | 測定方法 |
|---|---|---|
| バリデーション通過率 | 13ルール全パスの割合 | validate --format json |
| 制約充足率 | ユーザー指定制約の達成率 | constraints vs 実際の配置 |
| 面積精度 | 目標面積との乖離 | area.json vs target_area |
| 動線品質 | 全室到達可能 + 動線長 | inspect の BFS |
| ユーザー満足度 | 修正回数の少なさ | フィードバックループの反復数 |

#### データ蓄積

成功した `(自然言語, FloorplanGraph, YAML)` のトリプレットを蓄積。将来的に:
- Few-shot プロンプトの改善
- ファインチューニング用データセット構築
- Graph-CAD の SAPCL 的なカリキュラム学習の適用

## 実装優先順位

```
Phase A (スキーマ定義)     ← 最初にやる。型が決まれば全体が動く
  ↓
Phase B (graph-to-yaml)   ← コア。ここが最も技術的に難しい
  ↓
Phase C (LLM プロンプト)   ← Phase B が動けばプロンプトは調整の問題
  ↓
Phase D (評価・蓄積)       ← 運用しながら改善
```

## archilang が Graph-CAD より有利な点

1. **バリデーション基盤が既存**: 13ルール + auto-fix。Graph-CAD は Blender 実行成否しか検証手段がない
2. **inspect のグラフ構造が既存**: 隣接グラフ・到達性チェックが逆方向にも使える
3. **ドメインが限定的**: 日本の木造住宅に特化 → 制約空間が狭く、少ないデータで高精度が期待できる
4. **YAML が人間可読**: LLM 生成結果を人間がレビュー・手修正できる（Blender Python より遥かに容易）

## 適用しない部分

- **ファインチューニング**: 当面は API + プロンプトエンジニアリング + バリデーションループで十分。学習データ 12,000 件相当を建築間取りで集めるのは非現実的
- **Blender アクション列の概念**: archilang では YAML スキーマ自体がアクション列に相当。別レイヤーは不要

## 前提条件（ゲート）

- [x] Phase 1（コア信頼性）完了
- [ ] Phase 2（UX: npm publish）完了
- [ ] 間取りグラフのスキーマが建築的に妥当であることの検証（実案件 3 件以上で手動テスト）
