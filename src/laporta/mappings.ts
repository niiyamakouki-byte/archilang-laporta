import { EquipmentMapping, OpeningStyleMapping, RoomTypeMapping } from './types.js';

export const ROOM_TYPE_MAPPINGS: RoomTypeMapping[] = [
  {
    archilangType: 'LDK',
    costMasterRoomTags: ['LDK', 'リビング', 'ダイニング', 'キッチン'],
    defaultInteriorItems: ['IN-001'],
  },
  {
    archilangType: '寝室',
    costMasterRoomTags: ['寝室', '個室'],
    defaultInteriorItems: ['IN-001'],
  },
  {
    archilangType: '主寝室',
    costMasterRoomTags: ['寝室', '主寝室'],
    defaultInteriorItems: ['IN-001'],
  },
  {
    archilangType: '子供部屋',
    costMasterRoomTags: ['子供部屋', '個室'],
    defaultInteriorItems: ['IN-001'],
  },
  {
    archilangType: '和室',
    costMasterRoomTags: ['和室'],
    defaultInteriorItems: [],
  },
  {
    archilangType: '浴室',
    costMasterRoomTags: ['浴室'],
    defaultInteriorItems: [],
  },
  {
    archilangType: '洗面脱衣',
    costMasterRoomTags: ['洗面', '脱衣'],
    defaultInteriorItems: [],
  },
  {
    archilangType: 'トイレ',
    costMasterRoomTags: ['トイレ'],
    defaultInteriorItems: [],
  },
  {
    archilangType: '玄関',
    costMasterRoomTags: ['玄関'],
    defaultInteriorItems: [],
  },
  {
    archilangType: '廊下',
    costMasterRoomTags: ['廊下'],
    defaultInteriorItems: ['IN-001'],
  },
  {
    archilangType: 'リビング・ダイニング',
    costMasterRoomTags: ['LDK', 'リビング', 'ダイニング'],
    defaultInteriorItems: ['IN-001'],
  },
  {
    archilangType: 'キッチン',
    costMasterRoomTags: ['キッチン'],
    defaultInteriorItems: [],
  },
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
