import { recordSeed, type PurchaseRecord } from "./mockRecords";
export interface PreparationItem {
  id: string;
  room: string;
  name: string;
  fields: string[];
  questions: string[];
  aliases: string[];
}
const definitions: Record<string, [string, string[], string[]][]> = {
  卫生间: [
    ["马桶", ["安装方式", "坑距 / 排污方式", "尺寸", "水压要求", "功能", "安装费用"], ["排污位置和安装尺寸确认了吗？", "如选择智能款，水电预留是否与具体型号匹配？"]],
    ["淋浴", ["明装 / 暗装", "出水方式", "水压要求", "阀体材质", "安装费用"], ["明装还是暗装？需要在施工前确定哪些预埋件？", "与热水设备、现场水压是否匹配？"]],
    ["洗手台", ["台盆形式", "柜体尺寸", "材质", "排水方式", "收纳", "安装费用"], ["墙面、排水位置与柜体尺寸匹配吗？", "柜门开启会不会影响通行？"]],
    ["龙头", ["台面开孔", "冷热水接口", "出水高度", "材质"], ["与台盆开孔和高度是否匹配？"]],
    ["镜柜", ["尺寸", "收纳", "照明", "电源要求"], ["照明、电源和柜体安装位置确认了吗？"]],
    ["地漏", ["排水口尺寸", "安装深度", "排水能力", "防臭结构"], ["安装深度和排水位置确认了吗？"]],
    ["淋浴隔断", ["尺寸", "开门方式", "玻璃与五金", "安装费用"], ["开门空间和挡水方案是否协调？"]],
    ["防水与瓷砖", ["材料规格", "施工范围", "用量", "人工与辅料"], ["施工方案与验收安排是否已和施工方确认？"]],
  ],
  客厅: [["沙发", ["尺寸", "面料", "坐深", "送货安装"], ["尺寸是否影响通道与其他家具？"]], ["电视", ["尺寸", "接口", "安装方式", "安装费用"], ["观看距离和插座位置确认了吗？"]], ["茶几", ["尺寸", "材质", "收纳"], ["活动空间是否足够？"]], ["灯具", ["尺寸", "亮度", "色温", "控制方式"], ["灯位和开关方案确定了吗？"]], ["窗帘", ["尺寸", "遮光", "轨道", "安装费用"], ["窗帘盒和轨道空间确认了吗？"]]],
  餐厅: [["餐桌", ["尺寸", "形状", "材质", "人数", "送货安装"], []], ["餐椅", ["尺寸", "材质", "坐高", "数量", "单价"], []], ["餐边柜", ["尺寸", "材质", "收纳布局", "电源预留", "安装费用"], []], ["餐厅灯", ["尺寸", "亮度", "色温", "控制方式", "安装费用"], []]],
  主卧: [["床", ["尺寸", "材质", "收纳"], ["床、衣柜与通道空间是否协调？"]], ["床垫", ["尺寸", "软硬度", "厚度", "试睡与售后"], ["与床架尺寸匹配吗？"]], ["空调", ["型号", "制冷量", "噪声", "安装费用"], ["外机位与管线安排确认了吗？"]], ["衣柜", ["尺寸", "材质", "内部布局", "报价范围"], ["尺寸和内部收纳需求确认了吗？"]], ["窗帘", ["遮光", "尺寸", "轨道"], ["遮光需求与轨道方案确认了吗？"]]],
  次卧: [["床与床垫", ["尺寸", "软硬度", "材质"], ["日常用途和居住人数确定了吗？"]], ["书桌", ["尺寸", "收纳", "电源位置"], ["桌面尺寸与采光位置合适吗？"]], ["衣柜", ["尺寸", "内部布局", "材质"], ["收纳需求确认了吗？"]], ["空调", ["制冷量", "噪声", "安装费用"], ["安装位置和管线确认了吗？"]]],
  厨房: [["冰箱", ["尺寸", "散热空间", "容量", "开门方式"], ["柜体预留空间与开门方向匹配吗？"]], ["烟机灶具", ["尺寸", "开孔", "排烟安装", "燃气适配"], ["与橱柜、现场接口和排烟方案匹配吗？"]], ["水槽龙头", ["尺寸", "开孔", "材质", "排水"], ["与台面开孔和柜下空间匹配吗？"]], ["洗碗机", ["尺寸", "容量", "水电要求", "安装费用"], ["柜体、水电和排水预留确认了吗？"]], ["瓷砖", ["规格", "用量", "单价", "人工辅料"], ["材料与施工费用分别包含什么？"]]],
  阳台: [["洗衣机", ["尺寸", "容量", "水电要求", "安装费用"], ["接口、排水和柜体空间确认了吗？"]], ["晾衣架", ["尺寸", "承重", "控制方式", "安装费用"], ["安装空间和电源预留确认了吗？"]], ["阳台柜", ["尺寸", "材质", "收纳"], ["柜体与水电位置是否协调？"]]],
  全屋: [["中央空调", ["外机型号", "制冷 / 制热量", "内机组合", "外机尺寸", "全包报价", "额外费用"], ["各房间的容量与同时使用需求匹配吗？", "外机位、吊顶、管线和检修条件确认了吗？"]], ["地板", ["材质", "厚度", "用量", "安装费用"], ["地面条件和铺装费用确认了吗？"]], ["开关插座", ["数量", "位置", "功能", "报价"], ["是否已按家具家电位置核对？"]]],
};
export const preparationSeed: PreparationItem[] = Object.entries(definitions).flatMap(([room, items]) => items.map(([name, fields, questions], index) => ({
  id: `${room}-${index}`, room, name, fields, questions,
  aliases: name === "水槽龙头" ? ["水槽", "龙头"] : name === "防水与瓷砖" ? ["防水", "瓷砖"] : name === "床与床垫" ? ["床", "床垫"] : [name],
})));
export function matchItem(record: PurchaseRecord, items: PreparationItem[]) {
  if (record.itemId) return items.find(i => i.id === record.itemId);
  const inRoom = items.filter(i => i.room === record.room);
  const exact = inRoom.find(i => i.aliases.includes(record.category));
  if (exact) return exact;
  return inRoom.flatMap(i => i.aliases.map(alias => ({ item: i, alias })))
    .filter(entry => record.name.includes(entry.alias))
    .sort((a, b) => b.alias.length - a.alias.length)[0]?.item;
}
export const initialPreparationRecords: PurchaseRecord[] = [...recordSeed, {
  id: "hisense-central-ac", itemId: "全屋-0", room: "全屋", section: "soft", category: "中央空调",
  name: "海信 5G+荣耀家", price: null, unit: "套", status: "saved",
  url: "https://3.cn/37avb-1r?jkl=@J3iBE4VZI9@", pros: "", cons: "",
  note: "分享文案：多联机5匹四室一厅。具体型号、内机组合和全包报价待核实。",
}, {
  id: "toilet-example-a", itemId: "卫生间-0", room: "卫生间", section: "soft", category: "马桶",
  name: "智能马桶方案 A（示例）", price: 2980, unit: "套", status: "saved",
  note: "演示报价，非真实商品。安装条件与费用待确认。", pros: "", cons: "",
  specs: { "安装方式": "落地式（示例）", "功能": "基础清洗（示例）" },
}, {
  id: "toilet-example-b", itemId: "卫生间-0", room: "卫生间", section: "soft", category: "马桶",
  name: "智能马桶方案 B（示例）", price: 3990, unit: "套", status: "saved",
  note: "演示报价，非真实商品。报价是否包含安装待确认。", pros: "", cons: "",
  specs: { "安装方式": "落地式（示例）", "功能": "清洗、烘干（示例）" },
}];

export function applyDiningRoom<T extends { items: PreparationItem[]; appliedImports?: string[] }>(data: T): T {
  const version = "dining-room-20261014";
  if (data.appliedImports?.includes(version)) return data;
  const additions = preparationSeed.filter(i => i.room === "餐厅" && !data.items.some(old => old.room === i.room && old.name === i.name));
  return { ...data, items: [...data.items, ...additions], appliedImports: [...(data.appliedImports ?? []), version] };
}

/** Remove a checklist item while keeping its candidates and notes in the room. */
export function removePreparationItem<T extends {
  items: PreparationItem[];
  records: PurchaseRecord[];
  skipped: string[];
  associations: Record<string, string[]>;
}>(data: T, itemId: string): T {
  const item = data.items.find(i => i.id === itemId);
  if (!item) return data;
  const itemScope = `item:${item.id}`;
  const roomScope = `room:${item.room}`;
  const associations = { ...data.associations };
  if (associations[itemScope]?.length) {
    associations[roomScope] = [...new Set([...(associations[roomScope] ?? []), ...associations[itemScope]])];
  }
  delete associations[itemScope];
  return {
    ...data,
    items: data.items.filter(i => i.id !== itemId),
    // Keep an explicit reference to the removed item so name matching cannot
    // silently move an old candidate into another checklist item.
    records: data.records.map(r => matchItem(r, data.items)?.id === itemId ? { ...r, itemId } : r),
    skipped: data.skipped.filter(id => id !== itemId),
    associations,
  };
}
