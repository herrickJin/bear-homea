import { Text, View } from "@tarojs/components";
import type { LedgerItem } from "../services/ledger";
import { displayDate, formatPrice, statusMeta } from "../services/ledger";

interface LedgerCardProps {
  item: LedgerItem;
  onOpen: (item: LedgerItem) => void;
}

/** 台账卡片：名称 + 价格（mono）一行，状态点 + 渠道 · 日期一行，备注可选一行 */
export default function LedgerCard({ item, onOpen }: LedgerCardProps) {
  return (
    <View
      className={`ui-div ledger-card st-${item.status}`}
      onClick={() => onOpen(item)}
    >
      <View className="ui-div rec-card-main">
        <Text className="ui-strong rec-card-name">{item.name}</Text>
        <Text className="rec-card-price">
          {item.price != null ? formatPrice(item.price) : "—"}
        </Text>
      </View>
      <View className="ui-div rec-card-meta">
        <View className={`ui-i rec-status-dot st-${item.status}`} />
        <Text className={`ui-span rec-status-text st-${item.status}`}>
          {statusMeta[item.status].label}
        </Text>
        <Text className="ui-time">
          {item.channel ? `${item.channel} · ` : ""}
          {displayDate(item.date)}
        </Text>
      </View>
      {item.note && <View className="ui-p rec-card-note">{item.note}</View>}
    </View>
  );
}
