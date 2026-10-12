# 多阶段构建：builder 里装全量依赖并编译，运行时只带生产依赖
FROM node:22-slim AS build
WORKDIR /app
# 国内网络适配：换腾讯内网 Debian 源 + npmmirror；预装编译工具链兜底
# （better-sqlite3 预编译包下载自 GitHub，国内不稳定，失败时可用源码编译）
RUN sed -i 's|deb.debian.org|mirrors.cloud.tencent.com|g' /etc/apt/sources.list.d/debian.sources \
  && apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
ENV NPM_CONFIG_REGISTRY=https://registry.npmmirror.com
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
ENV NPM_CONFIG_REGISTRY=https://registry.npmmirror.com
# --ignore-scripts：better-sqlite3@13 自带 prebuilds/ 预编译产物（node-gyp-build 运行时加载），
# 无需编译；不加此开关 npm 会因 binding.gyp 的存在自动触发 node-gyp rebuild，
# 而 runtime stage 没有 python3，构建必挂（本机侥幸能过是因为容器里恰有 python3）。
RUN npm ci --omit=dev --ignore-scripts
COPY --from=build /app/dist ./dist

ENV PORT=8787
ENV DATA_DIR=/data
VOLUME /data
EXPOSE 8787
CMD ["node", "dist/index.js"]
