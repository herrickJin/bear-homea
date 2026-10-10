export type Entry = {
  id: string;
  title: string;
  body: string;
  stage: string;
  date: string;
};
export const stages = ["准备", "拆改", "水电", "泥木", "油漆", "安装", "入住"];
export const demoEntries: Entry[] = [
  {
    id: "demo-1",
    title: "水电交底，给未来的家留点余地",
    body: "和师傅确认了插座的位置，沙发两侧多留了两个。小小的细节，也想认真记下来。",
    stage: "水电",
    date: "2026-10-09",
  },
  {
    id: "demo-2",
    title: "拆改结束，家的轮廓慢慢清晰",
    body: "客厅和阳台连通后，光一下子进来了。离想象中的家又近了一点。",
    stage: "拆改",
    date: "2026-10-06",
  },
];
export const budgetItems = [
  { name: "设计与施工", amount: 18000, budget: 80000 },
  { name: "主材与辅材", amount: 6800, budget: 45000 },
  { name: "家具与家电", amount: 0, budget: 55000 },
];
