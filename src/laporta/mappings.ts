import { EquipmentMapping, InteriorFinishSpec, OpeningStyleMapping, RoomTypeMapping } from './types.js';

// 仕上げバンドル (天井高2400mm想定で壁面積=床面積×2.4で近似)
const LIVING_FINISH: InteriorFinishSpec[] = [
  { code: 'IN-009', areaMultiplier: 1.0, surface: 'floor' },   // フローリング(複合)
  { code: 'IN-005', areaMultiplier: 2.4, surface: 'wall' },    // クロス(量産品)
  { code: 'IN-005', areaMultiplier: 1.0, surface: 'ceiling' }, // クロス天井
];

const DRY_AREA_FINISH: InteriorFinishSpec[] = [
  { code: 'IN-011', areaMultiplier: 1.0, surface: 'floor' },   // フロアタイル
  { code: 'IN-005', areaMultiplier: 2.4, surface: 'wall' },
  { code: 'IN-005', areaMultiplier: 1.0, surface: 'ceiling' },
];

const WET_AREA_FINISH: InteriorFinishSpec[] = [
  { code: 'IN-019', areaMultiplier: 1.0, surface: 'floor' },   // タイル張り(床・300角)
  { code: 'IN-018', areaMultiplier: 2.4, surface: 'wall' },    // タイル張り(壁・300角)
  { code: 'IN-007', areaMultiplier: 1.0, surface: 'ceiling' }, // 塗装(EP)
];

const ENTRY_FINISH: InteriorFinishSpec[] = [
  { code: 'IN-019', areaMultiplier: 1.0, surface: 'floor' },   // タイル張り(床)
  { code: 'IN-005', areaMultiplier: 2.4, surface: 'wall' },
  { code: 'IN-005', areaMultiplier: 1.0, surface: 'ceiling' },
];

// オフィス: 床=タイルカーペット(IN-008)、壁=クロス(IN-005)、天井=システム天井/岩綿吸音板(IN-014)
const OFFICE_FINISH: InteriorFinishSpec[] = [
  { code: 'IN-008', areaMultiplier: 1.0, surface: 'floor' },   // タイルカーペット
  { code: 'IN-005', areaMultiplier: 2.8, surface: 'wall' },    // クロス(天井高2800mm想定で壁面積≒床面積×2.8)
  { code: 'IN-014', areaMultiplier: 1.0, surface: 'ceiling' }, // システム天井(岩綿吸音板)
];

// 和室: 床=畳表替え (1帖 ≒ 1.62m² なので multiplier=1/1.62≒0.617)、壁=漆喰、天井=クロス
// 新築時は IN-071 畳新調 (¥7,600/帖) に差し替え
const TATAMI_FINISH: InteriorFinishSpec[] = [
  { code: 'IN-072', areaMultiplier: 0.617, surface: 'floor' },   // 畳表替え (m² → 帖換算)
  { code: 'IN-087', areaMultiplier: 2.4, surface: 'wall' },      // 左官仕上(漆喰)
  { code: 'IN-005', areaMultiplier: 1.0, surface: 'ceiling' },   // クロス天井 (代替)
];

export const ROOM_TYPE_MAPPINGS: RoomTypeMapping[] = [
  {
    archilangType: 'LDK',
    costMasterRoomTags: ['LDK', 'リビング', 'ダイニング', 'キッチン'],
    defaultInteriorItems: ['IN-001'],
    finishItems: LIVING_FINISH,
  },
  {
    archilangType: '寝室',
    costMasterRoomTags: ['寝室', '個室'],
    defaultInteriorItems: ['IN-001'],
    finishItems: LIVING_FINISH,
  },
  {
    archilangType: '主寝室',
    costMasterRoomTags: ['寝室', '主寝室'],
    defaultInteriorItems: ['IN-001'],
    finishItems: LIVING_FINISH,
  },
  {
    archilangType: '子供部屋',
    costMasterRoomTags: ['子供部屋', '個室'],
    defaultInteriorItems: ['IN-001'],
    finishItems: LIVING_FINISH,
  },
  {
    archilangType: '和室',
    costMasterRoomTags: ['和室'],
    defaultInteriorItems: [],
    finishItems: TATAMI_FINISH,
  },
  {
    archilangType: '浴室',
    costMasterRoomTags: ['浴室'],
    defaultInteriorItems: [],
    finishItems: WET_AREA_FINISH,
  },
  {
    archilangType: '洗面脱衣',
    costMasterRoomTags: ['洗面', '脱衣'],
    defaultInteriorItems: [],
    finishItems: DRY_AREA_FINISH,
  },
  {
    archilangType: 'トイレ',
    costMasterRoomTags: ['トイレ'],
    defaultInteriorItems: [],
    finishItems: DRY_AREA_FINISH,
  },
  {
    archilangType: '玄関',
    costMasterRoomTags: ['玄関'],
    defaultInteriorItems: [],
    finishItems: ENTRY_FINISH,
  },
  {
    archilangType: '廊下',
    costMasterRoomTags: ['廊下'],
    defaultInteriorItems: ['IN-001'],
    finishItems: LIVING_FINISH,
  },
  {
    archilangType: 'リビング・ダイニング',
    costMasterRoomTags: ['LDK', 'リビング', 'ダイニング'],
    defaultInteriorItems: ['IN-001'],
    finishItems: LIVING_FINISH,
  },
  {
    archilangType: 'キッチン',
    costMasterRoomTags: ['キッチン'],
    defaultInteriorItems: [],
    finishItems: DRY_AREA_FINISH,
  },
  // 追加マッピング (samples/* で実出現する type)
  { archilangType: '居室', costMasterRoomTags: ['居室', '個室'], defaultInteriorItems: [], finishItems: LIVING_FINISH },
  { archilangType: '洋室', costMasterRoomTags: ['洋室', '個室'], defaultInteriorItems: [], finishItems: LIVING_FINISH },
  { archilangType: '洋室1', costMasterRoomTags: ['洋室'], defaultInteriorItems: [], finishItems: LIVING_FINISH },
  { archilangType: '洋室2', costMasterRoomTags: ['洋室'], defaultInteriorItems: [], finishItems: LIVING_FINISH },
  { archilangType: 'リビング', costMasterRoomTags: ['リビング'], defaultInteriorItems: [], finishItems: LIVING_FINISH },
  { archilangType: 'ダイニング', costMasterRoomTags: ['ダイニング'], defaultInteriorItems: [], finishItems: LIVING_FINISH },
  { archilangType: 'DK', costMasterRoomTags: ['DK', 'ダイニング', 'キッチン'], defaultInteriorItems: [], finishItems: LIVING_FINISH },
  { archilangType: 'ダイニングキッチン', costMasterRoomTags: ['DK'], defaultInteriorItems: [], finishItems: LIVING_FINISH },
  { archilangType: 'ホール', costMasterRoomTags: ['ホール'], defaultInteriorItems: [], finishItems: LIVING_FINISH },
  { archilangType: '玄関ホール', costMasterRoomTags: ['玄関', 'ホール'], defaultInteriorItems: [], finishItems: ENTRY_FINISH },
  { archilangType: '収納', costMasterRoomTags: ['収納'], defaultInteriorItems: [], finishItems: DRY_AREA_FINISH },
  { archilangType: '収納(上)', costMasterRoomTags: ['収納'], defaultInteriorItems: [], finishItems: DRY_AREA_FINISH },
  { archilangType: '収納(下)', costMasterRoomTags: ['収納'], defaultInteriorItems: [], finishItems: DRY_AREA_FINISH },
  { archilangType: 'ウォークインクローゼット', costMasterRoomTags: ['収納', 'WIC'], defaultInteriorItems: [], finishItems: DRY_AREA_FINISH },
  { archilangType: 'シューズクローク', costMasterRoomTags: ['玄関', '収納'], defaultInteriorItems: [], finishItems: DRY_AREA_FINISH },
  { archilangType: 'ゲストルーム', costMasterRoomTags: ['個室'], defaultInteriorItems: [], finishItems: LIVING_FINISH },
  { archilangType: '書斎', costMasterRoomTags: ['個室'], defaultInteriorItems: [], finishItems: LIVING_FINISH },
  { archilangType: '子供部屋1', costMasterRoomTags: ['子供部屋'], defaultInteriorItems: [], finishItems: LIVING_FINISH },
  { archilangType: '子供部屋2', costMasterRoomTags: ['子供部屋'], defaultInteriorItems: [], finishItems: LIVING_FINISH },
  { archilangType: '浴室・洗面', costMasterRoomTags: ['浴室', '洗面'], defaultInteriorItems: [], finishItems: WET_AREA_FINISH },
  { archilangType: '浴室・洗面脱衣', costMasterRoomTags: ['浴室', '洗面'], defaultInteriorItems: [], finishItems: WET_AREA_FINISH },
  { archilangType: '洗面', costMasterRoomTags: ['洗面'], defaultInteriorItems: [], finishItems: DRY_AREA_FINISH },
  { archilangType: '洗面脱衣室', costMasterRoomTags: ['洗面', '脱衣'], defaultInteriorItems: [], finishItems: DRY_AREA_FINISH },
  // オフィス用 room type
  { archilangType: 'エントランス', costMasterRoomTags: ['玄関', 'ホール'], defaultInteriorItems: [], finishItems: ENTRY_FINISH },
  { archilangType: '執務室', costMasterRoomTags: ['事務室', 'オフィス'], defaultInteriorItems: [], finishItems: OFFICE_FINISH },
  { archilangType: '会議室', costMasterRoomTags: ['会議室'], defaultInteriorItems: [], finishItems: OFFICE_FINISH },
  { archilangType: '給湯室', costMasterRoomTags: ['給湯室', 'キッチン'], defaultInteriorItems: [], finishItems: DRY_AREA_FINISH },
  { archilangType: 'サーバー室', costMasterRoomTags: ['収納', '機械室'], defaultInteriorItems: [], finishItems: DRY_AREA_FINISH },
];

export const EQUIPMENT_MAPPINGS: EquipmentMapping[] = [
  { archilangType: 'kitchen_counter', costMasterCode: 'WW-009' },
  { archilangType: 'unit_bath', costMasterCode: 'EQ-HTL-106' },
  { archilangType: 'toilet', costMasterCode: 'EQ-HTL-110' },
  { archilangType: 'washbasin', costMasterCode: 'WW-005' },
  { archilangType: 'washing_machine', costMasterCode: null },
  { archilangType: 'refrigerator', costMasterCode: null },
];

export const OPENING_STYLE_MAPPINGS: OpeningStyleMapping[] = [
  { style: '引違い窓', type: 'AW', costMasterCode: 'FX-016' },
  { style: '片開き', type: 'WD', costMasterCode: 'FX-049' },
  { style: '片開き', type: 'AD', costMasterCode: 'FX-004' },
  { style: '引き戸', type: 'WD', costMasterCode: 'FX-051' },
  { style: '親子玄関', type: 'AD', costMasterCode: 'FX-047' },
];
