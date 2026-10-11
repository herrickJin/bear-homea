import { useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import Taro, { useResize } from "@tarojs/taro";
import { Button, Text, View } from "@tarojs/components";
import {
  BookOpen,
  Bookmark,
  ChevronRight,
  Heart,
  Home,
  LayoutGrid,
  Wallet,
} from "./Icons";
import Bear from "./Bear";

/**
 * 骨架版 Screen：应用外壳（品牌侧边栏 / 顶栏 / 底部导航）与页面容器。
 * 页面内容通过 children 传入；不传则显示「功能重设计中」空态。
 */

export type Page = "home" | "inspiration" | "diary" | "budget" | "profile";

const navigation = [
  { id: "home", label: "小家", icon: Home },
  { id: "inspiration", label: "笔记", icon: Bookmark },
  { id: "diary", label: "记录", icon: BookOpen },
  { id: "budget", label: "预算", icon: Wallet },
  { id: "profile", label: "我的", icon: LayoutGrid },
] as const;

const pageCopy: Record<Page, { eyebrow: string; title: string }> = {
  home: { eyebrow: "一点点，住进理想生活", title: "小家" },
  inspiration: { eyebrow: "我们家的样子", title: "笔记库" },
  diary: { eyebrow: "把装修的日常留成回忆", title: "装修记录" },
  budget: { eyebrow: "每一笔花费都在变成家", title: "预算" },
  profile: { eyebrow: "关于这个小家", title: "我的" },
};

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

interface ScreenProps {
  page: Page;
  eyebrow?: string;
  title?: string;
  action?: ReactNode;
  /** 详情类页面：不渲染大字标题区 */
  hideHeading?: boolean;
  children?: ReactNode;
}

export default function Screen({
  page,
  eyebrow,
  title,
  action,
  hideHeading,
  children,
}: ScreenProps) {
  const [headerStyle, setHeaderStyle] = useState(getHeaderStyle);
  useResize(() => setHeaderStyle(getHeaderStyle()));

  function navigate(next: Page) {
    if (next === page) {
      Taro.pageScrollTo({ scrollTop: 0, duration: 0 });
      return;
    }
    Taro.redirectTo({ url: `/pages/${next}/index` });
  }

  const copy = {
    eyebrow: eyebrow ?? pageCopy[page].eyebrow,
    title: title ?? pageCopy[page].title,
  };
  const currentLabel = navigation.find((n) => n.id === page)?.label ?? "";

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
            我的小家 <ChevronRight size={14} /> {currentLabel}
          </View>
          <Button ariaRole="button" className="ui-button avatar">
            熊
          </Button>
        </View>
        <View className="ui-div page-content">
          {!hideHeading && (
            <View className="ui-div page-heading">
              <View className="ui-div">
                <Text className="ui-span eyebrow">{copy.eyebrow}</Text>
                <View className="ui-h1">
                  {copy.title}
                  <Text className="ui-span heading-dot">.</Text>
                </View>
              </View>
              {action}
            </View>
          )}
          {children ?? (
            <View className="ui-section panel">
              <View className="ui-div empty">
                <Bear />
                <View className="ui-h3">功能重设计中</View>
                <View className="ui-p">
                  这里只保留了页面骨架，正式功能将在重新设计后填充。
                </View>
              </View>
            </View>
          )}
          <View className="ui-p footnote">
            熊熊之家 · 跨端骨架（微信小程序 / H5）
          </View>
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
    </View>
  );
}
