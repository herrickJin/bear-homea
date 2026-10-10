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
  "BookOpen",
  "Bookmark",
  "Check",
  "ChevronRight",
  "Heart",
  "Home",
  "LayoutGrid",
  "Plus",
  "Search",
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
  console.log("Generated cross-platform PNG icons");
})();
