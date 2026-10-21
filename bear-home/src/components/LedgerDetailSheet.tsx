import { useEffect } from "react";
import Taro from "@tarojs/taro";
import { Button, Text, View } from "@tarojs/components";
import SheetHeader from "./SheetHeader";
import type { LedgerItem, LedgerStatus } from "../services/ledger";
import { displayDate, formatPrice, kindLabels, statusMeta, statusOrder } from "../services/ledger";

/**
 * 条目详情弹层：原地渲染在台账上，不走路由。
 * 桌面 = 暗背景 + 居中卡；手机 = 底部升起（save-sheet 动线）。
 * 状态流转：点 chip 即存，列表同步。
 */
interface LedgerDetailSheetProps {
  item: LedgerItem;
  onClose: () => void;
  onStatusChange: (id: string, status: LedgerStatus) => void;
  onEdit: (item: LedgerItem) => void;
  onDeleted: (id: string) => void;
}

export default function LedgerDetailSheet({
  item,
  onClose,
  onStatusChange,
  onEdit,
  onDeleted,
}: LedgerDetailSheetProps) {
  // ESC 关闭（编译期裁剪，小程序不受影响）
  useEffect(() => {
    if (process.env.TARO_ENV !== "h5") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function confirmDelete() {
    Taro.showModal({
      title: "删除这条记录？",
      content: "删除后不可恢复",
      confirmText: "删除",
      confirmColor: "#cf7f63",
      success: (res) => {
        if (res.confirm) onDeleted(item.id);
      },
    });
  }

  return (
    <View className="ui-div sheet-backdrop save-backdrop" onClick={onClose}>
      <View
        className="ui-div sheet sheet-with-header save-sheet rec-detail"
        onClick={(e) => e.stopPropagation()}
      >
        <SheetHeader title={`${kindLabels[item.kind]} · ${item.category}`} onClose={onClose} />

        <View className="ui-h3 rec-detail-name">{item.name}</View>
        {item.price != null ? (
          <View className="rec-detail-price">{formatPrice(item.price)}</View>
        ) : (
          <Text className="ui-span rec-detail-noprice">没问价</Text>
        )}

        <View className="ui-div chip-row rec-status-row">
          {statusOrder.map((s) => (
            <Button
              ariaRole="button"
              key={s}
              className={`ui-button chip${item.status === s ? " selected" : ""}`}
              onClick={() => item.status !== s && onStatusChange(item.id, s)}
            >
              {statusMeta[s].label}
            </Button>
          ))}
        </View>

        <View className="ui-div rec-info">
          <View className="ui-div rec-info-row">
            <Text className="ui-span rec-info-label">渠道</Text>
            <Text className="ui-span rec-info-value">{item.channel ?? "—"}</Text>
          </View>
          <View className="ui-div rec-info-row">
            <Text className="ui-span rec-info-label">记录于</Text>
            <Text className="ui-span rec-info-value">{displayDate(item.date)}</Text>
          </View>
        </View>

        {item.note && <View className="ui-p rec-detail-note">{item.note}</View>}

        <View className="ui-div detail-date-row rec-detail-actions">
          <View className="ui-div detail-actions">
            <Text className="ui-span detail-edit-hint" onClick={() => onEdit(item)}>
              编辑
            </Text>
            <Text className="ui-span detail-delete-hint" onClick={confirmDelete}>
              删除
            </Text>
          </View>
        </View>
      </View>
    </View>
  );
}
