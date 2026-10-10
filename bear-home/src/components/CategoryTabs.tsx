import { Button, Text, View } from "@tarojs/components";
import type { Category } from "../data/mockInspiration";

interface CategoryTabsProps {
  categories: Category[];
  /** null = 全部 */
  activeId: string | null;
  /** 每个分类的方案数（分页签小计） */
  counts?: Record<string, number>;
  onSelect: (id: string | null) => void;
  onManage: () => void;
}

export default function CategoryTabs({
  categories,
  activeId,
  counts,
  onSelect,
  onManage,
}: CategoryTabsProps) {
  return (
    <View className="ui-div cat-tabs">
      <Button
        ariaRole="button"
        className={`ui-button ${`cat-tab${activeId === null ? " active" : ""}`}`}
        onClick={() => onSelect(null)}
      >
        <Text className="ui-span">全部</Text>
      </Button>
      {categories.map((c) => {
        const count = counts?.[c.id];
        return (
          <Button
            ariaRole="button"
            key={c.id}
            className={`ui-button ${`cat-tab${activeId === c.id ? " active" : ""}`}`}
            onClick={() => onSelect(c.id)}
          >
            <Text className="ui-span">{c.name}</Text>
            {count ? <Text className="tab-count">{count}</Text> : null}
          </Button>
        );
      })}
      <Button
        ariaRole="button"
        className="ui-button cat-manage"
        onClick={onManage}
      >
        <Text className="ui-span">＋ 管理</Text>
      </Button>
    </View>
  );
}
