# 熊熊之家 · 跨端骨架

Taro 4 + React 18 + TypeScript，一套页面输出微信小程序和 H5（手机、Pad、PC）。独立于上层的户型设计工具。

## 本地网页预览

```sh
cd bear-home
nvm use            # 需要 Node ≥ 20（.nvmrc 已固定 v23.8.0；Node 16 会因 postcss-import 的 findLastIndex 缺失而编译白屏）
npm install
npm run dev:h5
```

电脑打开 http://localhost:5173 。手机 / Pad 和电脑连接同一 Wi-Fi，访问电脑的局域网地址，如 http://192.168.1.43:5173 。路由采用 hash 模式，静态部署不需要服务端重写。

## 微信小程序

```sh
npm run dev:weapp
```

打开微信开发者工具，导入 **bear-home 项目根目录**（包含 `project.config.json` 的目录）。小程序代码目录为 `dist/weapp/`，AppID 已配置为 `wxb7ec6b9b87815efd`。

登录有该小程序开发权限的微信账号，等待编译完成后点击“预览”，手机微信扫码。模拟器编译和手机真机预览需分别检查；npm 构建通过不代表真机验证完成。

小程序使用自定义顶部和底部导航，顶部通过微信胶囊位置和状态栏高度计算安全空间。网页手机端 Header 56px、底部导航 52px（另加安全区），Pad / PC Header 64px。

## 构建

```sh
npm run typecheck
npm run build:h5      # dist/h5/
npm run build:weapp   # dist/weapp/
npm run build        # 类型检查 + 两端构建
```

H5 产物可部署到静态网站。小程序产物通过微信开发者工具上传；当前未自动上传或发布。

## 骨架范围

- 小家：首页进度、最近记录、预算小结。
- 记录：阶段筛选、新增记录、标题校验、本机存储。
- 预算、我的：示例数据与基础布局。
- 手机 ≤700px 使用底部导航；Pad 701–1100px 与 PC >1100px 使用侧边导航。
- 样式使用固定 CSS px 和断点，关闭自动 px→rem/rpx 转换，防止桌面端被整体放大。

当前没有账号、照片上传、云同步或真实记账。不同浏览器和微信小程序的本地存储相互独立。原网页本地记录与新 H5 在相同 origin 下可兼容读取。

## 目录

- `config/index.ts`：编译、开发服务和双端输出配置。
- `src/app.config.ts`：四个页面与自定义导航配置。
- `src/pages/`：小家、记录、预算、我的独立页面入口。
- `src/components/Screen.tsx`：共用布局和 Demo 页面。
- `src/components/EntryEditor.tsx`：跨端新增记录弹层。
- `src/components/Bear.tsx`：CSS 小熊。
- `src/components/Icons.tsx`、`src/assets/icons/`：跨端 PNG 图标。
- `src/services/entries.ts`：本地存储与记录创建；后续可替换为 API。
- `src/data/demo.ts`：示例数据。
- `src/styles.css`：共用视觉、手机 / Pad / PC 响应式样式。

`npm run icons` 可重新生成图标。lucide-react 和 sharp 仅用于开发时生成资源，不进入运行时页面。
