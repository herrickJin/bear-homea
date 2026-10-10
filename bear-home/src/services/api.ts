import Taro from "@tarojs/taro";

/**
 * 自部署后端配置：构建时从 .env 注入（TARO_APP_ 前缀），见 .env.example。
 * 注意：小程序正式版要求 HTTPS + 备案域名，当前 http://IP 仅用于
 * 开发者工具（勾选"不校验合法域名"）和 H5。
 */
export const API_BASE_URL = process.env.TARO_APP_API_BASE ?? "";
export const API_TOKEN = process.env.TARO_APP_API_TOKEN ?? "";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function apiRequest<T>(
  path: string,
  options: { method?: "GET" | "POST" | "PUT" | "DELETE"; body?: unknown } = {},
): Promise<T> {
  const res = await Taro.request({
    url: `${API_BASE_URL}${path}`,
    method: options.method ?? "GET",
    data: options.body,
    timeout: 8000,
    header: {
      Authorization: `Bearer ${API_TOKEN}`,
      "Content-Type": "application/json",
    },
  });
  if (res.statusCode >= 400) {
    throw new ApiError(res.statusCode, `接口返回 ${res.statusCode}`);
  }
  return res.data as T;
}
