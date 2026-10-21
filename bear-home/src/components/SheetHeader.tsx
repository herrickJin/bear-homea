import type { ReactNode } from "react";
import { Button, Text, View } from "@tarojs/components";
import { X } from "./Icons";

/** Shared compact header for sheets, editors and detail dialogs. */
export default function SheetHeader({ title, onClose, action }: {
  title: ReactNode;
  onClose: () => void;
  action?: ReactNode;
}) {
  return <View className="ui-div sheet-header">
    <Text className="sheet-header-title">{title}</Text>
    {action && <View className="ui-div sheet-header-action">{action}</View>}
    <Button ariaRole="button" ariaLabel="关闭" className="ui-button sheet-header-close" onClick={onClose}>
      <X size={16} tone="muted" />
    </Button>
  </View>;
}
