import fs from "node:fs";
import path from "node:path";

// 读取项目根目录 .env（不覆盖已有环境变量），免去 dotenv 依赖。
function loadDotEnv(file = ".env") {
  try {
    const raw = fs.readFileSync(path.resolve(file), "utf8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!m || m[1] in process.env) continue;
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    /* 没有 .env 时依赖真实环境变量 */
  }
}
loadDotEnv();

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`缺少环境变量 ${name}，请参考 .env.example`);
  return value;
}

const dataDir = path.resolve(process.env.DATA_DIR ?? "./data");

export const config = (() => {
  // AI 助手（/api/chat）：OpenAI 兼容端点，默认智谱。未配 AI_API_KEY 时
  // 聊天路由返回 503，其余功能不受影响。
  const toolRounds = Number(process.env.AI_MAX_TOOL_ROUNDS ?? 6);
  const ai = {
    apiKey: process.env.AI_API_KEY ?? "",
    apiBase: process.env.AI_API_BASE ?? "https://open.bigmodel.cn/api/paas/v4",
    model: process.env.AI_CHAT_MODEL ?? "glm-4-flash",
    maxToolRounds:
      Number.isFinite(toolRounds) && toolRounds >= 1 ? Math.floor(toolRounds) : 6,
  };
  return {
    port: Number(process.env.PORT ?? 8787),
    token: required("BEAR_HOME_TOKEN"),
    dataDir,
    filesDir: path.join(dataDir, "files"),
    maxUploadBytes: 50 * 1024 * 1024,
    ai,
  };
})();
