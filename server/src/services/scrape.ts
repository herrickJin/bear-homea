import dns from "node:dns/promises";
import { isIP } from "node:net";
import { db, now } from "../db/index.js";
import type { LinkRow } from "../db/schema.js";
import { saveBuffer } from "./files.js";

/**
 * 链接抓取 worker：与路由层隔离，这里没有 HTTP 输入——
 * 只接收方案 id，URL 一律从数据库现读；私网地址一律拒绝。
 */

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
        "User-Agent":
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
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

    // 封面转存：下载到自有 /files/，避免外链防盗链导致无法显示。
    // 扩展名固定 .jpg：真实格式由存库的 mime_type 表达，路径段必须是字面量。
    let coverStored: string | null = null;
    if (remoteCover) {
      try {
        const imgRes = await fetchPublic(remoteCover, {
          headers: {
            Referer: "https://www.xiaohongshu.com/",
            "User-Agent":
              "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
          },
        });
        if (imgRes.ok) {
          const buffer = Buffer.from(await imgRes.arrayBuffer());
          if (buffer.byteLength > 1024) {
            const type = (imgRes.headers.get("content-type") ?? "image/jpeg").split(";")[0];
            const file = await saveBuffer(buffer, ".jpg", type);
            coverStored = `/files/${file.id}${file.ext}`;
          }
        }
      } catch {
        /* 转存失败则保留远程地址 */
      }
    }
    const cover = coverStored ?? remoteCover;

    db.prepare(
      `UPDATE links SET
         title = ?, summary = ?, cover_url = ?,
         status = 'done', error = NULL, updated_at = ?
       WHERE id = ?`,
    ).run(
      (row.title ?? ogTitleUsable ?? jsonTitleClean) || null,
      clean(ogDesc, 500) || null,
      cover,
      now(),
      id,
    );
  } catch (err) {
    db.prepare(
      `UPDATE links SET status = 'failed', error = ?, updated_at = ? WHERE id = ?`,
    ).run(String(err).slice(0, 200), now(), id);
  }
}

function clean(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
