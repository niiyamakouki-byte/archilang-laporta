# archilang

ARCHILANG YAML 仕様の間取りデータを SVG 平面図に変換する CLI ツール。

https://github.com/user-attachments/assets/ea6f60fa-00e9-45a0-94c4-95053672f335

## 概要

ARCHILANG フォーマット（YAML）で記述された建築間取り情報を読み込み、以下を自動生成する:

- **SVG 平面図** - 壁・窓・ドア・寸法線・方位記号・スケールバーを含むベクター図面
- **HTML プレビュー** - ブラウザで即座に確認できるプレビューファイル
- **面積表** - 壁芯面積の一覧表（YAML設定でSVG内テーブル表示、CLIオプションでJSON出力）

## クイックスタート

```bash
# 依存インストール
npm install

# ビルド
npx tsc

# サンプルを描画
node dist/main.js
# → output.svg, output.html が生成される

# 任意の YAML を指定
node dist/main.js path/to/plan.yaml output.svg

# 面積表JSONを出力（.area.json）
node dist/main.js path/to/plan.yaml output.svg --area-table
```

## ラポルタ拡張 (cost-master 連動 / VW Marionette / full pipeline)

株式会社ラポルタ (世田谷区給田5-12-12) の VW2025 Architect 案件向け拡張。`src/laporta/` 配下に独立追加されており、上流コードは触っていない。

### コマンド

```bash
# 見積JSON生成 (cost-master.json v2.7.0 連動, 947品目)
node dist/main.js estimate samples/laporta-30sqm-renovation.yaml /tmp/estimate.json

# Vectorworks Marionette Python 出力 (Wall/Door/Window 配置スクリプト)
node dist/main.js to-vw samples/laporta-30sqm-renovation.yaml /tmp/plan.py

# 一気通貫: SVG + HTML + VW Python + 見積JSON + 顧客向け Markdown 見積書
node dist/main.js full samples/laporta-30sqm-renovation.yaml /tmp/out/

# 自然言語/JSON 部屋リスト → ArchiLang YAML 雛形 (Phase 3 scaffolder)
node dist/main.js scaffold --rooms "LDK 24m2, 寝室 12m2, 浴室 4m2, トイレ 2m2" /tmp/plan.yaml
```

### `full` コマンド出力例

`samples/laporta-30sqm-renovation.yaml` (4部屋 + 7開口) からの出力:

| ファイル | 内容 |
|----------|------|
| `*.svg` / `*.html` | 既存レンダラと同じ平面図 |
| `*.py` | VW Marionette Python (壁13本 / ドア4 / 窓3、Y軸反転済み) |
| `*.estimate.json` | 9行 / 小計¥681,675 + 税¥68,167 = **総額¥749,842** |

### cost-master 連動

- マスタ: `/Users/koki/vw-plugin/src/resources/cost-master.json` v2.7.0 (947品目 / 17カテゴリ)
- マッピング (`src/laporta/mappings.ts`):
  - 部屋タイプ → 内装基本仕上げ (例: LDK → IN-001 LGS間仕切り)
  - 開口部 style+type → 建具コード (例: 引違い窓+AW → FX-016)
  - 設備 type → 機器コード (例: unit_bath → EQ-HTL-106)
- 見積行: 部屋 (㎡), 開口部 (箇所), 設備 (式) を自動展開

### VW Marionette 出力仕様

```python
# -*- coding: utf-8 -*-
import vs
vs.Layer("平面-1F")
vs.NameClass("建築-壁-新設")
vs.AddWall((0, 5460), (5460, 5460))   # wall_0
# Door D1 at wall_0, offset=910, width=750
```

- Layer: `平面-1F` (社内テンプレ Story=1F 2700mm)
- Class: `建築-壁-{既存|新設|解体}` / `建具-{木製|アルミ|鋼製}` / `窓-{既存|新設}`
- 単位: mm / Y軸はArchiLang(下向き)→VW(上向き)反転
- ドア・窓・設備は座標コメント出力 (Phase 2でCustomObject配置に拡張)

## バリデーション

間取りデータの整合性を検証するコマンドを提供する。

```bash
# 単一ファイル
node dist/main.js validate samples/4ldk-complex-invalid.yaml

# 複数ファイル
node dist/main.js validate samples/basic-3room.yaml samples/4ldk-complex-invalid.yaml

# 全サンプル一括
node dist/main.js validate --all

# npm script
npm run validate -- samples/4ldk-complex-invalid.yaml
npm run validate -- --all
```

出力例:

```
✓ samples/basic-3room.yaml
✗ samples/4ldk-complex-invalid.yaml
  ERROR [ISOLATED_SUBAREA] Room "bath" has an isolated sub-area (5.0m²) created by partition wall(s): w_bath_partition
  ERROR [ISOLATED_SUBAREA] Room "closet" has an isolated sub-area (3.3m²) created by partition wall(s): w_closet_shelf
✓ samples/custom-walls-invalid.yaml
  WARN  [GRID_MISALIGNMENT] Wall "w_custom_ext" is not aligned to 910mm grid (off-grid coordinates: 2500mm, 2500mm)
```

エラーがある場合は exit code 1 を返す。

### 検証ルール

| コード | 重要度 | 内容 |
|--------|--------|------|
| `UNKNOWN_ROOM_REF` | error | ドアの `connects` が存在しない部屋IDを参照 |
| `UNREACHABLE_ROOM` | error | 外部入口からドアを辿って到達できない部屋（サブルーム含む） |
| `ROOM_WITHOUT_DOOR` | warning | ドア接続が1つもない部屋 |
| `SUB_ROOM_WITHOUT_DOOR` | warning | full partition のサブルームにドア接続がない |
| `ISOLATED_SUBAREA` | error | additive壁が部屋を完全に二分割し、ドアのない側が孤立 |
| `SKIPPED_OPENING` | error | 開口部がresolve時にスキップされた（存在しない部屋参照、共有壁なし等） |
| `OPENING_OVERLAP` | warning | 同一壁面上で開口部同士が重複（1D区間で判定） |
| `GRID_MISALIGNMENT` | warning | 明示壁の座標がモジュールグリッドに整合していない（grid+offsetによる意図的逸脱は除外） |
| `EQUIPMENT_UNKNOWN_ROOM` | error | 設備の `room` が存在しない部屋IDを参照 |
| `EQUIPMENT_OUT_OF_BOUNDS` | warning | 設備が部屋のバウンディング矩形からはみ出している |
| `EQUIPMENT_OVERLAP` | warning | 同一部屋内で設備同士が重複 |
| `EQUIPMENT_OPENING_WALL_OVERLAP` | warning | 設備と開口部（窓）が同一壁面上で重複 |
| `EQUIPMENT_DOOR_CLEARANCE_BLOCKED` | error | 設備がドアの開閉範囲（スイングクリアランス）を阻害 |

`ISOLATED_SUBAREA` は座標圧縮フラッドフィルで検出する。部分壁（部屋を完全には横断しない壁）は回り込めるため問題にならない。`sub_rooms` が定義されている部屋は `ISOLATED_SUBAREA` チェックをスキップする（サブルーム側のドア検証に委譲）。

`OPENING_OVERLAP` は同一壁面上の開口部を壁軸方向の1D区間に射影し、sweep lineで重複を検出する。`GRID_MISALIGNMENT` は明示壁の座標がモジュールの整数倍かを検証する。`grid+offset` 形式（`dx`/`dy` 非ゼロ）で指定された壁は意図的な逸脱とみなし警告をスキップする。

## JSON バリデーション出力

`--format json` オプションで、バリデーション結果を構造化JSONで出力できる。各issueに `fix_hint`（修正指示）と `auto_fixable`（自動修正可能か）が付与される。

```bash
node dist/main.js validate samples/custom-walls-invalid.yaml --format json
```

出力例:

```json
{
  "file": "samples/custom-walls-invalid.yaml",
  "ok": false,
  "errorCount": 3,
  "warningCount": 1,
  "issues": [
    {
      "severity": "warning",
      "code": "GRID_MISALIGNMENT",
      "message": "Wall \"w_custom_ext\" is not aligned to 910mm grid...",
      "wallId": "w_custom_ext",
      "fix_hint": "Snap wall \"w_custom_ext\" endpoints to nearest 910mm grid (0→0, 2500→2730, 1820→1820, 2500→2730)",
      "auto_fixable": true
    }
  ]
}
```

## inspect コマンド

間取りデータの構造を JSON で出力する。部屋グラフ、隣接関係、占有グリッド、面積、壁一覧を含む。

```bash
# JSON出力
node dist/main.js inspect samples/basic-3room.yaml

# ASCIIマップ表示
node dist/main.js inspect samples/basic-3room.yaml --ascii-map
```

ASCIIマップ出力例:

```
     0   1   2   3   4   5   6   7
  +-------------------+-------------------+
6 |bedr bedr bedr bedr|ldk  ldk  ldk  ldk |
  +                   +                   +
5 |bedr bedr bedr bedr|ldk  ldk  ldk  ldk |
  +-------------------+                   +
4 |bath bath bath bath|ldk  ldk  ldk  ldk |
  +                   +                   +
3 |bath bath bath bath|ldk  ldk  ldk  ldk |
  +-------------------+-------------------+
```

JSON出力に含まれるフィールド:

| フィールド | 内容 |
|-----------|------|
| `grid` | モジュールサイズ、グリッド総数、スパン |
| `rooms` | 部屋一覧（面積、畳数、隣接部屋、壁リスト） |
| `adjacency` | ドア接続による隣接グラフ |
| `occupancyGrid` | グリッド座標ごとの部屋ID |
| `walls` | 壁一覧（rooms、isExternal、source） |
| `openings` | 開口部一覧（connectedRooms、wallId） |

## solve コマンド

バリデーションエラーの自動修正を試みる。`validate → auto-fix → revalidate` のループを実行する。

```bash
# ドライラン（修正内容を表示するが適用しない）
node dist/main.js solve samples/custom-walls-invalid.yaml --dry-run

# 修正を適用して出力
node dist/main.js solve samples/custom-walls-invalid.yaml --out fixed.yaml

# 最大反復回数を指定
node dist/main.js solve plan.yaml --max-iter 3 --out fixed.yaml
```

出力例:

```
Iteration 1: Snapped wall "w_custom_ext" to grid: 2500→2730, 2500→2730
Iteration 2: no auto-fixable issues remaining

Solve complete: 2 iteration(s), 1 fix(es) applied
Final: 3 error(s), 0 warning(s), ok=false
Fixed YAML written to: fixed.yaml
```

### 自動修正ルール (v1)

| エラーコード | 修正内容 | 条件 |
|-------------|---------|------|
| `GRID_MISALIGNMENT` | 明示壁の座標を最寄りグリッドにスナップ | `hasOffset=false`、スナップ距離がモジュール/2以内 |
| `ROOM_WITHOUT_DOOR` | 隣接部屋との共有壁にドアを自動追加 | 共有壁あり、既存開口部なし |

自動修正不可能なエラー（`UNREACHABLE_ROOM`, `ISOLATED_SUBAREA` 等）は手動修正が必要。`validate --format json` の `fix_hint` フィールドが修正の手がかりになる。

## 面積表

面積表は2つの出力方式がある:

- **SVG 内テーブル** — YAML の `rendering.area_table.enabled: true` で図面右側に描画
- **JSON ファイル** — CLI の `--area-table` オプションで `.area.json` を出力

```yaml
# YAML で SVG 面積表を有効化
rendering:
  area_table:
    enabled: true
```

```bash
# JSON 出力のみ（SVG 面積表は YAML 設定に従う）
node dist/main.js samples/4ldk-complex.yaml output.svg --area-table
# → output.area.json
```

### SVG 面積表

図面右側に以下の列を持つテーブルを描画:

| 列 | 内容 |
|----|------|
| 部屋 | 部屋名（サブルームはインデント表示） |
| m² | 壁芯面積（平方メートル） |
| 畳 | 畳数（1畳 = 2×module² = 1.6562m²） |

最下行に「延床面積」（トップレベル部屋の面積合計）を表示。サブルームの面積は親部屋に含まれるため合計には加算しない。

### JSON 出力 (`.area.json`)

```json
{
  "rooms": [
    { "id": "ldk", "type": "LDK", "area_m2": 19.87, "tatami": 12 },
    { "id": "kitchen", "type": "キッチン", "parent": "ldk", "area_m2": 7.45, "tatami": 4.5 }
  ],
  "summary": {
    "total_floor_area_m2": 82.81,
    "building_area_m2": 82.81
  }
}
```

### 面積計算方式

- **壁芯面積**: 各部屋の `grid_rect` / `grid_rects` の矩形合計（`Σ(w × h) × module²`）
- サブルームの面積はフラッドフィルまたはジオメトリック分割で算出した `areaMm2` を使用
- 延床面積 = トップレベル部屋の壁芯面積合計

## 処理パイプライン

```
YAML ──→ parseArchilang() ──→ Archilang (型付きデータ)
                                  │
                           resolve(spec) ──→ BuildingModel
                                  │            ├ rooms     (グリッド→mm変換済)
                                  │            ├ walls     (外壁/内壁を自動判定)
                                  │            ├ subRooms  (フラッドフィルで領域算出)
                                  │            ├ openings  (壁上の位置を解決)
                                  │            └ equipment (壁寄せ配置を解決)
                                  │
                        validateBuilding(model) ──→ ValidationResult
                                  │
                           composeSvg(model) ──→ SVG文字列
                                  │
                           ┌──────┼──────┐
                           │      │      │
                         grid   walls  openings
                        labels  dims    meta
                        gridline-dims  gridlines
                           │      │      │
                           └──────┼──────┘
                                  │
                           ┌──────┴──────┐
                       output.svg   output.html
                                    output.area.json (--area-table時)
```

## ARCHILANG YAML 仕様 (v0.3)

### 基本構造

```yaml
archilang: "0.2"

site:
  orientation: south          # 建物の正面方位 (north / south / east / west)

building:
  structure: 木造軸組
  module: shaku               # 尺モジュール (910mm)
  stories: 1
  defaults:
    ceiling_height: 2400mm
    external_wall:
      thickness: 130mm        # 外壁厚
    internal_wall:
      partition: 90mm         # 内壁厚 (間仕切り)
```

### レンダリングオプション

```yaml
rendering:
  grid_lines:
    enabled: true            # 通り芯（構造グリッド線）の表示 (デフォルト: false)
  area_table:
    enabled: true            # SVG 図面右側に面積表を描画 (デフォルト: false)
```

### グリッド定義

グリッドはモジュール単位（910mm）のスパンで定義する。

```yaml
geometry:
  grids:
    module: 910mm
    1F:
      x_spans: [3, 5]        # X方向: 3モジュール + 5モジュール = 合計8
      y_spans: [4, 3]        # Y方向: 4モジュール + 3モジュール = 合計7
```

### 部屋定義

`grid_rect` でグリッド座標上の矩形を指定する。原点は左下。

```yaml
rooms:
  - id: ldk
    floor: 1F
    type: LDK                # 表示名（日本語可）
    grid_rect: { x: 3, y: 0, w: 5, h: 7 }

  - id: bedroom
    floor: 1F
    type: 寝室
    grid_rect: { x: 0, y: 3, w: 3, h: 4 }
```

#### 非矩形部屋 (multi-rect)

L字型・T字型など非矩形の部屋は `grid_rects`（複数形）で複数の矩形の和集合として定義する。

```yaml
rooms:
  # L字型LDK（2矩形合成）
  - id: ldk
    floor: 1F
    type: LDK
    grid_rects:
      - { x: 0, y: 0, w: 7, h: 4 }   # 南側の横長部分
      - { x: 3, y: 4, w: 4, h: 3 }    # 北東に突き出す部分
```

**制約:**
- `grid_rect`（単数）と `grid_rects`（複数）は排他。両方指定はエラー
- `grid_rects` 内の矩形同士は辺で接続されていること（重複はエラー）
- 各矩形の和集合が部屋の形状となり、壁は外周辺のみ自動抽出される
- multi-rect 部屋でも `sub_rooms` に対応。full partition はフラッドフィル、partial partition はセルベース分割で領域を算出する

### サブルーム定義 (sub_rooms)

明示壁で部屋を分割した際、各サブエリアに個別の名前・ラベル・面積を割り当てる。`seed` で指定したグリッド座標がどのサブエリアに属するかをフラッドフィルで判定する。

```yaml
rooms:
  - id: bath
    floor: 1F
    type: 浴室・洗面
    grid_rect: { x: 4, y: 4, w: 4, h: 3 }
    sub_rooms:
      - id: bath_tub
        type: 浴室
        seed: { x: 5, y: 5 }    # 壁の西側に属する任意のグリッド座標
      - id: wash
        type: 洗面
        seed: { x: 7, y: 5 }    # 壁の東側に属する任意のグリッド座標
```

**ポイント:**

- `seed` はサブエリア内の任意の1点（グリッド座標）。フラッドフィルでそのシードから到達可能な領域がサブルームの範囲・面積になる
- N分割に対応（2分割に限らず、壁の数とシードの数で任意分割可能）
- 壁が部屋を完全に分割する場合（**full partition**）: フラッドフィルで各サブエリアの正確な範囲を算出
- 壁が部屋を完全には分割しない場合（**partial partition**、例: カウンター壁）: 壁の位置をカットラインとしてジオメトリック分割にフォールバック
- サブルームIDはドアの `connects` で直接参照可能。ドアの壁検索は自動的に親部屋にフォールバックする
- ラベルは親部屋ではなく各サブルームの中心に個別表示される
- サブルームIDと部屋IDはグローバルに一意でなければならない

### 明示壁定義

`geometry.walls` セクションで、グリッドに依存しない壁を明示的に定義できる。自動抽出壁と共存する `additive`（デフォルト）と、自動抽出を無効化する `explicit_only` モードがある。

```yaml
geometry:
  walls:
    mode: additive          # additive (デフォルト) | explicit_only
    segments:
      # mm座標で直接指定
      - id: w_partition
        floor: 1F
        from: { x: 1820, y: 0 }
        to: { x: 1820, y: 3640 }
        thickness: 90mm     # 省略時: type に応じたデフォルト値
        type: internal      # external (デフォルト) | internal
        grid_line: true     # この壁の位置に通り芯を追加

      # グリッド座標 + オフセットで指定
      - id: w_offset
        floor: 1F
        from: { grid: { x: 4, y: 4 }, dx: 150, dy: 0 }
        to: { grid: { x: 4, y: 7 }, dx: 150, dy: 0 }

      # from/to で mm とgrid+offset の混在も可
      - id: w_mixed
        floor: 1F
        from: { grid: { x: 3, y: 0 }, dx: 150, dy: 0 }
        to: { x: 2880, y: 6370 }
```

**壁端点の指定方法:**

| 方式 | 記法 | 説明 |
|------|------|------|
| mm直接 | `{ x: 2730, y: 0 }` | mm座標を直接指定 |
| グリッド | `{ grid: { x: 3, y: 0 } }` | グリッド位置にスナップ |
| グリッド+オフセット | `{ grid: { x: 3, y: 0 }, dx: 150, dy: 0 }` | グリッド位置からmm単位でオフセット |

**オプション:**

| フィールド | 型 | デフォルト | 説明 |
|-----------|------|----------|------|
| `thickness` | `string` | type に応じた値 | 壁厚 (例: `"90mm"`) |
| `type` | `string` | `"external"` | `"external"` または `"internal"` |
| `grid_line` | `boolean` | `false` | `true` にすると壁の位置に通り芯を追加。ラベルはスパン境界の通り芯と統合され位置順に連番 (X1, X2, ...)。通り芯位置がスパン境界と異なる場合、通り芯間距離を示す寸法行が自動追加される |

**制約:**
- 壁は直交（水平または垂直）のみ。斜め壁はエラー
- ゼロ長の壁はエラー
- グリッド座標は有効範囲内（`0` 〜 グリッド合計値）でなければエラー
- 壁IDは一意でなければならない（自動抽出壁の `wall_N` と重複不可）

### 開口部定義

窓・ドアは以下の 2 パターンで配置できる:

**壁指定型** - 特定の部屋の壁に配置

```yaml
- id: W1
  type: AW                   # AW=アルミ窓, WD=木製ドア, AD=アルミドア
  style: 引違い窓            # 引違い窓 / 片開き / 引き戸
  room: ldk
  wall: south                # 配置する壁 (north / south / east / west)
  position: center           # center または { offset: 500 } (壁始点からmm)
  size: { w: 2530, h: 2000 } # mm単位
  sill: 0                    # 窓台高さ (mm)
```

**接続型** - 2部屋間の共有壁にドアを配置

```yaml
- id: D1
  type: WD
  style: 片開き
  connects: [bedroom, ldk]   # 部屋IDのペア
  size: { w: 800, h: 2000 }

# 引き戸（狭小空間に適した開閉方式）
- id: D4
  type: WD
  style: 引き戸
  connects: [wash, ldk]
  size: { w: 800, h: 2000 }

# サブルームIDも指定可能
- id: D5
  type: WD
  style: 片開き
  connects: [hall, wash]      # 通常部屋 ↔ サブルーム
  size: { w: 700, h: 2000 }

- id: D6
  type: WD
  style: 片開き
  connects: [wash, bath_tub]  # 同一親内のサブルーム同士
  size: { w: 700, h: 2000 }
```

**開口部スタイル:**

| スタイル | 描画 | 用途 |
|---------|------|------|
| `引違い窓` | 青い平行線（ガラス2枚） | 窓 |
| `片開き` | ヒンジ点 + 弧（破線） | 開き戸 |
| `引き戸` | パネル線（実線）+ レール線（破線） | スライドドア |

### 設備定義

`geometry.equipment` で水回り設備を部屋の壁に沿って配置する。開口部と同じ `wall` + `position` パターンを使用する。

```yaml
geometry:
  equipment:
    - id: K1
      type: kitchen_counter     # 設備種別（プリセットから選択）
      room: ldk                 # 配置先ルームID
      wall: south               # 壁寄せ方向 (north / south / east / west)
      position: { offset: 0 }   # 壁始点からの横方向オフセット (mm) or "center"
      size: { w: 1800, h: 650 } # オプション — 省略時はプリセットのデフォルトサイズ

    - id: UB1
      type: unit_bath
      room: bath
      wall: north
      position: { offset: 0 }

    - id: T1
      type: toilet
      room: toilet
      wall: north
      position: { offset: 200 }
```

**設備プリセット:**

| type | 表示名 | デフォルトサイズ (w×h mm) | SVGシンボル |
|------|--------|-------------------------|------------|
| `kitchen_counter` | キッチン | 2550×650 | カウンター + シンク楕円 + コンロ□□ |
| `unit_bath` | UB | 1600×1600 | 外枠 + 浴槽（角丸）+ 洗い場 |
| `toilet` | 便器 | 450×700 | タンク矩形 + ボウル楕円 |
| `washbasin` | 洗面 | 750×550 | カウンター + ボウル楕円 |
| `washing_machine` | 洗濯機 | 640×640 | パン矩形 + ドラム円 |
| `refrigerator` | 冷蔵庫 | 685×650 | 矩形 + ×マーク |

- `w` は壁に沿った方向の寸法、`h` は壁から離れる方向の奥行き
- `size` を指定するとプリセットのデフォルトサイズをオーバーライドできる
- 設備は壁の内面に密着して配置される（gap: 0mm）
- 壁方向に応じて設備の向きが自動決定される

## SVG レイヤー構成

SVG は以下のレイヤーで構成される（描画順）:

| レイヤー | ID | 内容 |
|----------|-----|------|
| グリッド | `grid` | モジュール間隔の参照グリッド線（破線） |
| 壁 | `walls` | 外壁（濃色・太線）と内壁（淡色・細線）の矩形 |
| 設備 | `equipment` | 水回り設備シンボル（グレー・細線） |
| 開口部 | `openings` | 引違い窓（青い平行線）、片開きドア（ヒンジ+弧）、引き戸（パネル+レール） |
| ラベル | `labels` | 部屋名・面積 (m²)・畳数 |
| 通り芯間寸法 | `gridline-dimensions` | 通り芯間の距離（通り芯がスパン境界と異なる場合のみ表示、最内側行） |
| 寸法線 | `dimensions` | X/Y 方向のスパン寸法＋合計寸法（各端点に黒ポチ付き） |
| メタ | `meta` | 方位記号（コンパス）とスケールバー (1m / S=1:100) |
| 通り芯 | `gridlines` | 構造グリッド線（一点鎖線）＋両端の丸ラベル（`rendering.grid_lines.enabled: true` 時のみ） |
| 面積表 | `area-table` | 壁芯面積の一覧テーブル（`rendering.area_table.enabled: true` 時のみ） |

## ディレクトリ構成

```
archilang/
├── src/
│   ├── main.ts              # CLI エントリポイント
│   ├── parser.ts            # YAML パース・バリデーション
│   ├── resolver.ts          # グリッド→mm変換、壁抽出、開口部解決、サブルーム解決
│   ├── flood-fill.ts        # 座標圧縮フラッドフィル（resolver・validator共用）
│   ├── svg-composer.ts      # レイヤー合成・SVG生成
│   ├── svg-utils.ts         # 座標変換 (mmToSvg)、エスケープ
│   ├── area-table.ts        # 面積計算・JSON出力
│   ├── validator.ts          # 接続性・サブルームドア・孤立サブエリア・設備検証
│   ├── fix-hints.ts         # バリデーションJSON出力・修正ヒント生成
│   ├── inspect.ts           # inspect コマンド（部屋グラフ・占有グリッド・隣接関係）
│   ├── ascii-map.ts         # ASCIIマップレンダリング
│   ├── auto-fix.ts          # ルールベース自動修正（GRID_MISALIGNMENT, ROOM_WITHOUT_DOOR）
│   ├── solve.ts             # solve コマンド（自動修正ループオーケストレータ）
│   ├── types.ts             # 全型定義
│   ├── equipment-presets.ts  # 設備プリセット定義（6種）
│   ├── __tests__/                 # vitest テスト
│   └── renderers/
│       ├── grid-renderer.ts       # グリッド線描画
│       ├── gridline-renderer.ts   # 通り芯描画（一点鎖線＋丸ラベル）
│       ├── wall-renderer.ts       # 壁描画（開口部による分割処理含む）
│       ├── opening-renderer.ts    # 窓・ドア描画（引違い窓・片開き・引き戸）
│       ├── equipment-renderer.ts # 設備シンボル描画（6種）
│       ├── label-renderer.ts      # 部屋ラベル描画
│       ├── dimension-renderer.ts  # 寸法線描画
│       ├── meta-renderer.ts       # コンパス・スケールバー描画
│       └── area-table-renderer.ts # 面積表SVG描画
├── samples/                 # サンプル間取りデータ
├── package.json
└── tsconfig.json
```

## 主要な設計判断

### 壁の自動判定と明示定義

部屋の辺を全て収集し、同一線上の辺をグループ化する。辺が 1 部屋のみに属する場合は外壁（厚い）、2 部屋で共有されている場合は内壁（薄い）として自動判定する。

`geometry.walls.segments` で明示定義した壁は、`additive` モード（デフォルト）では自動抽出壁に追加され、`explicit_only` モードでは自動抽出を無効化して明示壁のみが使われる。

明示壁には自動的に部屋の帰属（room ownership）が付与される。壁の線分が部屋の外周辺（perimeter edge）上にある場合、その部屋のIDが壁の `rooms` プロパティに追加される。multi-rect部屋の内部継ぎ目は外周に含まれないため、内部パーティション壁は `rooms: []` のまま維持される（内部壁の検出は `findBarriersInRoom` による幾何判定で行われる）。

### 座標系

- **YAML**: グリッド座標。原点は左下、Y軸は上向き（建築慣習）
- **内部モデル**: mm 単位。グリッド座標 × モジュールサイズ (910mm) で変換
- **SVG**: px 単位。`mmToSvg()` で Y 軸を反転（SVG は左上原点）

### 開口部と壁の分割

壁に開口部がある場合、壁を開口部の両側に分割して描画する。開口部の範囲は壁の範囲内にクランプされ、重複する開口部も正しく処理される。

## 技術スタック

- **TypeScript** (ES2022 modules, strict mode)
- **yaml** - YAML パーサ
- **vitest** - テストフレームワーク (devDependency)
- 外部ランタイム依存なし（Node.js 標準モジュールのみ）

## npm scripts

| コマンド | 説明 |
|----------|------|
| `npm run build` | TypeScript コンパイル (`dist/` に出力) |
| `npm run render` | `dist/main.js` を実行 (デフォルト: `sample.yaml`) |
| `npm run render:sample --name=<name>` | `samples/<name>.yaml` をレンダリング |
| `npm run validate -- <file ...>` | 間取りデータのバリデーション |
| `npm run validate -- --all` | 全サンプルを一括バリデーション |
| `npm run dev` | TypeScript ウォッチモード |
| `npm run watch -- <file.yaml>` | YAML を監視して保存ごとに自動レンダリング (ホットリロード) |
| `npm test` | vitest でテスト実行 |
| `npm run test:watch` | vitest ウォッチモード |

### ホットリロード (watch モード)

YAML を編集しながら間取りを試行錯誤するときに使う。`watch` サブコマンドで対象 YAML を監視し、保存のたびに SVG / HTML プレビュー / (任意) area.json を再生成する。

```bash
npm run build
npm run watch -- samples/3ldk-house.yaml
# 別ターミナル or エディタで samples/3ldk-house.yaml を編集 → 保存
# 同階層の samples/3ldk-house.html をブラウザで開いてリロードするとすぐ反映される
```

出力 SVG の保存先や area.json も指定可能:

```bash
npm run watch -- samples/3ldk-house.yaml output/plan.svg --area-table
```

YAML が壊れている間はエラーを表示して監視を継続する (プロセスは落ちない)。Ctrl+C で停止。

### サンプル一覧

`samples/` ディレクトリに用途別のサンプルを用意している。

```bash
npm run render:sample --name=basic-3room       # 基本3部屋 (LDK+寝室+浴室)
npm run render:sample --name=1r-studio        # 1R ワンルーム (最小構成)
npm run render:sample --name=2ldk-apartment    # 2LDK マンション
npm run render:sample --name=3ldk-house        # 3LDK 戸建 (東向き玄関)
npm run render:sample --name=l-shaped-plan     # L字型間取り (北向き玄関)
npm run render:sample --name=compact-2dk       # コンパクト2DK (西向き玄関)
npm run render:sample --name=4ldk-complex      # 4LDK+sub_rooms (浴室/洗面分割、クローゼット分割)
npm run render:sample --name=custom-walls-invalid      # 明示壁定義 (バリデーションエラーあり)
npm run render:sample --name=4ldk-complex-invalid      # 4LDK (sub_rooms未定義、ISOLATED_SUBAREA検出)
npm run render:sample --name=l-shaped-ldk              # L字型LDK (grid_rects multi-rect)
npm run render:sample --name=u-shaped-courtyard        # コの字型中庭プラン
npm run render:sample --name=twin-courtyard            # ツイン中庭プラン
npm run render:sample --name=3ldk-with-equipment       # 3LDK+設備配置 (キッチン・UB・トイレ・洗面・洗濯機・冷蔵庫)
```

SVG と HTML プレビューが `samples/` 内に出力される。
