const fs = require("node:fs/promises");
const path = require("node:path");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const icons = require("lucide-react");
const sharp = require("sharp");
const names = [
  "ArrowDownRight",
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "BookOpen",
  "Bookmark",
  "Check",
  "ChevronRight",
  "Heart",
  "Home",
  "LayoutGrid",
  "Plus",
  "RefreshCw",
  "Search",
  "Send",
  "Settings2",
  "Sparkles",
  "Wallet",
  "X",
];
(async () => {
  const dir = path.resolve(__dirname, "../src/assets/icons");
  await fs.mkdir(dir, { recursive: true });
  for (const name of names) {
    for (const [tone, color] of Object.entries({
      green: "#356d5b",
      muted: "#98a799",
      white: "#ffffff",
    })) {
      const svg = renderToStaticMarkup(
        React.createElement(icons[name], { size: 72, color, strokeWidth: 1.7 }),
      );
      await sharp(Buffer.from(svg))
        .png()
        .toFile(path.join(dir, `${name}-${tone}.png`));
    }
  }

  // 品牌标：小红书。官方字标（scripts/xiaohongshu.svg，Simple Icons 收录）反白
  // 压在品牌红 #ff2442 圆角块上（App 图标形态）；品牌色固定，不走三色体系。
  const brandSvg = await fs.readFile(path.resolve(__dirname, "xiaohongshu.svg"), "utf8");
  const glyph = brandSvg.match(/ d="([^"]+)"/)?.[1];
  if (!glyph) throw new Error("xiaohongshu.svg: path not found");
  const xhsSvg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="72" height="72">` +
    `<rect width="24" height="24" rx="5.4" fill="#ff2442"/>` +
    `<g transform="translate(3.36 3.36) scale(0.72)"><path d="${glyph}" fill="#fff"/></g>` +
    `</svg>`;
  await sharp(Buffer.from(xhsSvg)).png().toFile(path.join(dir, "Xiaohongshu.png"));

  console.log("Generated cross-platform PNG icons");
})();
