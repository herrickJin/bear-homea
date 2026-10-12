import dns from "node:dns/promises";
import { isIP } from "node:net";
import { config } from "../config.js";
import { db, now } from "../db/index.js";
import type { LinkRow } from "../db/schema.js";
import { saveBuffer } from "./files.js";

/**
 * 链接抓取 worker：与路由层隔离，这里没有 HTTP 输入——
 * 只接收方案 id，URL 一律从数据库现读；私网地址一律拒绝。
 */

const MOBILE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

/** 主机名 → 展示用来源名。分享短链与其正式域归到同一名下
 *  （微信甩出来的多是 xhslink.cn 短链，展示成「xhslink.cn」没有信息量）。 */
const SOURCE_NAMES: [RegExp, string][] = [
  [/(^|\.)xhslink\.cn$|(^|\.)xiaohongshu\.com$/, "小红书"],
  [/(^|\.)baike\.baidu\.com$/, "百度百科"],
  [/(^|\.)xiaobanbang\.com$/, "住小帮"],
  [/(^|\.)cctv\.(com|cn)$/, "央视网"],
  [/(^|\.)zhihu\.com$/, "知乎"],
  [/(^|\.)bilibili\.com$/, "B站"],
  [/(^|\.)douyin\.com$/, "抖音"],
  [/(^|\.)jd\.com$/, "京东"],
  [/(^|\.)tmall\.com$|(^|\.)taobao\.com$/, "淘宝"],
  [/(^|\.)baidu\.com$/, "百度"],
];

/** 未知域名退回去掉 www. 的主机名本身。 */
export function friendlySource(hostname: string): string {
  const host = hostname.toLowerCase().replace(/^www\./, "");
  for (const [re, name] of SOURCE_NAMES) if (re.test(host)) return name;
  return host;
}

/** 私网/环回/链路本地地址一律拒绝，防 SSRF。 */
function isPublicIp(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 0 || a === 10 || a === 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    return true;
  }
  if (isIP(ip) === 6) {
    const lower = ip.toLowerCase();
    if (lower === "::" || lower === "::1") return false;
    if (/^f[cd]/.test(lower)) return false; // unique local
    if (/^fe[89ab]/.test(lower)) return false; // link local
    if (lower.startsWith("::ffff:")) return isPublicIp(lower.slice(7)); // v4-mapped
    return true;
  }
  return false;
}

/** SSRF 防护：协议限 http(s)，主机必须解析到公网地址。 */
async function assertPublicUrl(urlStr: string): Promise<void> {
  const parsed = new URL(urlStr);
  if (!/^https?:$/.test(parsed.protocol)) throw new Error("仅允许 http(s) 地址");
  if (isIP(parsed.hostname)) {
    if (!isPublicIp(parsed.hostname)) throw new Error("不允许访问内网地址");
    return;
  }
  const records = await dns.lookup(parsed.hostname, { all: true });
  if (records.length === 0 || records.some((r) => !isPublicIp(r.address))) {
    throw new Error("不允许访问内网地址");
  }
}

/** 带逐跳 SSRF 校验的 fetch：重定向手动跟随，每一跳都重新校验目标。 */
async function fetchPublic(
  url: string,
  init: RequestInit,
  maxRedirects = 3,
): Promise<Response> {
  let current = url;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    await assertPublicUrl(current);
    const res = await fetch(current, { ...init, redirect: "manual" });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (location) {
        current = new URL(location, current).toString();
        continue;
      }
    }
    return res;
  }
  throw new Error("重定向次数过多");
}

const queue: string[] = [];
let draining = false;

/** 依次尝试的下载头：多数图床允许空 Referer（xhscdn 两种都放行），
 *  个别（如百度 bkimg CDN）反而拒外站 Referer——空 Referer 做第一选择。 */
const COVER_FETCH_HEADERS: Record<string, string>[] = [
  { "User-Agent": MOBILE_UA },
  { "User-Agent": MOBILE_UA, Referer: "https://www.xiaohongshu.com/" },
];

async function downloadCover(
  url: string,
): Promise<{ buffer: Buffer; type: string } | null> {
  for (const headers of COVER_FETCH_HEADERS) {
    try {
      const res = await fetchPublic(url, { headers });
      if (!res.ok) continue;
      const buffer = Buffer.from(await res.arrayBuffer());
      if (buffer.byteLength <= 1024 || buffer.byteLength > config.maxUploadBytes)
        continue;
      return {
        buffer,
        type: (res.headers.get("content-type") ?? "image/jpeg").split(";")[0],
      };
    } catch {
      continue;
    }
  }
  return null;
}

/** 远程封面转存：下载到自有 /files/，返回内链地址；失败或非 http(s) 返回 null。
 *  图床（xhscdn 等）按 Referer 防盗链，App 页面直引外链必裂图，落库前一律转存；
 *  转存失败时调用方保留外链——能显示总比没有强。 */
export async function storeRemoteCover(
  remoteUrl: string,
): Promise<string | null> {
  // 协议相对地址（//img.example.com/x.jpg）补全为 https
  const url = remoteUrl.startsWith("//") ? `https:${remoteUrl}` : remoteUrl;
  if (!/^https?:\/\//i.test(url)) return null; // 已是 /files/ 内链或非法值
  const got = await downloadCover(url);
  if (!got) return null;
  try {
    const file = await saveBuffer(got.buffer, ".jpg", got.type);
    return `/files/${file.id}${file.ext}`;
  } catch {
    return null;
  }
}

/** 保存/重置后触发抓取；只传 id，URL 由 worker 从数据库现读。 */
export function queueScrape(id: string): void {
  queue.push(id);
  if (!draining) {
    draining = true;
    setTimeout(drain, 0);
  }
}

async function drain(): Promise<void> {
  try {
    while (queue.length > 0) {
      const id = queue.shift();
      if (id) await scrapeLink(id);
    }
  } finally {
    draining = false;
  }
}

/* ===== 封面转存作业 =====
 * 与抓取 worker 同一隔离模式：入口只收方案 id，封面地址一律从数据库现读，
 * HTTP/MCP 写回层不直接触碰外链下载（结构上断开请求输入到 fetch/落盘的通路）。 */

const coverQueue: string[] = [];
let coverDraining = false;

/** 写回外链封面后触发转存；转存失败保留原外链，不改其他字段。 */
export function queueCoverStore(id: string): void {
  coverQueue.push(id);
  if (!coverDraining) {
    coverDraining = true;
    setTimeout(drainCoverQueue, 0);
  }
}

async function drainCoverQueue(): Promise<void> {
  try {
    while (coverQueue.length > 0) {
      const id = coverQueue.shift();
      if (id) await storeLinkCover(id);
    }
  } finally {
    coverDraining = false;
  }
}

async function storeLinkCover(id: string): Promise<void> {
  const row = db.prepare(`SELECT cover_url FROM links WHERE id = ?`).get(id) as
    | { cover_url: string | null }
    | undefined;
  const remote = row?.cover_url;
  if (!remote || remote.startsWith("/files/")) return;
  const stored = await storeRemoteCover(remote);
  if (stored && stored !== remote) {
    db.prepare(`UPDATE links SET cover_url = ?, updated_at = ? WHERE id = ?`).run(
      stored,
      now(),
      id,
    );
  }
}

async function scrapeLink(id: string): Promise<void> {
  const row = db.prepare(`SELECT * FROM links WHERE id = ?`).get(id) as
    | LinkRow
    | undefined;
  if (!row?.url) return;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetchPublic(row.url, {
      headers: {
        // 小红书对爬虫 UA 返回验证页，用移动端 Safari UA 可拿到 SSR 的 og 元信息
        "User-Agent": MOBILE_UA,
        Accept: "text/html,application/xhtml+xml",
      },
      signal: controller.signal,
    });
    clearTimeout(timer);
    const html = await res.text();
    console.log(
      `[scrape-fetch] final=${res.url} status=${res.status} ct=${res.headers.get("content-type")}`,
    );
    const meta = (prop: string): string | null => {
      const patterns = [
        new RegExp(
          `<meta[^>]+(?:property|name)=["']${prop}["'][^>]*content=["']([^"']+)["']`,
          "i",
        ),
        new RegExp(
          `<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${prop}["']`,
          "i",
        ),
      ];
      for (const pattern of patterns) {
        const m = html.match(pattern);
        if (m?.[1]) return m[1].trim();
      }
      return null;
    };
    const ogTitle = meta("og:title");
    const ogImage = meta("og:image");
    const ogDesc = meta("og:description");

    // 小红书对无 cookie 请求返回空壳 og（标题「- 小红书」、占位图），
    // 真实标题/封面在页面数据里 —— 逐级降级提取
    const ogTitleUsable =
      ogTitle && !/^(\s*-\s*)?小红书$/.test(ogTitle.trim()) ? clean(ogTitle, 500) : null;
    const jsonTitle = html.match(/"title"\s*:\s*"((?:[^"\\]|\\.)*)"/i)?.[1];
    let jsonTitleClean: string | null = null;
    if (jsonTitle && jsonTitle.length >= 2) {
      try {
        jsonTitleClean = clean(JSON.parse(`"${jsonTitle}"`) as string, 500) || null;
      } catch {
        jsonTitleClean = null;
      }
    }
    const ogImageUsable =
      ogImage && !ogImage.includes("ci.xiaohongshu.com/?") ? clean(ogImage, 1000) : null;
    const webpic =
      html.match(/https?:\/\/sns-webpic-qc\.xhscdn\.com[^"'\\\s]+/i)?.[0] ?? null;
    const remoteCover = ogImageUsable ?? webpic;

    // 封面转存为自有 /files/ 内链，避免外链防盗链导致无法显示。
    // 扩展名固定 .jpg：真实格式由存库的 mime_type 表达，路径段必须是字面量。
    // 转存（含 await）必须放在守卫读取之前：读取与写入之间没有任何 await
    // （better-sqlite3 同步），这段窗口才是无竞态的。
    const fetchedCover = remoteCover
      ? (await storeRemoteCover(remoteCover)) ?? remoteCover
      : null;

    // 本 worker 与 Hermes / 封面转存 worker 并发处理同一条：只补空字段，
    // 别人先写进库的标题/摘要/封面一律保留（守卫读到的快照为准）。
    const guard = db
      .prepare(`SELECT status, title, summary, cover_url FROM links WHERE id = ?`)
      .get(id) as
      | {
          status: string;
          title: string | null;
          summary: string | null;
          cover_url: string | null;
        }
      | undefined;
    if (!guard || guard.status !== "pending") return;

    const cover = guard.cover_url || fetchedCover || null;
    // 来源名以重定向后的正式域为准（xhslink.cn 短链 → 小红书）
    const source = friendlySource(new URL(res.url).hostname);
    db.prepare(
      `UPDATE links SET
         title = ?, summary = ?, cover_url = ?, source = ?,
         status = 'done', error = NULL, updated_at = ?
       WHERE id = ?`,
    ).run(
      guard.title || (row.title ?? ogTitleUsable ?? jsonTitleClean) || null,
      guard.summary || clean(ogDesc, 500) || null,
      cover,
      source,
      now(),
      id,
    );
    // 落库后仍是外链（转存失败/历史遗留）就补一次转存作业，幂等
    if (cover && /^https?:\/\//i.test(cover)) queueCoverStore(id);
  } catch (err) {
    // 抓取失败也不抢已被人认领/写回的行：留在原状态交给 Hermes 处理
    const current = db
      .prepare(`SELECT status FROM links WHERE id = ?`)
      .get(id) as { status: string } | undefined;
    if (!current || current.status !== "pending") return;
    db.prepare(
      `UPDATE links SET status = 'failed', error = ?, updated_at = ? WHERE id = ?`,
    ).run(String(err).slice(0, 200), now(), id);
  }
}

function clean(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
