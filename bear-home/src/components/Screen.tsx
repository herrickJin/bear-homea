import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import Taro, { useDidShow, useResize } from "@tarojs/taro";
import { Button, Text, View } from "@tarojs/components";
import {
  ArrowDownRight,
  ArrowRight,
  BookOpen,
  Check,
  ChevronRight,
  Heart,
  Home,
  LayoutGrid,
  Plus,
  Settings2,
  Sparkles,
  Wallet,
} from "./Icons";
import Bear from "./Bear";
import EntryEditor from "./EntryEditor";
import { budgetItems, stages } from "../data/demo";
import type { Entry } from "../data/demo";
import { createEntry, loadEntries, readEntries } from "../services/entries";

export type Page = "home" | "diary" | "budget" | "profile";
const navigation = [
  { id: "home", label: "小家", icon: Home },
  { id: "diary", label: "记录", icon: BookOpen },
  { id: "budget", label: "预算", icon: Wallet },
  { id: "profile", label: "我的", icon: LayoutGrid },
] as const;
const isWeapp = process.env.TARO_ENV === "weapp";
function getHeaderStyle(): CSSProperties {
  if (!isWeapp) return {};
  try {
    const info = Taro.getWindowInfo();
    const capsule = Taro.getMenuButtonBoundingClientRect();
    const top = info.statusBarHeight || 20;
    const height = capsule.height + Math.max(4, capsule.top - top) * 2;
    return {
      "--status-height": `${top}px`,
      "--nav-height": `${height}px`,
      "--capsule-space": `${Math.max(100, info.windowWidth - capsule.left + 12)}px`,
    } as CSSProperties;
  } catch {
    return {
      "--status-height": "24px",
      "--nav-height": "44px",
      "--capsule-space": "110px",
    } as CSSProperties;
  }
}
export default function Screen({ page }: { page: Page }) {
  const [entries, setEntries] = useState(readEntries);
  const [filter, setFilter] = useState("全部");
  const [isAdding, setIsAdding] = useState(false);
  const [notice, setNotice] = useState("");
  const [headerStyle, setHeaderStyle] = useState(getHeaderStyle);
  useResize(() => setHeaderStyle(getHeaderStyle()));
  useDidShow(() => {
    loadEntries().then(setEntries).catch(() => {});
  });
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 3500);
    return () => clearTimeout(timer);
  }, [notice]);
  function navigate(next: Page) {
    if (next === page) {
      Taro.pageScrollTo({ scrollTop: 0, duration: 0 });
      return;
    }
    Taro.redirectTo({ url: `/pages/${next}/index` });
  }
  async function addEntry(title: string, body: string, stage: string) {
    let created: Awaited<ReturnType<typeof createEntry>>;
    try {
      created = await createEntry(title, body, stage);
    } catch {
      // 保持弹窗打开，用户写的内容不丢
      setNotice("网络不佳，记录没能保存，请稍后再试");
      return;
    }
    setEntries((prev) => [created, ...prev]);
    setIsAdding(false);
    setFilter("全部");
    if (page !== "diary") navigate("diary");
    Taro.showToast({ title: "记录已保存", icon: "success" });
  }
  const entryCards = (list: Entry[]) => (
    <View className="ui-div entry-list">
      {list.map((entry, index) => (
        <View className="ui-article entry-card" key={entry.id}>
          <View className={`ui-div ${`entry-art art-${index % 3}`}`}>
            <Home size={36} strokeWidth={1.2} />
            <Text className="ui-span">
              {entry.stage === "水电"
                ? "让生活更顺手"
                : entry.stage === "拆改"
                  ? "家的新轮廓"
                  : "小家的新一天"}
            </Text>
          </View>
          <View className="ui-div entry-content">
            <View className="ui-div entry-meta">
              <Text className="ui-span tag">{entry.stage}</Text>
              <Text className="ui-time">
                {entry.date.slice(5).replace("-", ".")}
              </Text>
            </View>
            <View className="ui-h3">{entry.title}</View>
            <View className="ui-p">
              {entry.body || "今天也在慢慢靠近理想的家。"}
            </View>
          </View>
        </View>
      ))}
    </View>
  );
  return (
    <View
      className={`ui-div ${`app-shell ${isWeapp ? "is-weapp" : "is-h5"}`}`}
      style={headerStyle}
    >
      <View className="ui-aside sidebar">
        <View className="ui-a brand" onClick={() => navigate("home")}>
          <Bear />
          <View className="ui-div">
            <Text className="ui-strong">熊熊之家</Text>
            <Text className="ui-span">把家，一点点变成喜欢的样子</Text>
          </View>
        </View>
        <View className="ui-div sidebar-label">我的装修手记</View>
        <View className="ui-nav">
          {navigation.map(({ id, label, icon: Icon }) => (
            <Button
              ariaRole="button"
              key={id}
              className={`ui-button ${page === id ? "nav-item active" : "nav-item"}`}
              onClick={() => navigate(id)}
            >
              <Icon size={21} tone={page === id ? "green" : "muted"} />
              <Text className="ui-span">{label}</Text>
              {page === id && <View className="ui-i" />}
            </Button>
          ))}
        </View>
        <View className="ui-div sidebar-footer">
          <Heart size={18} />
          <View className="ui-p">
            每一步，都算数。<Text className="ui-break">{"\n"}</Text>
            <Text className="ui-span">给未来的家留一份回忆</Text>
          </View>
        </View>
      </View>
      <View className="ui-main">
        <View className="ui-header topbar">
          <View className="ui-div mobile-brand">
            <Bear />
            <Text className="ui-strong">熊熊之家</Text>
          </View>
          <View className="ui-span desktop-breadcrumb">
            我的小家 <ChevronRight size={14} />{" "}
            {navigation.find((n) => n.id === page)?.label}
          </View>
          <Text className="ui-span demo-badge">DEMO · 示例小家</Text>
          <Button
            ariaRole="button"
            className="ui-button avatar"
            onClick={() => navigate("profile")}
          >
            熊
          </Button>
        </View>
        <View className="ui-div page-content">
          <View className="ui-div page-heading">
            <View className="ui-div">
              <Text className="ui-span eyebrow">
                {page === "home" ? "一点点，住进理想生活" : "熊熊的小家手记"}
              </Text>
              <View className="ui-h1">
                {page === "home"
                  ? "小家正在长大"
                  : page === "diary"
                    ? "装修记录"
                    : page === "budget"
                      ? "小家的账本"
                      : "关于我的小家"}
                <Text className="ui-span heading-dot">.</Text>
              </View>
            </View>
            <Button
              ariaRole="button"
              className="ui-button primary desktop-add"
              onClick={() => setIsAdding(true)}
            >
              <Plus size={18} tone="white" />
              记一笔
            </Button>
          </View>
          {page === "home" && (
            <>
              <View className="ui-section hero">
                <View className="ui-div hero-text">
                  <View className="ui-span pill">
                    <View className="ui-span" />
                    装修进行中
                  </View>
                  <View className="ui-h2">
                    今天，也离新家<Text className="ui-break">{"\n"}</Text>
                    更近了一点。
                  </View>
                  <View className="ui-p">记录从毛坯到小家的每一个瞬间</View>
                  <Button
                    ariaRole="button"
                    className="ui-button"
                    onClick={() => setIsAdding(true)}
                  >
                    写下今天的进展 <ArrowRight size={17} />
                  </Button>
                </View>
                <View className="ui-div hero-art">
                  <Text className="ui-span art-spark spark-one">✧</Text>
                  <Text className="ui-span art-spark spark-two">✦</Text>
                  <View className="ui-div house-outline" />
                  <Bear large />
                  <Text className="ui-span art-caption">
                    a little closer to home
                  </Text>
                </View>
              </View>
              <View className="ui-div home-grid">
                <View className="ui-div main-column">
                  <View className="ui-section panel progress-panel">
                    <View className="ui-div section-heading">
                      <View className="ui-h2">小家的进度</View>
                      <Text className="ui-span subtle">当前 · 水电阶段</Text>
                    </View>
                    <View className="ui-div stage-track">
                      {stages.map((stage, index) => (
                        <View
                          className={`ui-div ${`stage ${index < 2 ? "done" : index === 2 ? "current" : ""}`}`}
                          key={stage}
                        >
                          <View className="ui-span">
                            {index < 2 ? <Check size={14} /> : index + 1}
                          </View>
                          <Text className="ui-small">{stage}</Text>
                        </View>
                      ))}
                    </View>
                    <View className="ui-div progress-foot">
                      <View className="ui-span">
                        <Sparkles size={15} />
                        把每一个插座，留给未来的日常
                      </View>
                      <Text className="ui-span">3 / 7 阶段</Text>
                    </View>
                  </View>
                  <View className="ui-section recent-section">
                    <View className="ui-div section-heading">
                      <View className="ui-h2">
                        最近的记录{" "}
                        <Text className="ui-span count">{entries.length}</Text>
                      </View>
                      <Button
                        ariaRole="button"
                        className="ui-button text-button"
                        onClick={() => navigate("diary")}
                      >
                        全部记录 <ArrowRight size={15} />
                      </Button>
                    </View>
                    {entryCards(entries.slice(0, 2))}
                  </View>
                </View>
                <View className="ui-div right-column">
                  <View className="ui-section panel budget-preview">
                    <View className="ui-div section-heading">
                      <View className="ui-h2">预算小结</View>
                      <Wallet size={19} />
                    </View>
                    <Text className="ui-span subtle">已经为小家投入</Text>
                    <View className="ui-div money">
                      <Text className="ui-small">¥</Text> 24,800
                      <Text className="ui-span">.00</Text>
                    </View>
                    <View className="ui-div budget-bar">
                      <View className="ui-i" />
                    </View>
                    <View className="ui-div budget-caption">
                      <Text className="ui-span">总预算 ¥180,000</Text>
                      <Text className="ui-strong">13.8%</Text>
                    </View>
                    <Button
                      ariaRole="button"
                      className="ui-button budget-link"
                      onClick={() => navigate("budget")}
                    >
                      去看看账本 <ArrowDownRight size={19} />
                    </Button>
                  </View>
                  <View className="ui-section memo">
                    <Text className="ui-span memo-pin" />
                    <Text className="ui-span eyebrow">给自己的小提醒</Text>
                    <View className="ui-h3">不赶路，慢慢装。</View>
                    <View className="ui-p">
                      家不需要一步到位，<Text className="ui-break">{"\n"}</Text>
                      喜欢的生活可以慢慢填满。
                    </View>
                    <Heart size={23} strokeWidth={1.4} />
                  </View>
                </View>
              </View>
            </>
          )}
          {page === "diary" && (
            <>
              <View className="ui-div intro-line">
                <View className="ui-p">把装修的日常，留成家的回忆。</View>
                <Button
                  ariaRole="button"
                  className="ui-button primary mobile-add"
                  onClick={() => setIsAdding(true)}
                >
                  <Plus size={17} tone="white" />
                  记一笔
                </Button>
              </View>
              <View className="ui-div filters">
                {["全部", ...stages].map((stage) => (
                  <Button
                    ariaRole="button"
                    key={stage}
                    className={`ui-button ${filter === stage ? "selected" : ""}`}
                    onClick={() => setFilter(stage)}
                  >
                    {stage}
                  </Button>
                ))}
              </View>
              {entryCards(
                entries.filter((e) => filter === "全部" || e.stage === filter),
              )}
              {!entries.some(
                (e) => filter === "全部" || e.stage === filter,
              ) && (
                <View className="ui-div empty">
                  <BookOpen size={34} />
                  <View className="ui-h3">这一页，还等着你来写</View>
                  <View className="ui-p">记下这个阶段的小进展吧。</View>
                  <Button
                    ariaRole="button"
                    className="ui-button primary"
                    onClick={() => setIsAdding(true)}
                  >
                    <Plus size={17} tone="white" />
                    添加记录
                  </Button>
                </View>
              )}
            </>
          )}
          {page === "budget" && (
            <>
              <View className="ui-p intro-line">
                每一笔花费，都在变成家的模样。
              </View>
              <View className="ui-section budget-overview panel">
                <Text className="ui-span subtle">总预算 · 示例数据</Text>
                <View className="ui-h2">
                  ¥180,000<Text className="ui-small">.00</Text>
                </View>
                <View className="ui-div">
                  <Text className="ui-span">
                    已支出 <Text className="ui-strong">¥24,800</Text>
                  </Text>
                  <Text className="ui-span">
                    剩余预算 <Text className="ui-strong">¥155,200</Text>
                  </Text>
                </View>
              </View>
              <View className="ui-section panel">
                <View className="ui-div section-heading">
                  <View className="ui-h2">预算分配</View>
                  <Text className="ui-span subtle">示例账本</Text>
                </View>
                {budgetItems.map((item) => (
                  <View className="ui-div budget-row" key={item.name}>
                    <View className="ui-span budget-icon">
                      <Wallet size={20} />
                    </View>
                    <View className="ui-div">
                      <View className="ui-h3">{item.name}</View>
                      <View className="ui-p">
                        预算 ¥{item.budget.toLocaleString()}
                      </View>
                    </View>
                    <Text className="ui-strong">
                      ¥{item.amount.toLocaleString()}
                      <Text className="ui-small">已支出</Text>
                    </Text>
                  </View>
                ))}
              </View>
              <View className="ui-p footnote">
                预算页先展示基础布局，记账功能等我们一起讨论后再完善。
              </View>
            </>
          )}
          {page === "profile" && (
            <>
              <View className="ui-section profile-card panel">
                <Bear />
                <View className="ui-h2">熊熊的小家</View>
                <View className="ui-p">两个人，一只熊，一个慢慢成形的家。</View>
                <Text className="ui-span pill">
                  89 m² · 两室一厅 · 示例小家
                </Text>
              </View>
              <View className="ui-section panel profile-details">
                <View className="ui-div">
                  <Home size={20} />
                  <Text className="ui-span">当前阶段</Text>
                  <Text className="ui-strong">水电施工</Text>
                </View>
                <View className="ui-div">
                  <BookOpen size={20} />
                  <Text className="ui-span">装修记录</Text>
                  <Text className="ui-strong">{entries.length} 篇</Text>
                </View>
                <View className="ui-div">
                  <Settings2 size={20} />
                  <Text className="ui-span">版本</Text>
                  <Text className="ui-strong">跨端 Demo · 0.2.0</Text>
                </View>
              </View>
              <View className="ui-p footnote">
                记录保存在自己的服务器上，手机、Pad、电脑都能看到同一份数据。
              </View>
            </>
          )}
          <View className="ui-footer page-footer">
            慢慢来，家会变成你喜欢的样子 <Heart size={12} />
          </View>
        </View>
      </View>
      <View className="ui-nav bottom-nav">
        {navigation.map(({ id, label, icon: Icon }) => (
          <Button
            ariaRole="button"
            key={id}
            className={`ui-button ${page === id ? "active" : ""}`}
            onClick={() => navigate(id)}
          >
            <Icon size={22} tone={page === id ? "green" : "muted"} />
            <Text className="ui-span">{label}</Text>
          </Button>
        ))}
      </View>
      <EntryEditor
        open={isAdding}
        onClose={() => setIsAdding(false)}
        onSave={addEntry}
      />
      {notice && (
        <View className="ui-div toast">
          <Check size={18} tone="white" />
          {notice}
        </View>
      )}
    </View>
  );
}
