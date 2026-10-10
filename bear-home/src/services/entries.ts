import Taro from "@tarojs/taro";
import { apiRequest } from "./api";
import { demoEntries } from "../data/demo";
import type { Entry } from "../data/demo";

const storageKey = "bear-home.entries.v1";

/** 同步读本地缓存：用于首屏即时渲染，数据以服务器为准。 */
export function readEntries(): Entry[] {
  try {
    let stored: unknown = Taro.getStorageSync(storageKey);
    if (process.env.TARO_ENV === "h5" && !stored) {
      stored = localStorage.getItem(storageKey);
    }
    const value: unknown =
      typeof stored === "string" ? JSON.parse(stored) : stored;
    if (
      Array.isArray(value) &&
      value.every(
        (e) =>
          e &&
          ["id", "title", "body", "stage", "date"].every(
            (k) => typeof e[k] === "string",
          ),
      )
    )
      return value;
  } catch {
    /* 缓存缺失或损坏时回退示例数据 */
  }
  return demoEntries;
}

function cacheEntries(entries: Entry[]) {
  try {
    Taro.setStorageSync(storageKey, entries);
  } catch {
    /* 存储不可用只影响离线兜底，不阻塞 */
  }
}

/**
 * 从服务器拉取记录并刷新缓存；失败（离线等）时返回本地缓存。
 */
export async function loadEntries(): Promise<Entry[]> {
  try {
    const data = await apiRequest<{ entries: Entry[] }>("/api/entries?limit=200");
    if (Array.isArray(data.entries)) {
      cacheEntries(data.entries);
      return data.entries;
    }
  } catch {
    /* 网络失败走缓存 */
  }
  return readEntries();
}

/** 新增记录：提交到服务器，成功后同步缓存；失败抛错由页面提示。 */
export async function createEntry(
  title: string,
  body: string,
  stage: string,
): Promise<Entry> {
  const entry = await apiRequest<Entry>("/api/entries", {
    method: "POST",
    body: { title: title.trim(), body: body.trim(), stage },
  });
  cacheEntries([entry, ...readEntries()]);
  return entry;
}
