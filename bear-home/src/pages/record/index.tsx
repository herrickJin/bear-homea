import { useEffect, useState } from "react";
import Taro from "@tarojs/taro";
import { Button, Text, View } from "@tarojs/components";
import Screen from "../../components/Screen";
import CategoryTabs from "../../components/CategoryTabs";
import SearchBar from "../../components/SearchBar";
import LedgerCard from "../../components/LedgerCard";
import LedgerSheet from "../../components/LedgerSheet";
import LedgerDetailSheet from "../../components/LedgerDetailSheet";
import Bear from "../../components/Bear";
import { Plus } from "../../components/Icons";
import * as ledger from "../../services/ledger";
import type {
  LedgerItem,
  LedgerKind,
  LedgerStatus,
} from "../../services/ledger";

const kinds: LedgerKind[] = ["appliance", "material"];

export default function Page() {
  const [items, setItems] = useState<LedgerItem[]>([]);
  const [kind, setKind] = useState<LedgerKind>("appliance");
  // null = 全部（按品类分节展示）
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState<"price" | "date">("price");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<LedgerItem | null>(null);
  // 详情弹层：原地渲染，不走路由；只存 id，条目始终从列表派生（状态流转即时同步）
  const [detailId, setDetailId] = useState<string | null>(null);

  useEffect(() => {
    setItems(ledger.listItems());
  }, []);

  const kindItems = items.filter((i) => i.kind === kind);
  const categories = ledger.categoryList(items, kind);
  const visible = ledger.filterItems(items, kind, activeCategory, query);
  const sections = ledger
    .groupItems(visible, kind)
    .map((s) => ({ ...s, items: ledger.sortItems(s.items, sortBy) }));
  const boughtCount = visible.filter((i) => i.status === "bought").length;

  // 品类页签小计（当前一级内）
  const counts: Record<string, number> = {};
  for (const item of kindItems) {
    counts[item.category] = (counts[item.category] ?? 0) + 1;
  }

  const detailItem = items.find((i) => i.id === detailId) ?? null;

  function switchKind(next: LedgerKind) {
    if (next === kind) return;
    setKind(next);
    setActiveCategory(null);
  }

  function openAdd() {
    setEditing(null);
    setSheetOpen(true);
  }

  function handleSubmit(draft: ledger.LedgerDraft, id?: string) {
    if (id) {
      const next = ledger.updateItem(id, draft);
      if (next) setItems((prev) => prev.map((i) => (i.id === id ? next : i)));
      Taro.showToast({ title: "已保存", icon: "none" });
    } else {
      const item = ledger.addItem(draft);
      setItems((prev) => [item, ...prev]);
      Taro.vibrateShort({ type: "light" }).catch(() => {});
      Taro.showToast({ title: "记下了", icon: "success" });
    }
    setSheetOpen(false);
    setEditing(null);
  }

  function handleStatus(id: string, status: LedgerStatus) {
    const next = ledger.updateItem(id, { status });
    if (next) setItems((prev) => prev.map((i) => (i.id === id ? next : i)));
  }

  function handleDeleted(id: string) {
    ledger.deleteItem(id);
    setItems((prev) => prev.filter((i) => i.id !== id));
    setDetailId(null);
    Taro.showToast({ title: "已删除", icon: "none" });
  }

  function renderBody() {
    if (sections.length > 0) {
      return (
        <View className="ui-div rec-list">
          <View className="ui-div rec-summary">
            <Text className="ui-time">
              共 {visible.length} 条{boughtCount > 0 ? ` · 已买 ${boughtCount}` : ""}
            </Text>
            <Button
              ariaRole="button"
              className="ui-button rec-sort"
              onClick={() => setSortBy(sortBy === "price" ? "date" : "price")}
            >
              {sortBy === "price" ? "按价格 ↑" : "按最近"}
            </Button>
          </View>
          {sections.map((section) => {
            const range = ledger.priceRange(section.items);
            const bought = section.items.filter((i) => i.status === "bought").length;
            return (
              <View className="ui-div rec-section" key={section.category}>
                <View className="ui-div rec-section-head">
                  <Text className="ui-strong rec-section-name">
                    {section.category}
                  </Text>
                  <Text className="ui-time rec-section-meta">
                    {section.items.length} 款
                    {range ? ` · ${range}` : ""}
                    {bought > 0 ? ` · 已买 ${bought}` : ""}
                  </Text>
                </View>
                {section.items.map((item) => (
                  <LedgerCard key={item.id} item={item} onOpen={(i) => setDetailId(i.id)} />
                ))}
              </View>
            );
          })}
        </View>
      );
    }
    return (
      <View className="ui-section panel">
        <View className="ui-div empty">
          <Bear />
          <View className="ui-h3">
            {kindItems.length === 0 ? "台账还空着" : "这个筛选下没有记录"}
          </View>
          <View className="ui-p">
            {kindItems.length === 0
              ? "逛到的型号、报价，随手记下来，比完再买。"
              : "换个品类，或清空搜索看看。"}
          </View>
          {kindItems.length === 0 && (
            <Button
              ariaRole="button"
              className="ui-button primary"
              onClick={openAdd}
            >
              记第一笔
            </Button>
          )}
        </View>
      </View>
    );
  }

  return (
    <Screen page="record">
      <View className="ui-div rec-toolbar">
        <View className="ui-div kind-switch">
          {kinds.map((k) => (
            <Button
              ariaRole="button"
              key={k}
              className={`ui-button kind-seg${kind === k ? " active" : ""}`}
              onClick={() => switchKind(k)}
            >
              <Text className="ui-span">{ledger.kindLabels[k]}</Text>
            </Button>
          ))}
        </View>
        <SearchBar
          value={query}
          onChange={setQuery}
          placeholder="搜型号 / 渠道 / 备注…"
        />
        <CategoryTabs
          categories={categories}
          activeId={activeCategory}
          counts={counts}
          onSelect={setActiveCategory}
        />
      </View>
      {renderBody()}
      <Button
        ariaRole="button"
        ariaLabel="记一笔"
        className="ui-button fab"
        onClick={openAdd}
      >
        <Plus size={20} tone="white" />
      </Button>
      {detailItem && (
        <LedgerDetailSheet
          item={detailItem}
          onClose={() => setDetailId(null)}
          onStatusChange={handleStatus}
          onEdit={(item) => {
            setDetailId(null);
            setEditing(item);
            setSheetOpen(true);
          }}
          onDeleted={handleDeleted}
        />
      )}
      <LedgerSheet
        open={sheetOpen}
        kind={kind}
        categories={categories}
        initial={editing}
        onClose={() => {
          setSheetOpen(false);
          setEditing(null);
        }}
        onSubmit={handleSubmit}
      />
    </Screen>
  );
}
