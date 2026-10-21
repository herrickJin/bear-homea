# visionboards.cn HTTPS 上线（2026-10-18）

- 正式入口：https://visionboards.cn/ ，HTTP 自动 308 跳转到 HTTPS。
- 公共 DNS A 记录：119.27.191.90。
- 生产目录：ubuntu@119.27.191.90 的 ~/bear-home-server。
- 服务器 .env：BEAR_HOME_DOMAIN=visionboards.cn；沿用现有 Caddy 自动签发和续期，证书保存在 caddy_data 卷。
- 前端 .env 的 TARO_APP_API_BASE、TARO_APP_RECORD_AI_BASE 已改为 https://visionboards.cn，令牌不变。
- 发布：本地类型检查、build:h5 后 rsync dist/h5/ 到生产 web/；后端业务服务和数据库未作变更。
- 已发布剪贴板截图 + 文字输入。网页必须处于安全上下文；真机是否能读取截图还取决于系统剪贴板内容和浏览器权限。
- 历史截图兼容：inspiration 服务将 http://119.27.191.90/files/ 地址映射到配置的 HTTPS API 地址，不改数据库。
- 回滚备份：~/bear-home-server/backups/https-20261018-170030/，含原 .env、Caddyfile、docker-compose.yml 和 web/。

验证：HTTPS 证书校验成功；首页 200；准备数据、笔记、AI 可用性接口带鉴权返回 200；4 张已有图片通过 HTTPS 返回 200；线上 index.html、app.js、app.css、笔记 chunk 与本机构建 SHA-256 一致。浏览器成功打开笔记库，isSecureContext=true，navigator.clipboard.read 可用。
