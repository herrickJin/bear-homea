import type { PurchaseRecord } from "./mockRecords";
import { preparationSeed, type PreparationItem } from "./preparation";
export const CENTRAL_AC_IMPORT = "hisense-central-ac-analysis-20261014";
const productUrl = "https://3.cn/37avb-1r?jkl=@J3iBE4VZI9@";
export const centralAcAnalysis = [
  "初步结论：作为全屋中央空调候选保留，先确认具体配置和安装总价，再判断是否适合家里。",
  "资料范围：京东短链接未能读取完整详情。目前已知的是分享文案“海信5G+荣耀家多联机5匹四室一厅”，型号、套餐配置和当前价格尚未核实。",
  "系列参考：海信官网列有120型（制冷12kW）和140型（制冷14kW）等外机。140型E4和L4的机身尺寸也不同；这些是系列选型信息，尚不能对应到本商品。",
  "选型判断：请商家按各房间面积、朝向、是否顶楼、冬季制热及同时开启需求出配机方案，不能只用房间数量判断容量。",
  "报价核对：设备与安装分别包含什么？铜管包含多少米、超长单价是多少？风口、排水、吊装及上楼费是否另计？",
  "优先确认：外机完整型号；每台内机型号与容量；全包落地价和报价日期；外机位、吊顶、管线与检修条件；新风、净化和智能控制实际包含哪些。",
].join("\n\n");
export function applyCentralAcImport<T extends {
  records: PurchaseRecord[];
  items: PreparationItem[];
  skipped: string[];
  associations: Record<string, string[]>;
  appliedImports?: string[];
}>(data: T): T {
  if (data.appliedImports?.includes(CENTRAL_AC_IMPORT)) return data;
  const existingItem = data.items.find(i => i.room === "全屋" && i.name === "中央空调");
  const template = preparationSeed.find(i => i.room === "全屋" && i.name === "中央空调")!;
  const item = existingItem ?? { ...template, id: data.items.some(i => i.id === template.id) ? "central-ac-20261014" : template.id };
  const existingRecord = data.records.find(r => r.id === "hisense-central-ac" || r.url?.split("?")[0] === productUrl.split("?")[0]);
  const candidate: PurchaseRecord = {
    id: "hisense-central-ac", section: "soft", category: "中央空调",
    name: "海信 5G+荣耀家 · 5匹", price: null, unit: "套", status: "saved",
    pros: "", cons: "", note: "分享文案：多联机5匹四室一厅。型号、内机组合与全包报价待核实。",
    ...existingRecord,
    room: "全屋", itemId: item.id, url: productUrl,
    analysis: centralAcAnalysis,
    analysisSources: [{ label: "海信5G+荣耀家官方参数（系列参考）", url: "https://www.zykthisense.com/product/index.aspx?nodeid=711" }],
  };
  return {
    ...data,
    items: existingItem ? data.items : [...data.items, item],
    records: existingRecord ? data.records.map(r => r.id === existingRecord.id ? candidate : r) : [candidate, ...data.records],
    skipped: data.skipped.filter(id => id !== item.id),
    associations: { ...data.associations, [`item:${item.id}`]: [...new Set([...(data.associations[`item:${item.id}`] ?? []), "idea-1791984189264-effc27b4"])] },
    appliedImports: [...(data.appliedImports ?? []), CENTRAL_AC_IMPORT],
  };
}
