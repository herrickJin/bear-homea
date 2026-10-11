/**
 * 方案库 · Mock 数据与内存存储（UI 先行阶段，后端设计确认后替换）
 * 存储函数返回副本，禁止外部直接改内部状态。
 */

export interface Category {
  id: string;
  name: string;
  sort: number;
}

export type LinkStatus = "pending" | "processing" | "done" | "failed";

/** mock 截图占位色（真实截图接入后由 shotPath 替代） */
export type ShotTint = "honey" | "wood" | "clay" | "mint";

export interface InspirationNote {
  id: string;
  body: string;
  date: string;
}

export interface InspirationLink {
  id: string;
  /** 链接型方案有 url；纯想法为 null（note 即正文） */
  url: string | null;
  /** 用户要点 = 卡片标题位（最高优先级） */
  note: string | null;
  /** Agent 抓取标题（次优先级） */
  title: string | null;
  summary: string | null;
  categoryIds: string[];
  /** 用户截图本地路径（选图后临时路径） */
  shotPath: string | null;
  /** 服务端解析到的网页封面（如小红书笔记首图） */
  coverUrl?: string | null;
  /** 方案备注时间线（真实后端返回；mock 模式为空） */
  notes?: InspirationNote[];
  /** mock 截图占位色 */
  shotTint: ShotTint | null;
  source: string;
  status: LinkStatus;
  date: string;
}

export interface SaveDraft {
  /** http(s) 开头 → 链接型；否则为纯想法（url 为 null，note 即正文） */
  url: string | null;
  /** 从分享文本解析出的标题（链接型专用） */
  title: string | null;
  categoryIds: string[];
  note: string;
  shotPath: string | null;
}

export const initialCategories: Category[] = [
  { id: "cat-all", name: "全屋", sort: 0 },
  { id: "cat-living", name: "客厅", sort: 1 },
  { id: "cat-kitchen", name: "厨房", sort: 2 },
  { id: "cat-bedroom", name: "卧室", sort: 3 },
  { id: "cat-bath", name: "卫生间", sort: 4 },
  { id: "cat-balcony", name: "阳台", sort: 5 },
  { id: "cat-ceiling", name: "吊顶", sort: 6 },
  { id: "cat-storage", name: "收纳", sort: 7 },
];

export const initialLinks: InspirationLink[] = [
  {
    id: "link-009",
    url: null,
    note: "客厅窗帘选燕麦色，全屋色彩更柔和",
    title: null,
    summary: null,
    categoryIds: ["cat-living"],
    shotPath: null,
    shotTint: null,
    source: "想法",
    status: "done",
    date: "2026-10-13",
  },
  {
    id: "link-001",
    url: "https://www.xiaohongshu.com/discovery/item/68f1a2b3000000001203a4f1",
    note: "厨房吊柜无把手，底部留感应灯带",
    title: "小厨房显大秘诀｜无把手吊柜 + 感应灯带",
    summary: "吊柜通顶做无把手开门器，柜底贴 3000K 感应灯带……",
    categoryIds: ["cat-kitchen", "cat-ceiling"],
    shotPath: null,
    shotTint: "honey",
    source: "xiaohongshu.com",
    status: "done",
    date: "2026-10-12",
  },
  {
    id: "link-002",
    url: "https://www.xiaohongshu.com/discovery/item/68ee11c9000000001203b7e2",
    note: "悬浮岛台底部留空 30cm，扫地机自由进出",
    title: "岛台不落地，家务动线顺手十倍",
    summary: null,
    categoryIds: ["cat-kitchen"],
    shotPath: null,
    shotTint: null,
    source: "xiaohongshu.com",
    status: "done",
    date: "2026-10-11",
  },
  {
    id: "link-003",
    url: "https://www.xiaohongshu.com/discovery/item/68e2c47a00000000120344aa",
    note: "阳台洗衣柜 + 拖把池一体，上方留挂衣杆",
    title: "阳台家务区这样装，洗衣晾晒一条龙",
    summary: null,
    categoryIds: ["cat-balcony", "cat-storage"],
    shotPath: null,
    shotTint: "wood",
    source: "xiaohongshu.com",
    status: "done",
    date: "2026-10-08",
  },
  {
    id: "link-004",
    url: "https://www.xiaohongshu.com/discovery/item/68dd55f1000000001203cc91",
    note: "客厅无主灯，磁吸轨道灯的具体走法",
    title: null,
    summary: null,
    categoryIds: ["cat-living", "cat-ceiling"],
    shotPath: null,
    shotTint: null,
    source: "xiaohongshu.com",
    status: "failed",
    date: "2026-10-05",
  },
  {
    id: "link-005",
    url: "https://www.xiaohongshu.com/discovery/item/68d7e2200000000012039bd4",
    note: "卫生间壁龛替代置物架，尺寸别做太浅",
    title: null,
    summary: null,
    categoryIds: ["cat-bath"],
    shotPath: null,
    shotTint: null,
    source: "xiaohongshu.com",
    status: "pending",
    date: "2026-10-03",
  },
  {
    id: "link-006",
    url: "https://www.xiaohongshu.com/discovery/item/68cf991100000000120377e8",
    note: "玄关洞洞板，钥匙雨伞全归位",
    title: "入户洞洞板，小物件不再满桌飞",
    summary: null,
    categoryIds: ["cat-storage"],
    shotPath: null,
    shotTint: null,
    source: "xiaohongshu.com",
    status: "done",
    date: "2026-09-30",
  },
  {
    id: "link-007",
    url: "https://www.xiaohongshu.com/discovery/item/68c4ab330000000012035f2d",
    note: "小卧室榻榻米 + 书桌一体，收纳在床下",
    title: "8㎡ 小卧室救星：榻榻米书桌一体",
    summary: "榻榻米箱体收纳换季被褥，床头延伸书桌 1.2m……",
    categoryIds: ["cat-bedroom", "cat-storage"],
    shotPath: null,
    shotTint: "clay",
    source: "xiaohongshu.com",
    status: "done",
    date: "2026-09-28",
  },
  {
    id: "link-008",
    url: "https://www.xiaohongshu.com/discovery/item/68bb77020000000012031e66",
    note: "全屋收纳规划：柜子别做太深，35cm 够用",
    title: "收纳翻车合集：这些尺寸坑别再踩",
    summary: null,
    categoryIds: ["cat-all"],
    shotPath: null,
    shotTint: null,
    source: "xiaohongshu.com",
    status: "done",
    date: "2026-09-25",
  },
];

/* ===== 内存存储（返回副本） ===== */

let categories: Category[] = initialCategories.map((c) => ({ ...c }));
let links: InspirationLink[] = initialLinks.map((l) => ({ ...l }));

export function listCategories(): Category[] {
  return categories.map((c) => ({ ...c }));
}

export function listLinks(): InspirationLink[] {
  return links.map((l) => ({ ...l, categoryIds: [...l.categoryIds] }));
}

export function findLinkById(id: string): InspirationLink | null {
  const found = links.find((l) => l.id === id);
  return found ? { ...found, categoryIds: [...found.categoryIds] } : null;
}

export function findLinkByUrl(url: string): InspirationLink | null {
  const found = links.find((l) => l.url === url.trim());
  return found ? { ...found, categoryIds: [...found.categoryIds] } : null;
}

export function addLink(draft: SaveDraft): InspirationLink {
  const link: InspirationLink = {
    id: `link-${Date.now()}`,
    url: draft.url,
    note: draft.note.trim() || null,
    title: draft.title?.trim() || null,
    summary: null,
    categoryIds: [...draft.categoryIds],
    shotPath: draft.shotPath,
    shotTint: null,
    source: draft.url ? hostnameOf(draft.url) : "想法",
    status: draft.url ? "pending" : "done",
    date: new Date().toISOString().slice(0, 10),
  };
  links = [link, ...links];
  return { ...link, categoryIds: [...link.categoryIds] };
}

export function updateLink(
  id: string,
  patch: Partial<Omit<InspirationLink, "id" | "url">>,
): InspirationLink | null {
  const index = links.findIndex((l) => l.id === id);
  if (index < 0) return null;
  const current = links[index];
  const updated: InspirationLink = {
    ...current,
    ...patch,
    categoryIds: patch.categoryIds
      ? [...patch.categoryIds]
      : [...current.categoryIds],
  };
  links = links.map((l, i) => (i === index ? updated : l));
  return { ...updated, categoryIds: [...updated.categoryIds] };
}

export function deleteLink(id: string): void {
  links = links.filter((l) => l.id !== id);
}

/** 删除单条备注（时间线） */
export function deleteNote(linkId: string, noteId: string): void {
  links = links.map((l) =>
    l.id === linkId
      ? { ...l, notes: (l.notes ?? []).filter((n) => n.id !== noteId) }
      : l,
  );
}

export function addCategory(name: string): Category {
  const category: Category = {
    id: `cat-${Date.now()}`,
    name: name.trim(),
    sort: categories.length,
  };
  categories = [...categories, category];
  return { ...category };
}

export function renameCategory(id: string, name: string): void {
  categories = categories.map((c) =>
    c.id === id ? { ...c, name: name.trim() } : c,
  );
}

/** 删除分类：方案本身保留，仅剥离该标签 */
export function deleteCategory(id: string): void {
  categories = categories.filter((c) => c.id !== id);
  links = links.map((l) => ({
    ...l,
    categoryIds: l.categoryIds.filter((cid) => cid !== id),
  }));
}

export function moveCategory(id: string, dir: -1 | 1): void {
  const index = categories.findIndex((c) => c.id === id);
  const target = index + dir;
  if (index < 0 || target < 0 || target >= categories.length) return;
  const next = [...categories];
  const tmp = next[index];
  next[index] = next[target];
  next[target] = tmp;
  categories = next.map((c, i) => ({ ...c, sort: i }));
}

/* ===== 工具 ===== */

export function filterLinks(
  source: readonly InspirationLink[],
  categoryId: string | null,
  query: string,
): InspirationLink[] {
  const q = query.trim().toLowerCase();
  return source.filter((l) => {
    if (categoryId && !l.categoryIds.includes(categoryId)) return false;
    if (!q) return true;
    return [l.note, l.title, l.summary, l.source].some((field) =>
      (field ?? "").toLowerCase().includes(q),
    );
  });
}

export function displayDate(date: string): string {
  return date.slice(5).replace("-", ".");
}

/** 状态文案：done 无标 */
export function statusLabel(status: LinkStatus): string | null {
  const map: Record<LinkStatus, string | null> = {
    pending: "待补全",
    processing: "抓取中",
    done: null,
    failed: "未抓摘要",
  };
  return map[status];
}

/** 来源展示名：小红书用中文名，其余用域名 */
export function sourceLabel(source: string): string {
  return source.includes("xiaohongshu") ? "小红书" : source;
}

/** 卡片/详情标题：备注 > 标题 > 待整理占位（不裸露 URL） */
export function displayTitle(link: InspirationLink): string {
  return link.note ?? link.title ?? "待整理的笔记";
}

/** 规范地址：去 query/hash（分享链接的 xsec_token 每次不同，用于判重） */
export function canonicalUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.origin + parsed.pathname;
  } catch {
    return url;
  }
}

export interface ParsedShare {
  url: string | null;
  title: string | null;
}

/**
 * 解析真实分享文本（如「32 【标题 - 作者 | 小红书 - …】 😆 code 😆 https://…?xsec_token=…」）。
 * - URL：首个 http(s) 匹配（容忍 emoji/分享码/中文标点噪音）
 * - 标题：第一个【】，按 | 截掉「小红书 - …」尾巴
 * - 均无 → 纯想法文本
 */
export function parseShareText(text: string): ParsedShare {
  const raw = text.trim();
  if (!raw) return { url: null, title: null };
  const urlMatch = raw.match(/https?:\/\/[^\s【】～，。；、]+/i);
  const url = urlMatch ? urlMatch[0] : null;
  const bracket = raw.match(/【([^】]+)】/);
  let title = bracket ? bracket[1].trim() : null;
  if (title) {
    title = title.split(/\s*[|｜]\s*/)[0].trim();
    if (title.length < 2) title = null;
  }
  return { url, title };
}

function hostnameOf(url: string): string {
  try {
    return new URL(url.trim()).hostname;
  } catch {
    return url.trim().slice(0, 40);
  }
}
