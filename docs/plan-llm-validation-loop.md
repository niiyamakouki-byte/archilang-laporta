# archilang LLMフィードバックループ強化計画

> 2026-04-05 作成

## 意図

LLMに直接archilang YAMLを書かせ、validate → エラーフィードバック → 再生成のループで品質を収束させる。Graph-CADの中間グラフ表現を自前のパッカーで解くアプローチは配置問題の難しさがボトルネックになったため、**LLMの空間推論力 + archilangのバリデーションを組み合わせる方が実用化が早い**と判断した。

## 現状分析

### バリデーション（13ルール）

| コード | 重要度 | auto-fix | fix_hint の LLM 修正しやすさ | 改善余地 |
|---|---|---|---|---|
| `UNKNOWN_ROOM_REF` | error | なし | ○ ID打ち間違い → 簡単 | - |
| `UNREACHABLE_ROOM` | error | なし | △ 「到達不能」だけでは不十分 | **到達パスの候補を提示** |
| `ROOM_WITHOUT_DOOR` | warn | **あり** | ○ | - |
| `SUB_ROOM_WITHOUT_DOOR` | warn | なし | △ | auto-fix 追加可能 |
| `ISOLATED_SUBAREA` | error | なし | × 壁を削除/ドア追加の判断が難 | **修正YAML例を提示** |
| `SKIPPED_OPENING` | error | なし | △ 「壁が見つからない」が曖昧 | **隣接している壁一覧を提示** |
| `OPENING_OVERLAP` | warn | なし | △ どちらをどう動かすか不明 | **auto-fix: offset自動調整** |
| `GRID_MISALIGNMENT` | warn | **あり** | ○ | - |
| `EQUIPMENT_UNKNOWN_ROOM` | error | なし | ○ | - |
| `EQUIPMENT_OUT_OF_BOUNDS` | warn | なし | △ | **auto-fix: 部屋内にクランプ** |
| `EQUIPMENT_OVERLAP` | warn | なし | △ | **auto-fix: offset連番配置** |
| `EQUIPMENT_OPENING_WALL_OVERLAP` | error/warn | なし | △ | **auto-fix: ドアを避けてずらす** |
| `EQUIPMENT_DOOR_CLEARANCE_BLOCKED` | error | なし | × clearance zoneの概念がLLMに伝わりにくい | **auto-fix: ドアから離す** |

### 現状の auto-fix（2ルール）

1. `GRID_MISALIGNMENT` → 最寄りグリッドにスナップ
2. `ROOM_WITHOUT_DOOR` → 共有壁の最長壁にドア追加

### fix-hints の問題

現在の fix_hint は人間向けの自然言語だが、LLMが修正YAMLを生成するには情報が不足:
- 「Move or resize opening」→ **どこに？どのくらい？**
- 「Adjust equipment」→ **具体的にどの値を変える？**

## 実装計画

### Phase 1: fix-hints の LLM 向け強化

**目的**: fix_hint に「具体的な修正値」「修正後のYAML断片」を含める

#### 1-1. SKIPPED_OPENING の修正ヒント強化

現状: `Fix opening "D2": shared wall between "kodomo" and "ldk" not found`
改善後:
```json
{
  "fix_hint": "Room \"kodomo\" and \"ldk\" do not share a wall. Possible fixes:\n1. Move kodomo adjacent to ldk (e.g. grid_rect: {x:3, y:4, w:3, h:4})\n2. Change connects to rooms that share a wall: [kodomo, bedroom]",
  "available_shared_walls": [
    {"rooms": ["kodomo", "bedroom"], "wall": "wall_5", "length_mm": 2730}
  ]
}
```

**実装**: `fix-hints.ts` の `SKIPPED_OPENING` ケースで、connects の2部屋それぞれの隣接部屋リストと共有壁情報を列挙する。

#### 1-2. UNREACHABLE_ROOM の到達パス候補提示

現状: `Room "bedroom" is not reachable from any external entrance`
改善後:
```json
{
  "fix_hint": "Add door path: bedroom → kodomo → ldk (which has external entrance ED1)",
  "shortest_missing_path": ["bedroom", "kodomo", "ldk"],
  "missing_connections": [
    {"from": "bedroom", "to": "kodomo", "shared_wall": "wall_7"}
  ]
}
```

**実装**: BFS で OUTSIDE から到達不能な部屋に対して、到達可能な部屋への最短パス（共有壁ベース）を探索。

#### 1-3. EQUIPMENT 系の具体的修正値

現状: `Adjust equipment "K1": Equipment "K1" blocks door "ED1" clearance zone`
改善後:
```json
{
  "fix_hint": "Move equipment \"K1\" to offset: 1200 (currently at 0, door ED1 clearance needs 900mm)",
  "suggested_position": {"offset": 1200},
  "clearance_needed_mm": 900
}
```

**実装**: 干渉している設備のドアクリアランスゾーンを計算し、必要な最小 offset を算出。

### Phase 2: auto-fix ルール拡充（5ルール追加）

| # | ルール | 戦略 |
|---|---|---|
| 1 | `OPENING_OVERLAP` | 重なっている開口部の offset を自動調整（等間隔配置） |
| 2 | `EQUIPMENT_OVERLAP` | 同一壁上の設備を offset 連番で再配置 |
| 3 | `EQUIPMENT_OPENING_WALL_OVERLAP` | 設備をドア/窓の端から最低100mm離す offset に移動 |
| 4 | `EQUIPMENT_DOOR_CLEARANCE_BLOCKED` | 設備をクリアランスゾーン外に移動（ドア幅分ずらす） |
| 5 | `EQUIPMENT_OUT_OF_BOUNDS` | 設備を部屋の bounding rect 内にクランプ |

**優先度**: 2 > 3 > 4 > 1 > 5（LLM生成YAMLで頻出する順）

### Phase 3: validate の JSON 出力強化

`validate --format json` の出力を LLM が消費しやすくする。

```json
{
  "ok": false,
  "errorCount": 2,
  "warningCount": 1,
  "issues": [...],
  "context": {
    "rooms": [
      {"id": "ldk", "grid_rect": {"x":0,"y":0,"w":7,"h":4}, "shared_walls_with": ["washitsu", "kodomo"]}
    ],
    "adjacency_graph": {
      "ldk": ["washitsu", "kodomo", "wash"],
      "kodomo": ["ldk", "bedroom"]
    }
  }
}
```

**追加フィールド**:
- `context.rooms`: 各部屋の grid_rect と隣接部屋リスト（LLMが配置関係を把握できる）
- `context.adjacency_graph`: 壁共有ベースの隣接グラフ（ドア接続ではなく物理的隣接）

### Phase 4: archilang-floorplan スキルへの LLM ループ統合

`.claude/skills/archilang-floorplan/` のワークフローを更新:

```
1. ユーザー要望ヒアリング
2. YAML 生成（LLM が直接記述）
3. validate --format json
4. エラーあり?
   → fix_hint + context を LLM に渡して修正 YAML 生成
   → solve（auto-fix 適用）
   → 再 validate
   → 最大3回ループ
5. render → SVG 出力
6. ユーザーに確認
```

**ポイント**: validate の JSON 出力がそのまま LLM への修正プロンプトになること。

## 実装優先順位

```
Phase 2 (auto-fix拡充)      ← 最もインパクトが大きい。LLM不要で即座に効果
  ↓
Phase 1 (fix-hints強化)     ← LLMループの品質を左右
  ↓
Phase 3 (JSON出力強化)      ← LLMループの前提
  ↓
Phase 4 (スキル統合)        ← 全て揃ってから
```

## 見込み効果

手書き3LDKサンプル（3ldk-with-equipment.yaml, 235行）は warn 1件で通過する。
LLM生成YAMLは、以下の条件が揃えばループ3回以内で同水準に収束すると期待:

1. auto-fix が設備系5ルールをカバー（Phase 2）→ 設備エラーは自動解消
2. fix_hint が「共有壁一覧」「到達パス」を含む（Phase 1）→ LLMが接続エラーを自力修正可能
3. validate JSON に隣接グラフが含まれる（Phase 3）→ LLMが空間関係を把握して配置修正

**Phase 2 だけでも、現在のLLM生成YAMLのエラー7件中3件（設備系）は自動修正可能になる。**

## Graph-CAD パイプラインとの関係

graph-to-yaml パイプライン（PR #1）は棚上げ。将来的には:
- FloorplanGraph スキーマ → LLM出力の「構造チェック用スキーマ」として転用可能
- grid-packer → 2次元制約ソルバーに置き換えれば復活の余地あり
- ただし validate ループが十分に機能するなら不要かもしれない
