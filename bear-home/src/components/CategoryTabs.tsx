import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { Button, Text, View } from "@tarojs/components";
import { ChevronRight } from "./Icons";
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

/**
 * 分类标签行（XHS 搜索页标签行对应物）：
 * 手机 = 横滑；桌面 = 溢出时 hover 显现右缘圆形展开钮，
 * 点击换行平铺（高度过渡），箭头翻转 180°，再点收起。
 */
export default function CategoryTabs({
  categories,
  activeId,
  counts,
  onSelect,
  onManage,
}: CategoryTabsProps) {
  const rowRef = useRef<HTMLDivElement>(null);
  const [overflowing, setOverflowing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const expandedRef = useRef(false);
  // 上一段未完动画的收尾（快速连点时不留内联高度卡死布局）
  const settleRef = useRef<(() => void) | null>(null);

  useLayoutEffect(() => {
    expandedRef.current = expanded;
  }, [expanded]);

  /** 内容自然总宽 > 行宽 → 溢出（换行与否都成立，与展开态无关） */
  const measure = useCallback(() => {
    const row = rowRef.current;
    if (!row) return;
    // 小程序无 window.matchMedia：触屏场景保持横滑，不启用展开钮
    if (typeof window === "undefined" || !window.matchMedia) return;
    if (!window.matchMedia("(hover: hover)").matches) return;
    const kids = Array.from(row.children) as HTMLElement[];
    if (kids.length === 0) {
      setOverflowing(false);
      return;
    }
    const gap = parseFloat(getComputedStyle(row).columnGap) || 0;
    const intrinsic =
      kids.reduce((sum, el) => sum + el.offsetWidth, 0) + gap * (kids.length - 1);
    const next = intrinsic > row.clientWidth + 1;
    if (!next && expandedRef.current) {
      settleRef.current?.();
      setExpanded(false);
    }
    setOverflowing(next);
  }, []);

  useLayoutEffect(() => {
    measure();
    const row = rowRef.current;
    if (!row || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(row);
    return () => ro.disconnect();
  }, [categories, measure]);

  function toggle() {
    const row = rowRef.current;
    if (!row) return;
    settleRef.current?.();
    settleRef.current = null;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const settle = () => {
      row.style.height = "";
      row.style.transition = "";
      row.removeEventListener("transitionend", onEnd);
      settleRef.current = null;
    };
    function onEnd(e: TransitionEvent) {
      if (e.propertyName === "height") settle();
    }
    settleRef.current = settle;
    if (reduced) {
      setExpanded(!expandedRef.current);
      settleRef.current = null;
      return;
    }
    const duration = "height var(--dur-base) var(--ease-out)";
    if (!expandedRef.current) {
      const from = row.offsetHeight;
      setExpanded(true);
      requestAnimationFrame(() => {
        const to = row.scrollHeight;
        if (to - from < 2) {
          settleRef.current?.();
          return;
        }
        row.style.transition = duration;
        row.style.height = `${from}px`;
        void row.offsetHeight; // 锁起点后再挂过渡，避免首帧跳变
        row.style.height = `${to}px`;
        row.addEventListener("transitionend", onEnd);
      });
    } else {
      row.style.height = `${row.offsetHeight}px`;
      void row.offsetHeight;
      setExpanded(false);
      requestAnimationFrame(() => {
        const kids = Array.from(row.children) as HTMLElement[];
        const single = kids.length
          ? Math.max(...kids.map((el) => el.offsetHeight))
          : row.offsetHeight;
        row.style.transition = duration;
        row.style.height = `${single}px`;
        row.addEventListener("transitionend", onEnd);
      });
    }
  }

  return (
    <View className={`ui-div cat-tabs-wrap${expanded ? " open" : ""}`}>
      <View
        ref={rowRef}
        className={`ui-div cat-tabs${expanded ? " expanded" : ""}`}
      >
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
      {overflowing && (
        <Button
          ariaRole="button"
          ariaLabel={expanded ? "收起标签" : "展开标签"}
          className={`ui-button cat-expand${expanded ? " open" : ""}`}
          onClick={toggle}
        >
          <ChevronRight size={14} tone="white" />
        </Button>
      )}
    </View>
  );
}
