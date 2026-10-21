// 选购分析接口：给候选详情里的「分析这款」用。
// 只产出文本，不落库——用户在前端确认后由 preparation_state 同步写入 candidate.analysis。

import { Hono } from "hono";
import {
  ANALYSIS_MAX_CHARS,
  analysisInputSchema,
  createCandidateAnalysis,
} from "../services/ai/candidate-analysis.js";
import { ProviderError } from "../services/ai/provider.js";
import { config } from "../config.js";

export const analyze = new Hono();
analyze.get("/", (c) => c.json({ available: Boolean(config.ai.apiKey), maxChars: ANALYSIS_MAX_CHARS }));
analyze.post("/", async (c) => {
  const input = analysisInputSchema.safeParse(await c.req.json().catch(() => null));
  if (!input.success) {
    return c.json({ error: "缺少要分析的商品信息（房间和名称必填）" }, 400);
  }
  try {
    const result = await createCandidateAnalysis(input.data, c.req.raw.signal);
    return c.json(result);
  } catch (error) {
    if (error instanceof ProviderError) {
      const status = error.status === 503 ? 503 : 502;
      return c.json({ error: error.message }, status);
    }
    if (error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name)) {
      return c.json({ error: "AI 分析超时，请重试" }, 504);
    }
    return c.json({ error: "暂时连接不上 AI，请稍后再试" }, 502);
  }
});
