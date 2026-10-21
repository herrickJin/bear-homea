import Taro from "@tarojs/taro";
import { API_TOKEN } from "./api";
import { recordRooms } from "../data/mockRecords";
import type { PurchaseRecord } from "../data/mockRecords";
export type RecordDraft = Omit<PurchaseRecord, "id" | "status">;
// 与 analyze.ts 共用同一个 AI base（旧名 TARO_APP_RECORD_AI_BASE 仍兼容）
const base = process.env.TARO_APP_AI_BASE ?? process.env.TARO_APP_RECORD_AI_BASE ?? "";

export async function organizeRecord(text: string, room?: string): Promise<RecordDraft> {
  if (!base) throw new Error("AI 尚未连接，可以直接保存原文");
  let response;
  try {
    response = await Taro.request<{ draft?: RecordDraft; error?: string }>({
      url: `${base}/api/record-draft`,
      method: "POST",
      data: { text, ...(room ? { room } : {}) },
      timeout: 50000,
      header: { Authorization: `Bearer ${API_TOKEN}`, "Content-Type": "application/json" },
    });
  } catch {
    throw new Error("暂时连接不上 AI，可以重试或直接保存原文");
  }
  let data = response.data;
  if (typeof data === "string") {
    try { data = JSON.parse(data); } catch { data = {}; }
  }
  if (response.statusCode >= 400) {
    throw new Error(data?.error ?? "AI 暂时不可用，可以直接保存原文");
  }
  const draft = data?.draft;
  if (!draft || !draft.name?.trim() || !recordRooms.includes(draft.room) ||
      !["soft", "hard"].includes(draft.section) ||
      (draft.price !== null && (typeof draft.price !== "number" || !Number.isFinite(draft.price) || draft.price < 0)) ||
      ![draft.unit, draft.category, draft.note, draft.pros, draft.cons].every(v => typeof v === "string")) {
    throw new Error("AI 整理结果不完整，请重试或直接保存原文");
  }
  return draft;
}
