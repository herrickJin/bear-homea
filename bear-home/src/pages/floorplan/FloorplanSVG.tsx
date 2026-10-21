import type { JSX } from "react";
import wallsJson from "../../data/floorplan/walls.json";
import roomsJson from "../../data/floorplan/rooms.json";

/**
 * 户型平面图（walls.json 权威墙几何 + rooms.json 命名与多边形）
 * 全部 mm，GLB XZ 平面；X 向右、Z 向下。
 * 数据口径与校验见 archive/floorplan-source/README.md。
 */

export interface FloorplanSVGProps {
  showLabels?: boolean;
  showDoors?: boolean;
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
}

type Point = [number, number];

interface RoomShape {
  polys: Point[][];
  name: string;
  area: number;
  needsConfirm: boolean;
}

/**
 * rooms.json 的 net_polygon_glb_mm 是「单个多边形」number[][]；
 * 这里按首元素类型兜底判定：首元素是数字 → 单多边形；首元素是点数组 → 多多边形。
 */
function toPolygons(raw: unknown): Point[][] {
  if (!Array.isArray(raw) || raw.length === 0) return [];
  const first = raw[0];
  if (typeof first === "number") return [raw as Point[]];
  if (Array.isArray(first) && typeof first[0] === "number") {
    return [raw as Point[]];
  }
  if (Array.isArray(first) && Array.isArray(first[0])) {
    return (raw as Point[][]).filter((p) => Array.isArray(p) && p.length > 2);
  }
  return [];
}

const roomsById = new Map<string, RoomShape>();
for (const r of (roomsJson as { rooms?: Array<Record<string, unknown>> })
  .rooms ?? []) {
  roomsById.set(String(r.id_viewdata), {
    polys: toPolygons(r.net_polygon_glb_mm),
    name: String(r.name_original_plan ?? r.id_viewdata),
    area: Number(r.area_m2 ?? 0),
    needsConfirm: Boolean(r.name_needs_confirmation),
  });
}

const wallsRaw = wallsJson as unknown as {
  outer_bbox?: { x: [number, number]; z: [number, number] };
  walls?: Array<Record<string, unknown>>;
  openings?: Array<Record<string, unknown>>;
};
const walls = wallsRaw.walls ?? [];
const openings = wallsRaw.openings ?? [];

const bbox = wallsRaw.outer_bbox ?? {
  x: [-8175, 5237.5] as [number, number],
  z: [-5500.3, 5884.7] as [number, number],
};
const PAD = 500;
const VB = {
  x: bbox.x[0] - PAD,
  y: bbox.z[0] - PAD,
  w: bbox.x[1] - bbox.x[0] + PAD * 2,
  h: bbox.z[1] - bbox.z[0] + PAD * 2,
};

function pathOf(poly: Point[]): string {
  if (!Array.isArray(poly) || poly.length < 3) return "";
  let d = `M ${poly[0][0]} ${poly[0][1]}`;
  for (let i = 1; i < poly.length; i++) d += ` L ${poly[i][0]} ${poly[i][1]}`;
  return d + " Z";
}

function pathOfAll(polys: Point[][]): string {
  return polys.map(pathOf).filter(Boolean).join(" ");
}

function centroid(poly: Point[]): { x: number; z: number; areaM2: number } {
  let sx = 0;
  let sz = 0;
  let a2 = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, z1] = poly[i];
    const [x2, z2] = poly[(i + 1) % poly.length];
    const cross = x1 * z2 - x2 * z1;
    sx += (x1 + x2) * cross;
    sz += (z1 + z2) * cross;
    a2 += cross;
  }
  if (!Number.isFinite(a2) || Math.abs(a2) < 1) return { x: 0, z: 0, areaM2: 0 };
  return {
    x: sx / (3 * a2),
    z: sz / (3 * a2),
    areaM2: Math.abs(a2) / 2 / 1e6,
  };
}

/** 标签锚点：取面积最大的子区质心，避免多子区房间标签乱飞。 */
function labelAnchor(polys: Point[][]): Point {
  let best: { x: number; z: number; areaM2: number } | null = null;
  for (const poly of polys) {
    const c = centroid(poly);
    if (!best || c.areaM2 > best.areaM2) best = c;
  }
  if (best && best.areaM2 > 0 && Number.isFinite(best.x)) {
    return [best.x, best.z];
  }
  const first = polys[0];
  if (first && first.length) {
    const mid = first[Math.floor(first.length / 2)];
    return [mid[0], mid[1]];
  }
  return [0, 0];
}

const C = {
  paper: "#faf9f7",
  room: "#ffffff",
  roomSel: "#edf3ee",
  ink: "#1f2421",
  mute: "#6d736e",
  primary: "#356d5b",
  clay: "#cf7f63",
  ink2: "#434a45",
};

export default function FloorplanSVG({
  showLabels = true,
  showDoors = true,
  selectedId = null,
  onSelect,
}: FloorplanSVGProps): JSX.Element {
  return (
    <svg
      role="img"
      aria-label="户型平面图"
      viewBox={`${VB.x} ${VB.y} ${VB.w} ${VB.h}`}
      preserveAspectRatio="xMidYMid meet"
      style={{
        width: "100%",
        height: "auto",
        display: "block",
        background: C.paper,
      }}
    >
      {/* 1) 房间底色 */}
      <g>
        {Array.from(roomsById.entries()).map(([id, room]) => (
          <path
            key={`fill-${id}`}
            d={pathOfAll(room.polys)}
            fill={id === selectedId ? C.roomSel : C.room}
            stroke="none"
            style={{ cursor: "pointer" }}
            onClick={() => onSelect?.(id)}
          />
        ))}
      </g>

      {/* 2) 墙段 · strokeWidth 用真实墙厚（mm），任意缩放下视觉都正确 */}
      <g pointerEvents="none">
        {walls.map((w, i) => {
          const p1 = w.p1 as Point | undefined;
          const p2 = w.p2 as Point | undefined;
          if (!p1 || !p2) return null;
          const thickness = Number(w.thickness ?? 200);
          const exterior = w.kind === "exterior";
          return (
            <line
              key={`w-${String(w.id ?? i)}`}
              x1={p1[0]}
              y1={p1[1]}
              x2={p2[0]}
              y2={p2[1]}
              stroke={C.ink}
              strokeOpacity={exterior ? 0.92 : 0.5}
              strokeWidth={Math.max(60, thickness)}
              strokeLinecap="butt"
            />
          );
        })}
      </g>

      {/* 3) 门窗洞 · 底色打孔 + 符号 */}
      {showDoors &&
        openings.map((o, i) => {
          const center = o.center as Point | undefined;
          if (!center) return null;
          const width = Math.max(Number(o.width ?? 800), 150);
          const angle = (Number(o.rotation_deg ?? 0) * Math.PI) / 180;
          const dx = Math.cos(angle);
          const dy = Math.sin(angle);
          const sx = center[0] - (dx * width) / 2;
          const sy = center[1] - (dy * width) / 2;
          const ex = center[0] + (dx * width) / 2;
          const ey = center[1] + (dy * width) / 2;
          const isWindow = o.type === "window";
          const hole = Math.max(70, Math.min(260, width * 0.4));
          return (
            <g key={`o-${String(o.id ?? i)}`} pointerEvents="none">
              <line
                x1={sx}
                y1={sy}
                x2={ex}
                y2={ey}
                stroke={C.paper}
                strokeWidth={hole}
              />
              <line
                x1={sx}
                y1={sy}
                x2={ex}
                y2={ey}
                stroke={C.ink}
                strokeWidth={isWindow ? 34 : 40}
              />
              {isWindow ? (
                <line
                  x1={sx}
                  y1={sy}
                  x2={ex}
                  y2={ey}
                  stroke={C.paper}
                  strokeWidth={10}
                />
              ) : (
                <path
                  d={`M ${sx} ${sy} A ${width} ${width} 0 0 1 ${
                    ex + -dy * width
                  } ${ey + dx * width}`}
                  fill="none"
                  stroke={C.ink2}
                  strokeWidth={14}
                  opacity={0.55}
                />
              )}
            </g>
          );
        })}

      {/* 4) 房间名 + 面积 */}
      {showLabels && (
        <g pointerEvents="none">
          {Array.from(roomsById.entries()).map(([id, room]) => {
            const [ax, az] = labelAnchor(room.polys);
            const fs = Math.max(200, Math.min(560, room.area * 15));
            return (
              <g key={`label-${id}`} textAnchor="middle">
                <text
                  x={ax}
                  y={az - fs * 0.3}
                  fill={C.ink}
                  style={{
                    fontFamily: "'Songti SC','STSong','Noto Serif SC',serif",
                    fontSize: fs + "px",
                  }}
                >
                  {room.name}
                  {room.needsConfirm ? " ?" : ""}
                </text>
                <text
                  x={ax}
                  y={az + fs * 0.8}
                  fill={C.mute}
                  style={{
                    fontFamily: "ui-monospace,'SF Mono',Menlo,monospace",
                    fontSize: fs * 0.46 + "px",
                  }}
                >
                  {room.area.toFixed(2)} ㎡
                </text>
              </g>
            );
          })}
        </g>
      )}

      {/* 5) 选中态描边 */}
      {selectedId && roomsById.get(selectedId) && (
        <path
          d={pathOfAll(roomsById.get(selectedId)!.polys)}
          fill="none"
          stroke={C.primary}
          strokeWidth={40}
          pointerEvents="none"
        />
      )}

      {/* 6) 朝向标（GLB +Z = 北，据 WechatIMG209.jpg 指北针判定） */}
      <g pointerEvents="none">
        <line
          x1={VB.x + 760}
          y1={VB.y + 600}
          x2={VB.x + 760}
          y2={VB.y + 1700}
          stroke={C.clay}
          strokeWidth={70}
          strokeLinecap="round"
        />
        <text
          x={VB.x + 760}
          y={VB.y + 380}
          textAnchor="middle"
          fill={C.clay}
          style={{
            fontFamily: "ui-monospace,'SF Mono',Menlo,monospace",
            fontSize: "320px",
          }}
        >
          N ↑
        </text>
      </g>
    </svg>
  );
}
