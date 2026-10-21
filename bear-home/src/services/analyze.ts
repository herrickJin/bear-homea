import Taro from "@tarojs/taro";
import { API_TOKEN } from "./api";
import type { PurchaseRecord } from "../data/mockRecords";

/**
 * 选购分析：把一条候选交给服务端模型，拿回一段可存进 candidate.analysis 的文本。
 * 与「AI 整理」同形态——单次、非流式、失败可重试；不落库，用户确认后由
 * preparation_state 同步写回。
 */
const base = process.env.TARO_APP_AI_BASE ?? process.env.TARO_APP_RECORD_AI_BASE ?? "";
export const ANALYSIS_MAX_CHARS = 4000;

export async function analyzeCandidate(
  record: PurchaseRecord,
  itemName?: string,
  focus?: string,
): Promise<string> {
  if (!base) throw new Error("AI 尚未连接，可以先手写分析");
  let response;
  try {
    response = await Taro.request<{ analysis?: string; error?: string }>({
      url: `${base}/api/analyze`,
      method: "POST",
      data: {
        room: record.room,
        name: record.name,
        itemName: itemName ?? "",
        category: record.category,
        section: record.section,
        price: record.price,
        unit: record.unit,
        note: record.note ?? "",
        pros: record.pros ?? "",
        cons: record.cons ?? "",
        specs: record.specs ?? {},
        url: record.url ?? "",
        ...(focus ? { focus } : {}),
      },
      // 服务端上限 90s（线上真模型单次约 38s），客户端留一点网络余量
      timeout: 95000,
      header: { Authorization: `Bearer ${API_TOKEN}`, "Content-Type": "application/json" },
    });
  } catch {
    throw new Error("暂时连接不上 AI，可以重试或稍后再试");
  }
  let data = response.data;
  if (typeof data === "string") {
    try { data = JSON.parse(data); } catch { data = {}; }
  }
  if (response.statusCode >= 400) {
    throw new Error(data?.error ?? "AI 暂时不可用，请稍后再试");
  }
  const analysis = data?.analysis?.trim();
  if (!analysis || analysis.length > ANALYSIS_MAX_CHARS) {
    throw new Error("AI 分析结果不完整，请重试");
  }
  return analysis;
}
