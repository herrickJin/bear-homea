import { useEffect, useRef, useState } from "react";
import Taro from "@tarojs/taro";
import { Button, Image, Text, Textarea, View } from "@tarojs/components";
import type { Category, SaveDraft } from "../data/mockInspiration";
import { parseShareText } from "../data/mockInspiration";
import { X } from "./Icons";

/**
 * 收藏弹层「对家的想法」（v5）
 * - 一个输入框：粘贴真实分享文本（【标题】+噪音+长URL）或随手记想法
 * - 实时解析：提取规范链接 + 【】标题（标题直接当卡片标题，无需等抓取）
 * - 轻量截图：分享出去是图片时，存相册后在这里贴上
 * - 手机底部弹层 / 进出同路径 / reduced-motion 退化
 */
interface SaveSheetProps {
  open: boolean;
  categories: Category[];
  onClose: () => void;
  onSave: (draft: SaveDraft) => void;
}

const CLOSE_MS = 260;

export default function SaveSheet({
  open,
  categories,
  onClose,
  onSave,
}: SaveSheetProps) {
  const [text, setText] = useState("");
  const [categoryIds, setCategoryIds] = useState<string[]>([]);
  const [shotPath, setShotPath] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open) return;
    setClosing(false);
    setText("");
    setCategoryIds([]);
    setShotPath(null);
    (async () => {
      try {
        const clip = await Taro.getClipboardData();
        const value = (clip?.data ?? "").trim();
        if (value) setText(value);
      } catch {
        /* 读不到就手动粘贴 */
      }
    })();
    return () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    };
  }, [open]);

  if (!open) return null;

  const parsed = parseShareText(text);

  function requestClose() {
    if (closing) return;
    setClosing(true);
    closeTimer.current = setTimeout(() => {
      setClosing(false);
      onClose();
    }, CLOSE_MS);
  }

  function toggleCategory(id: string) {
    setCategoryIds((prev) =>
      prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id],
    );
  }

  async function pasteFromClipboard() {
    try {
      const clip = await Taro.getClipboardData();
      const value = (clip?.data ?? "").trim();
      if (value) {
        setText(value);
        Taro.showToast({ title: "已粘贴", icon: "none" });
      } else {
        Taro.showToast({ title: "剪贴板是空的", icon: "none" });
      }
    } catch {
      Taro.showToast({ title: "请长按输入框粘贴", icon: "none" });
    }
  }

  function pickShot() {
    Taro.chooseImage({ count: 1, sizeType: ["compressed"] })
      .then((res) => setShotPath(res.tempFilePaths[0] ?? null))
      .catch(() => {
        /* 用户取消不提示 */
      });
  }

  function submit() {
    const value = text.trim();
    if (!value && !shotPath) {
      Taro.showToast({ title: "写点什么，或粘贴分享内容", icon: "none" });
      return;
    }
    onSave({
      url: parsed.url,
      title: parsed.url ? parsed.title : null,
      note: parsed.url ? "" : value,
      categoryIds,
      shotPath,
    });
  }

  return (
    <View
      className={`ui-div ${`sheet-backdrop save-backdrop${closing ? " closing" : ""}`}`}
      onClick={requestClose}
    >
      <View
        className={`ui-div ${`sheet save-sheet${closing ? " closing" : ""}`}`}
        onClick={(e) => e.stopPropagation()}
      >
        <View className="ui-div section-heading">
          <Text className="ui-h2">对家的想法</Text>
          <Button
            ariaRole="button"
            className="ui-button"
            onClick={requestClose}
          >
            <X size={18} tone="muted" />
          </Button>
        </View>

        <View className="ui-div label-row">
          <Text className="ui-span field-label">分享或想法</Text>
          <View className="ui-div label-actions">
            <Button
              ariaRole="button"
              className="ui-button field-action"
              onClick={pickShot}
            >
              截图
            </Button>
            <Button
              ariaRole="button"
              className="ui-button field-action"
              onClick={pasteFromClipboard}
            >
              粘贴
            </Button>
          </View>
        </View>
        <Textarea
          className="field-textarea"
          value={text}
          placeholder="粘贴小红书分享，或记下想法…"
          placeholderClass="search-placeholder"
          maxlength={1000}
          onInput={(e) => setText(e.detail.value)}
        />
        {parsed.url && (
          <View className="ui-div parse-hint">
            <Text className="ui-span">
              ✓ 已识别小红书链接
              {parsed.title ? ` · ${parsed.title}` : ""}
            </Text>
          </View>
        )}
        {shotPath && (
          <View className="ui-div shot-preview">
            <Image className="shot-thumb" src={shotPath} mode="aspectFill" />
            <Button
              ariaRole="button"
              className="ui-button field-action"
              onClick={() => setShotPath(null)}
            >
              移除
            </Button>
          </View>
        )}

        <Text className="ui-span field-label">归类 · 可跳过</Text>
        <View className="ui-div chip-line">
          {categories.map((c) => (
            <Button
              ariaRole="button"
              key={c.id}
              className={`ui-button ${`chip${categoryIds.includes(c.id) ? " selected" : ""}`}`}
              onClick={() => toggleCategory(c.id)}
            >
              {c.name}
            </Button>
          ))}
        </View>

        <Button
          ariaRole="button"
          className="ui-button btn-primary"
          onClick={submit}
        >
          收藏
        </Button>
      </View>
    </View>
  );
}
