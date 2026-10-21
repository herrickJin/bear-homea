/** In-memory UI sample; no real products, quotes or purchasing recommendations. */
export type RecordSection = "soft" | "hard";
export type RecordStatus = "saved" | "shortlist" | "bought";
export const recordRooms = [
  "全屋",
  "客厅",
  "餐厅",
  "主卧",
  "次卧",
  "厨房",
  "卫生间",
  "阳台",
];
export const materialKinds = ["主材", "辅材", "五金"];
export const recordStatusLabels: Record<RecordStatus, string> = {
  saved: "候选",
  shortlist: "已选定",
  bought: "已买",
};
export interface PurchaseRecord {
  id: string;
  section: RecordSection;
  room: string;
  category: string;
  name: string;
  price: number | null;
  unit: string;
  pros: string;
  cons: string;
  note: string;
  status: RecordStatus;
  itemId?: string;
  url?: string;
  specs?: Record<string, string>;
  images?: string[];
  analysis?: string;
  analysisSources?: { label: string; url: string }[];
}
export const recordSeed: PurchaseRecord[] = [
  {
    id: "sofa-1",
    section: "soft",
    room: "客厅",
    category: "沙发",
    name: "轻织 · 布艺三人沙发",
    price: 7299,
    unit: "件",
    pros: "布套可拆洗，扫地机器人能进入",
    cons: "浅色容易显脏，靠背偏低",
    note: "260 × 95 cm，浅燕麦色。展厅试坐舒服，线上报价不含上楼费。",
    status: "shortlist",
  },
  {
    id: "sofa-2",
    section: "soft",
    room: "客厅",
    category: "沙发",
    name: "原木 · 模块沙发",
    price: 8600,
    unit: "件",
    pros: "坐深大，模块可以拆分",
    cons: "尺寸偏大，底部不方便清扫",
    note: "280 × 105 cm，暖灰色。家具卖场含送货安装。",
    status: "saved",
  },
  {
    id: "sofa-3",
    section: "soft",
    room: "客厅",
    category: "沙发",
    name: "弧线 · 皮质三人沙发",
    price: 9200,
    unit: "件",
    pros: "污渍可擦拭，坐起方便",
    cons: "价格较高，颜色需要看实物",
    note: "250 × 92 cm，焦糖色。门店报价含送货安装。",
    status: "saved",
  },
  {
    id: "tv",
    section: "soft",
    room: "客厅",
    category: "电视",
    name: "清映 · 75 英寸电视",
    price: 4299,
    unit: "台",
    pros: "尺寸合适，游戏接口够用",
    cons: "壁挂后接口不易操作",
    note: "安装另加 200 元，确认插座位置。",
    status: "bought",
  },
  {
    id: "ac",
    section: "soft",
    room: "主卧",
    category: "空调",
    name: "静风 · 1.5 匹挂机",
    price: 3699,
    unit: "台",
    pros: "风感柔和，适合睡眠",
    cons: "柔风模式制冷较慢",
    note: "含 3 米铜管，高空费另计。",
    status: "shortlist",
  },
  {
    id: "bed",
    section: "soft",
    room: "主卧",
    category: "床垫",
    name: "舒眠 · 1.8 米床垫",
    price: null,
    unit: "件",
    pros: "支撑适中，试躺舒服",
    cons: "还没问活动价",
    note: "周末再去试一次，和床架一起看。",
    status: "saved",
  },
  {
    id: "fridge",
    section: "soft",
    room: "厨房",
    category: "冰箱",
    name: "薄嵌 · 460L 十字门",
    price: 5699,
    unit: "台",
    pros: "深度与橱柜匹配",
    cons: "抽屉拆洗稍麻烦",
    note: "宽 83 × 深 60 cm，含配送和旧机回收。",
    status: "bought",
  },
  {
    id: "floor",
    section: "hard",
    room: "全屋",
    category: "主材",
    name: "浅橡 · 多层实木地板",
    price: 228,
    unit: "㎡",
    pros: "脚感舒适，木纹自然",
    cons: "不含找平与踢脚线",
    note: "厚 15 mm，预计 65㎡。带样板回家看看自然光。",
    status: "shortlist",
  },
  {
    id: "tile",
    section: "hard",
    room: "厨房",
    category: "主材",
    name: "雾白 · 哑光地砖",
    price: 89,
    unit: "片",
    pros: "颜色干净，容易搭配",
    cons: "表面防滑效果待确认",
    note: "600 × 600 mm，建材市场报价。",
    status: "saved",
  },
  {
    id: "waterproof",
    section: "hard",
    room: "卫生间",
    category: "辅材",
    name: "柔性防水涂料",
    price: 298,
    unit: "桶",
    pros: "适合潮湿空间",
    cons: "需要确认施工用量",
    note: "一桶 18 kg，问问工长需要几桶。",
    status: "saved",
  },
  {
    id: "tap",
    section: "hard",
    room: "厨房",
    category: "五金",
    name: "抽拉式厨房龙头",
    price: 899,
    unit: "件",
    pros: "洗锅方便，出水口够高",
    cons: "抽拉回位手感要试",
    note: "确认台面开孔和冷热水接口。",
    status: "shortlist",
  },
];
