/**
 * 户型数据 · 类型定义（消费 walls.json + rooms.json）
 * 数据准备过程见 ../archive/floorplan-source/README.md
 */

// walls.json（GLB 直接提取，权威版本 — 72 段墙 + 13 个门窗洞 + W63 阳台-客厅分隔墙）
export interface WallData {
  units: "mm";
  outer_bbox: { x: [number, number]; z: [number, number] };
  rooms: Array<{
    id: string;
    name: string;
    glb_name?: string;
    area_m2: number;
  }>;
  walls: WallSegment[];
  openings: Opening[];
  checks?: Record<string, unknown>;
}

export interface WallSegment {
  id: string;
  p1: [number, number]; // GLB XZ mm
  p2: [number, number];
  thickness: number;
  height: number;
  kind: "exterior" | "interior";
  room?: string;
  rooms?: string[];
}

export interface Opening {
  id: string;
  type: "door" | "window";
  subtype: string;
  center: [number, number];
  width: number;
  height: number;
  sill?: number;
  head?: number;
  rotation_deg: number;
  room?: string;
  rooms_touched?: string[];
  wall_id: string;
}

// rooms.json（命名 + 多边形 + 像素坐标，热点的基线数据）
export interface RoomsData {
  meta?: {
    units?: { glb_unit_mm?: number };
    coordinate_system?: Record<string, string>;
  };
  rooms: RoomDatum[];
}

export interface RoomDatum {
  id_viewdata: string;
  english_id?: string;
  name_original_plan: string;
  name_123kanfang?: string;
  name_needs_confirmation?: boolean;
  area_m2: number;
  net_bbox_mm?: {
    width_mm: number;
    depth_mm: number;
  };
  net_polygon_glb_mm: number[][];
  notes?: string;
}
