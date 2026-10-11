import { useEffect, useRef, useState } from "react";
import Taro from "@tarojs/taro";
import { Button, Input, Text, Textarea, View } from "@tarojs/components";
import { X } from "./Icons";
import type {
  LedgerCategory,
  LedgerDraft,
  LedgerItem,
  LedgerKind,
  LedgerStatus,
} from "../services/ledger";
import { channelPresets, kindLabels, statusOrder, statusMeta } from "../services/ledger";

/**
 * 记一笔 / 编辑条目（增改共用）。
 * 快存慢补：品类 + 名称必填，价格/渠道/备注/状态可跳过（状态默认「在看」）。
 * 手机底部升起 / 桌面居中卡，复用 save-sheet 动线。
 */
interface LedgerSheetProps {
  open: boolean;
  /** 一级（由主页当前页签决定，弹层内不再切） */
  kind: LedgerKind;
  categories: LedgerCategory[];
  /** null = 新增 */
  initial: LedgerItem | null;
  onClose: () => void;
  onSubmit: (draft: LedgerDraft, id?: string) => void;
}

const CLOSE_MS = 260;

export default function LedgerSheet({
  open,
  kind,
  categories,
  initial,
  onClose,
  onSubmit,
}: LedgerSheetProps) {
  const [category, setCategory] = useState<string | null>(null);
  const [customizing, setCustomizing] = useState(false);
  const [customText, setCustomText] = useState("");
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [channel, setChannel] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [status, setStatus] = useState<LedgerStatus>("looking");
  const [closing, setClosing] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open) return;
    setClosing(false);
    setCategory(initial?.category ?? null);
    setCustomizing(false);
    setCustomText("");
    setName(initial?.name ?? "");
    setPrice(initial?.price != null ? String(initial.price) : "");
    setChannel(initial?.channel ?? null);
    setNote(initial?.note ?? "");
    setStatus(initial?.status ?? "looking");
    return () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    };
  }, [open, initial?.id]);

  if (!open) return null;

  function requestClose() {
    if (closing) return;
    setClosing(true);
    closeTimer.current = setTimeout(() => {
      setClosing(false);
      onClose();
    }, CLOSE_MS);
  }

  function confirmCustom() {
    const value = customText.trim().slice(0, 12);
    if (!value) return;
    setCategory(value);
    setCustomizing(false);
    setCustomText("");
  }

  function submit() {
    if (!category) {
      Taro.showToast({ title: "先选个品类", icon: "none" });
      return;
    }
    const value = name.trim();
    if (!value) {
      Taro.showToast({ title: "写上名称或型号", icon: "none" });
      return;
    }
    const parsed = Number.parseFloat(price);
    onSubmit(
      {
        kind,
        category,
        name: value,
        price: Number.isFinite(parsed) ? parsed : null,
        channel: channel,
        note: note.trim() || null,
        status,
      },
      initial?.id,
    );
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
          <Text className="ui-h2">{initial ? "编辑条目" : "记一笔"}</Text>
          <Button ariaRole="button" className="ui-button" onClick={requestClose}>
            <X size={18} tone="muted" />
          </Button>
        </View>

        <Text className="ui-span field-label">品类（{kindLabels[kind]}）</Text>
        <View className="ui-div chip-row">
          {categories.map((c) => (
            <Button
              ariaRole="button"
              key={c.id}
              className={`ui-button chip${category === c.id ? " selected" : ""}`}
              onClick={() => setCategory(c.id)}
            >
              {c.name}
            </Button>
          ))}
          {!customizing && (
            <Button
              ariaRole="button"
              className="ui-button chip chip-add"
              onClick={() => setCustomizing(true)}
            >
              ＋ 自定义
            </Button>
          )}
        </View>
        {customizing && (
          <View className="ui-div field chip-new">
            <Input
              className="field-input"
              value={customText}
              focus
              maxlength={12}
              placeholder={`自定义品类，如「${kind === "appliance" ? "投影" : "辅材"}」`}
              placeholderClass="search-placeholder"
              onInput={(e) => setCustomText(e.detail.value)}
              onConfirm={confirmCustom}
            />
            <Button
              ariaRole="button"
              className="ui-button field-action"
              onClick={confirmCustom}
            >
              确定
            </Button>
          </View>
        )}

        <Text className="ui-span field-label">名称 / 型号</Text>
        <View className="ui-div field">
          <Input
            className="field-input"
            value={name}
            maxlength={60}
            placeholder="品牌 + 型号，如「格力 云逸-II 1.5匹」"
            placeholderClass="search-placeholder"
            onInput={(e) => setName(e.detail.value)}
          />
        </View>

        <Text className="ui-span field-label">价格 · 元</Text>
        <View className="ui-div field">
          <Text className="ui-span rec-price-mark">¥</Text>
          <Input
            className="field-input"
            value={price}
            type="digit"
            placeholder="没问价可空着"
            placeholderClass="search-placeholder"
            onInput={(e) => setPrice(e.detail.value)}
          />
        </View>

        <Text className="ui-span field-label">渠道 · 可跳过</Text>
        <View className="ui-div chip-row">
          {channelPresets.map((ch) => (
            <Button
              ariaRole="button"
              key={ch}
              className={`ui-button chip${channel === ch ? " selected" : ""}`}
              onClick={() => setChannel(channel === ch ? null : ch)}
            >
              {ch}
            </Button>
          ))}
        </View>

        <Text className="ui-span field-label">备注 · 参数、活动、现场感受</Text>
        <Textarea
          className="field-textarea"
          value={note}
          placeholder="如「含安装」「可再砍」「赠品是…」"
          placeholderClass="search-placeholder"
          maxlength={300}
          onInput={(e) => setNote(e.detail.value)}
        />

        <Text className="ui-span field-label">状态</Text>
        <View className="ui-div chip-row">
          {statusOrder.map((s) => (
            <Button
              ariaRole="button"
              key={s}
              className={`ui-button chip${status === s ? " selected" : ""}`}
              onClick={() => setStatus(s)}
            >
              {statusMeta[s].label}
            </Button>
          ))}
        </View>

        <Button
          ariaRole="button"
          className="ui-button btn-primary"
          onClick={submit}
        >
          {initial ? "保存" : "记一笔"}
        </Button>
      </View>
    </View>
  );
}
