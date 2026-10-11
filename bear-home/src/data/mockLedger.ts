/**
 * 选购台账 · 数据与本地存储（服务端落地前的第一版，接 API 后仅 services 层替换）
 * 一行 = 一次看到的报价：同一款产品多渠道 = 多行，不判重（重复正是比价素材）。
 * 存储走 Taro storage（H5=localStorage / 小程序=本地缓存），函数返回副本，
 * 禁止外部直接改内部状态。换设备/清缓存即失，服务端落地前别当唯一真源。
 */
import Taro from "@tarojs/taro";

export type LedgerKind = "appliance" | "material";

export type LedgerStatus = "looking" | "shortlist" | "bought" | "dropped";

export interface LedgerItem {
  id: string;
  kind: LedgerKind;
  /** 品类（自由文本；预置见 categoryPresets） */
  category: string;
  /** 品牌 + 型号，如「格力 云逸-II 1.5匹」 */
  name: string;
  /** 元；null = 未问价 */
  price: number | null;
  channel: string | null;
  note: string | null;
  status: LedgerStatus;
  date: string; // YYYY-MM-DD
}

export interface LedgerDraft {
  kind: LedgerKind;
  category: string;
  name: string;
  price: number | null;
  channel: string | null;
  note: string | null;
  status: LedgerStatus;
}

/** CategoryTabs 消费的形态（与笔记库 Category 同构，id 即品类名） */
export interface LedgerCategory {
  id: string;
  name: string;
  sort: number;
}

/* ===== 预置（前端常量为单一真源，服务端只存字符串） ===== */

export const kindLabels: Record<LedgerKind, string> = {
  appliance: "家电",
  material: "材料",
};

export const categoryPresets: Record<LedgerKind, string[]> = {
  appliance: [
    "空调",
    "冰箱",
    "洗衣机",
    "电视",
    "热水器",
    "油烟机灶具",
    "洗碗机",
    "净水",
    "新风地暖",
  ],
  material: [
    "瓷砖",
    "地板",
    "乳胶漆",
    "定制柜",
    "木门",
    "卫浴",
    "五金",
    "灯具",
    "窗帘软装",
  ],
};

export const channelPresets = [
  "京东",
  "天猫",
  "拼多多",
  "苏宁",
  "线下卖场",
  "建材市场",
  "工长代购",
  "厂家直营",
];

export const statusOrder: LedgerStatus[] = [
  "looking",
  "shortlist",
  "bought",
  "dropped",
];

export const statusMeta: Record<LedgerStatus, { label: string }> = {
  looking: { label: "在看" },
  shortlist: { label: "候选" },
  bought: { label: "已买" },
  dropped: { label: "放弃" },
};

/* ===== 示例数据（仅首次播种，之后以本地存储为准） ===== */

const seedItems: LedgerItem[] = [
  {
    id: "item-seed-001",
    kind: "appliance",
    category: "空调",
    name: "美的 酷省电 1.5匹 新一级",
    price: 6100,
    channel: "苏宁",
    note: "线下价可谈，送延保",
    status: "shortlist",
    date: "2026-10-11",
  },
  {
    id: "item-seed-002",
    kind: "appliance",
    category: "空调",
    name: "格力 云逸-II 1.5匹",
    price: 5699,
    channel: "京东",
    note: "新一级能效，含基础安装",
    status: "looking",
    date: "2026-10-09",
  },
  {
    id: "item-seed-003",
    kind: "appliance",
    category: "空调",
    name: "华凌 N8HE1 1.5匹",
    price: 4899,
    channel: "京东",
    note: "性价比高，售后是二线",
    status: "looking",
    date: "2026-10-08",
  },
  {
    id: "item-seed-004",
    kind: "appliance",
    category: "冰箱",
    name: "容声 452L 零嵌 十字门",
    price: 4599,
    channel: "线下卖场",
    note: "超薄零嵌，深度 59cm，能进预留位",
    status: "shortlist",
    date: "2026-10-10",
  },
  {
    id: "item-seed-005",
    kind: "appliance",
    category: "冰箱",
    name: "海尔 501L 十字对开门",
    price: 4299,
    channel: "京东",
    note: null,
    status: "looking",
    date: "2026-10-05",
  },
  {
    id: "item-seed-006",
    kind: "appliance",
    category: "洗衣机",
    name: "小天鹅 小乌梅 10kg 洗烘一体",
    price: 3899,
    channel: "天猫",
    note: "双十一价，已下单",
    status: "bought",
    date: "2026-10-02",
  },
  {
    id: "item-seed-101",
    kind: "material",
    category: "瓷砖",
    name: "马可波罗 750×1500 哑光",
    price: 128,
    channel: "建材市场",
    note: "客厅通铺，第三家报价",
    status: "looking",
    date: "2026-10-11",
  },
  {
    id: "item-seed-102",
    kind: "material",
    category: "瓷砖",
    name: "东鹏 750×1500 同款纹",
    price: 118,
    channel: "建材市场",
    note: "可再砍，留样对比",
    status: "looking",
    date: "2026-10-11",
  },
  {
    id: "item-seed-103",
    kind: "material",
    category: "乳胶漆",
    name: "立邦 童享全效 18L×2",
    price: 1180,
    channel: "京东",
    note: "含调色，工长认可的牌子",
    status: "bought",
    date: "2026-10-03",
  },
  {
    id: "item-seed-104",
    kind: "material",
    category: "乳胶漆",
    name: "多乐士 致悦 底面套装",
    price: 980,
    channel: "天猫",
    note: "环保数据一般，放弃",
    status: "dropped",
    date: "2026-09-28",
  },
  {
    id: "item-seed-105",
    kind: "material",
    category: "木门",
    name: "TATA 静音门 免漆",
    price: 2380,
    channel: "线下卖场",
    note: "按 4 樘算，含五金",
    status: "shortlist",
    date: "2026-09-25",
  },
];

/* ===== 本地存储仓 ===== */

const STORAGE_KEY = "bear-ledger-items-v1";

let cache: LedgerItem[] | null = null;

function persist(): void {
  if (!cache) return;
  try {
    Taro.setStorageSync(STORAGE_KEY, JSON.stringify(cache));
  } catch {
    /* 存储满/隐私模式：内存里继续用 */
  }
}

function load(): LedgerItem[] {
  if (cache) return cache;
  try {
    const raw = Taro.getStorageSync(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as LedgerItem[];
      if (Array.isArray(parsed)) {
        cache = parsed;
        return cache;
      }
    }
  } catch {
    /* 损坏即重播种 */
  }
  cache = seedItems.map((s) => ({ ...s }));
  persist();
  return cache;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function listItems(kind?: LedgerKind): LedgerItem[] {
  const items = load();
  return items
    .filter((i) => !kind || i.kind === kind)
    .map((i) => ({ ...i }));
}

export function addItem(draft: LedgerDraft): LedgerItem {
  const item: LedgerItem = {
    id: `item-${Date.now()}`,
    kind: draft.kind,
    category: draft.category,
    name: draft.name,
    price: draft.price,
    channel: draft.channel,
    note: draft.note,
    status: draft.status,
    date: today(),
  };
  const items = load();
  cache = [item, ...items];
  persist();
  return { ...item };
}

export function updateItem(
  id: string,
  patch: Partial<Omit<LedgerItem, "id">>,
): LedgerItem | null {
  const items = load();
  const index = items.findIndex((i) => i.id === id);
  if (index < 0) return null;
  const updated: LedgerItem = { ...items[index], ...patch };
  cache = items.map((i, k) => (k === index ? updated : i));
  persist();
  return { ...updated };
}

export function deleteItem(id: string): void {
  const items = load();
  cache = items.filter((i) => i.id !== id);
  persist();
}

/* ===== 派生与工具 ===== */

/** 过滤：一级 + 品类（null=全部）+ 关键词（名称/渠道/备注/品类） */
export function filterItems(
  source: readonly LedgerItem[],
  kind: LedgerKind,
  category: string | null,
  query: string,
): LedgerItem[] {
  const q = query.trim().toLowerCase();
  return source.filter((i) => {
    if (i.kind !== kind) return false;
    if (category && i.category !== category) return false;
    if (!q) return true;
    return [i.name, i.channel, i.note, i.category].some((field) =>
      (field ?? "").toLowerCase().includes(q),
    );
  });
}

/**
 * 品类分组：预置品类固定序在前（含空品类，空节不返回），
 * 自定义品类在后，按最近一条记录排。
 */
export function groupItems(
  source: readonly LedgerItem[],
  kind: LedgerKind,
): { category: string; items: LedgerItem[] }[] {
  const latest = new Map<string, string>();
  for (const i of source) {
    const prev = latest.get(i.category);
    if (!prev || i.date > prev) latest.set(i.category, i.date);
  }
  const customs = [...latest.keys()]
    .filter((c) => !categoryPresets[kind].includes(c))
    .sort((a, b) => (latest.get(b) ?? "").localeCompare(latest.get(a) ?? ""));
  const order = [...categoryPresets[kind], ...customs];
  return order
    .map((category) => ({
      category,
      items: source.filter((i) => i.category === category),
    }))
    .filter((s) => s.items.length > 0);
}

/** 节内排序：价格升序（无价沉底）；byDate = 最近记录在前 */
export function sortItems(
  source: readonly LedgerItem[],
  by: "price" | "date",
): LedgerItem[] {
  const items = source.map((i) => ({ ...i }));
  if (by === "date") {
    return items.sort((a, b) => b.date.localeCompare(a.date));
  }
  return items.sort((a, b) => {
    if (a.price == null && b.price == null) return b.date.localeCompare(a.date);
    if (a.price == null) return 1;
    if (b.price == null) return -1;
    return a.price - b.price;
  });
}

/** ¥1,299（引擎无关的千分位，不依赖 toLocaleString） */
export function formatPrice(price: number): string {
  const n = Math.round(price);
  const sign = n < 0 ? "-" : "";
  return `${sign}¥${Math.abs(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
}

/** 品类价格区间：「¥4,899–6,100」；不足两条有价返回单值 */
export function priceRange(items: readonly LedgerItem[]): string | null {
  const prices = items
    .map((i) => i.price)
    .filter((p): p is number => p != null);
  if (prices.length === 0) return null;
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  if (min === max) return formatPrice(min);
  return `${formatPrice(min)}–${formatPrice(max).slice(1)}`;
}

/** 台账品类页签：预置 + 出现过的自定义品类（按最近使用） */
export function categoryList(
  source: readonly LedgerItem[],
  kind: LedgerKind,
): LedgerCategory[] {
  const presets = categoryPresets[kind];
  const customs = [...new Set(source.filter((i) => i.kind === kind).map((i) => i.category))]
    .filter((c) => !presets.includes(c));
  return [...presets, ...customs].map((name, sort) => ({
    id: name,
    name,
    sort,
  }));
}

export function displayDate(date: string): string {
  return date.slice(5).replace("-", ".");
}
