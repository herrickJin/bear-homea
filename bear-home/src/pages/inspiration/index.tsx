import { useCallback, useEffect, useState } from "react";
import Taro from "@tarojs/taro";
import { Button, View } from "@tarojs/components";
import Screen from "../../components/Screen";
import LinkCard from "../../components/LinkCard";
import CategoryTabs from "../../components/CategoryTabs";
import SearchBar from "../../components/SearchBar";
import SaveSheet from "../../components/SaveSheet";
import CategoryManager from "../../components/CategoryManager";
import Bear from "../../components/Bear";
import { Plus } from "../../components/Icons";
import * as inspiration from "../../services/inspiration";
import { filterLinks } from "../../data/mockInspiration";
import type {
  Category,
  InspirationLink,
  SaveDraft,
} from "../../data/mockInspiration";

export default function Page() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [links, setLinks] = useState<InspirationLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [netError, setNetError] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [saveOpen, setSaveOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [cats, items] = await Promise.all([
        inspiration.listCategories(),
        inspiration.fetchLinks(),
      ]);
      setCategories(cats);
      setLinks(items);
      setNetError(false);
    } catch {
      setNetError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const visible = filterLinks(links, activeId, query);

  // 每个分类的方案数（分页签上的小计）
  const counts: Record<string, number> = {};
  for (const link of links) {
    for (const id of link.categoryIds) {
      counts[id] = (counts[id] ?? 0) + 1;
    }
  }

  async function handleSave(draft: SaveDraft) {
    try {
      const { item, duplicated } = await inspiration.saveLink(draft);
      if (duplicated) {
        Taro.showToast({ title: "已收藏过这条", icon: "none" });
        return;
      }
      setLinks((prev) => [item, ...prev]);
      setSaveOpen(false);
      setActiveId(null);
      setQuery("");
      Taro.vibrateShort({ type: "light" }).catch(() => {});
      Taro.showToast({ title: "收进方案库", icon: "success" });
    } catch {
      Taro.showToast({ title: "网络不佳，没能保存，请稍后再试", icon: "none" });
    }
  }

  async function handleCreateCategory(name: string): Promise<Category> {
    const category = await inspiration.createCategory(name);
    setCategories(await inspiration.listCategories());
    return category;
  }

  async function handleRename(id: string, name: string) {
    try {
      await inspiration.renameCategory(id, name);
      setCategories(await inspiration.listCategories());
    } catch {
      Taro.showToast({ title: "没改成，请稍后再试", icon: "none" });
    }
  }

  async function handleDelete(id: string) {
    try {
      await inspiration.deleteCategory(id);
      const [cats, items] = await Promise.all([
        inspiration.listCategories(),
        inspiration.fetchLinks(),
      ]);
      setCategories(cats);
      setLinks(items);
      if (activeId === id) setActiveId(null);
    } catch {
      Taro.showToast({ title: "没删成，请稍后再试", icon: "none" });
    }
  }

  async function handleMove(id: string, dir: -1 | 1) {
    try {
      await inspiration.moveCategory(id, dir);
      setCategories(await inspiration.listCategories());
    } catch {
      Taro.showToast({ title: "没移动成", icon: "none" });
    }
  }

  function openDetail(link: InspirationLink) {
    Taro.navigateTo({ url: `/pages/inspiration-detail/index?id=${link.id}` });
  }

  function copyLink(link: InspirationLink) {
    if (!link.url) return;
    Taro.setClipboardData({ data: link.url }).then(() =>
      Taro.showToast({ title: "链接已复制，去小红书打开", icon: "none" }),
    );
  }

  function renderBody() {
    if (loading) {
      return (
        <View className="ui-section panel">
          <View className="ui-div empty">
            <View className="ui-h3">加载中…</View>
          </View>
        </View>
      );
    }
    if (netError) {
      return (
        <View className="ui-section panel">
          <View className="ui-div empty">
            <Bear />
            <View className="ui-h3">连不上服务器</View>
            <View className="ui-p">检查网络后重试一下。</View>
            <Button
              ariaRole="button"
              className="ui-button primary"
              onClick={refresh}
            >
              重试
            </Button>
          </View>
        </View>
      );
    }
    if (visible.length > 0) {
      return (
        <View className="ui-div link-list">
          {visible.map((link) => (
            <LinkCard
              key={link.id}
              link={link}
              categories={categories}
              onOpen={openDetail}
              onCopy={copyLink}
            />
          ))}
        </View>
      );
    }
    return (
      <View className="ui-section panel">
        <View className="ui-div empty">
          <Bear />
          <View className="ui-h3">
            {links.length === 0 ? "剪贴簿还空着" : "这个筛选下没有方案"}
          </View>
          <View className="ui-p">
            {links.length === 0
              ? "小红书里点「分享 → 复制链接」，回来点右上角「添加想法」。"
              : "换个分类，或清空搜索看看。"}
          </View>
        </View>
      </View>
    );
  }

  return (
    <Screen
      page="inspiration"
      action={
        <Button
          ariaRole="button"
          className="ui-button primary"
          onClick={() => setSaveOpen(true)}
        >
          <Plus size={16} tone="white" /> 添加想法
        </Button>
      }
    >
      <View className="ui-div insp-toolbar">
        <CategoryTabs
          categories={categories}
          activeId={activeId}
          counts={counts}
          onSelect={setActiveId}
          onManage={() => setManageOpen(true)}
        />
        <SearchBar value={query} onChange={setQuery} />
      </View>
      {renderBody()}
      <SaveSheet
        open={saveOpen}
        categories={categories}
        onClose={() => setSaveOpen(false)}
        onSave={handleSave}
      />
      <CategoryManager
        open={manageOpen}
        categories={categories}
        onClose={() => setManageOpen(false)}
        onCreate={handleCreateCategory}
        onRename={handleRename}
        onDelete={handleDelete}
        onMove={handleMove}
      />
    </Screen>
  );
}
