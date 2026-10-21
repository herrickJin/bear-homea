import { useMemo, useState, useCallback } from "react";
import Taro from "@tarojs/taro";
import { View, Text, Button } from "@tarojs/components";
import FloorplanSVG from "./FloorplanSVG";
import type { RoomsData } from "./types";
import roomsJson from "../../data/floorplan/rooms.json";
import "./floorplan.css";

const namedRooms = roomsJson as unknown as RoomsData;

export default function Page() {
  const [showLabels, setShowLabels] = useState(true);
  const [showDoors, setShowDoors] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const onBack = useCallback(() => {
    Taro.navigateBack({ delta: 1 });
  }, []);

  const selected = useMemo(
    () => namedRooms.rooms.find((r) => r.id_viewdata === selectedId) ?? null,
    [selectedId]
  );

  return (
    <View className="fp-shell">
      <View className="fp-header">
        <Button
          className="fp-back"
          ariaRole="button"
          onClick={onBack}
          style={{ border: "none", background: "transparent" }}
        >
          <Text className="fp-back-arrow">←</Text>
          <Text className="fp-back-label">小家</Text>
        </Button>
        <View className="fp-title">
          <Text className="fp-eyebrow">原始建筑测量图 · 第一版</Text>
          <Text className="fp-h1">
            户型平面<Text className="fp-dot">.</Text>
          </Text>
        </View>
        <Text className="fp-spacer" />
      </View>

      <View className="fp-toolbar">
        <Toggle
          on={showLabels}
          onClick={() => setShowLabels((v) => !v)}
          label="房间名"
        />
        <Toggle
          on={showDoors}
          onClick={() => setShowDoors((v) => !v)}
          label="门窗洞"
        />
      </View>

      <View className="fp-stage">
        <FloorplanSVG
          showLabels={showLabels}
          showDoors={showDoors}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
      </View>

      <View className="fp-legend panel">
        <Text className="fp-legend-hint">
          点房间查看详情。
          {selected
            ? `当前选中：${selected.name_original_plan}${
                selected.name_needs_confirmation ? "  ?" : ""
              } · ${selected.area_m2.toFixed(2)} ㎡`
            : "未选中。"}
        </Text>
        {selected && (
          <View className="fp-detail">
            <DetailRow
              k="尺寸"
              v={`${((selected.net_bbox_mm?.width_mm ?? 0) / 1000).toFixed(2)} × ${(
                (selected.net_bbox_mm?.depth_mm ?? 0) / 1000
              ).toFixed(2)} m`}
            />
            <DetailRow k="净面积" v={`${selected.area_m2.toFixed(2)} ㎡`} />
            <DetailRow k="ViewData ID" v={selected.id_viewdata} mono />
            {selected.notes && <DetailRow k="备注" v={selected.notes} />}
            <Button
              className="fp-clear"
              onClick={() => setSelectedId(null)}
              ariaRole="button"
              style={{
                border: "none",
                background: "transparent",
                color: "#cf7f63",
                marginTop: "var(--sp-3)",
              }}
            >
              清除选中
            </Button>
          </View>
        )}
      </View>

      <View className="fp-footer">
        <Text className="fp-footer-line">
          数据来自 123kanfang 公开方案（意式·极意之境），坐标换算 1 GLB 单位
          =10mm。未经现场实测校准，仅作量级参考。
        </Text>
      </View>
    </View>
  );
}

function Toggle({
  on,
  onClick,
  label,
}: {
  on: boolean;
  onClick: () => void;
  label: string;
}): JSX.Element {
  return (
    <Button
      className={`fp-toggle ${on ? "is-on" : ""}`}
      onClick={onClick}
      ariaRole="button"
      style={{ border: "none", background: "transparent" }}
    >
      <Text className={`fp-toggle-dot ${on ? "is-on" : ""}`} />
      <Text className="fp-toggle-label">{label}</Text>
    </Button>
  );
}

function DetailRow({
  k,
  v,
  mono,
}: {
  k: string;
  v: string;
  mono?: boolean;
}): JSX.Element {
  return (
    <View className="fp-row">
      <Text className="fp-row-k">{k}</Text>
      <Text className={`fp-row-v ${mono ? "fp-row-v-mono" : ""}`}>{v}</Text>
    </View>
  );
}
