#!/usr/bin/env python3
"""
derive_walls_from_rooms.py
从 ViewData.json 房间净区边界 + walls.json 门窗洞，重建一份完整的 2D 墙网（mm）。

理由：glb-walls 从 GLB Mesh/MergedMesh 直接拆墙段只拿到 5 段（墙体多数被合并成大块），
但房间净区边界（内墙面）本身就是连续墙体，把它们按"邻接段合并 → 开口处断开"处理，
就得到一份完整的 2D 墙网，配合 21 个门窗洞足以渲染一张可用的户型测量图。
"""
import json, math
from pathlib import Path

BASE = Path(__file__).parent
VD = json.loads((BASE.parent / "ViewData.json").read_text())
WALLS = json.loads((BASE / "walls.json").read_text())

OPEN_HALF_THICKNESS = 100.0  # mm, 开口半径（门的扇区，墙厚按此断开）
OPENING_GAP = 60.0           # mm, 邻接段边线在开口处的合并容差


def shoelace(poly):
    s = 0.0
    for i in range(len(poly)):
        x1, y1 = poly[i]
        x2, y2 = poly[(i + 1) % len(poly)]
        s += x1 * y2 - x2 * y1
    return abs(s) / 2


def view_to_glb(x_v, y_v):
    """ViewData (X, Y) → GLB (X_mm, Z_mm)。Y 翻转，×10。"""
    return round(x_v * 10, 1), round(-y_v * 10, 1)


# 1) 把每个房间的所有 RoomAreas 合并为一个 bbox + 多个 outline
floor = VD["Floors"][0]
rooms_outlines = []  # [(viewdata_id, color, [(x_mm,z_mm), ...])]
for r in floor["Rooms"]:
    for a in r.get("RoomAreas", []):
        poly_glb = [view_to_glb(p["X"], p["Y"]) for p in a["polygon"]]
        if len(poly_glb) >= 3:
            rooms_outlines.append((r["ID"], r["Name"], a["polygon"], poly_glb))


# 2) 收边：每个 outline 的每条边视为"墙段候选"，再按方向/位置合并"重合边"
def edge_key(p1, p2):
    """用统一方向的有序 tuple 作为边的标识。"""
    if p1 > p2:
        p1, p2 = p2, p1
    return (p1, p2)


# 收集所有边
edges_by_room = []
for vd_id, nm, poly_v, poly_g in rooms_outlines:
    for i in range(len(poly_g)):
        p1 = poly_g[i]
        p2 = poly_g[(i + 1) % len(poly_g)]
        edges_by_room.append((vd_id, nm, p1, p2))

# 邻接合并：同一线段（同色房间 + 端点重合到 ±2mm）= 一段墙
def nearly_equal(p1, p2, tol=2.0):
    return abs(p1[0] - p2[0]) < tol and abs(p1[1] - p2[1]) < tol


# 把边按"轴对齐"分组，组内沿墙合并为最长段
def classify(p1, p2):
    """返回 (orient, ruler, along_a, along_b)，
    orient='V' 时 ruler=x、沿墙长度沿 Z；
    orient='H' 时 ruler=z、沿墙长度沿 X；
    orient='D' 为斜边，本户型暂忽略。
    """
    if abs(p1[0] - p2[0]) < 0.1:
        return 'V', round(p1[0], 1), p1[1], p2[1]
    if abs(p1[1] - p2[1]) < 0.1:
        return 'H', round(p1[1], 1), p1[0], p2[0]
    return 'D', 0.0, 0.0, 0.0


groups = []  # [orient, ruler, rooms, segs, along_min, along_max]
for vd_id, nm, p1, p2 in edges_by_room:
    orient, ruler, a0, a1 = classify(p1, p2)
    if orient == 'D':
        continue
    found = None
    for gi, g in enumerate(groups):
        if g[0] == orient and abs(g[1] - ruler) < 0.5:
            found = gi
            break
    if found is None:
        groups.append([orient, ruler, [(vd_id, nm)], [(p1, p2)], min(a0, a1), max(a0, a1)])
    else:
        groups[found][2].append((vd_id, nm))
        groups[found][3].append((p1, p2))
        groups[found][4] = min(groups[found][4], a0, a1)
        groups[found][5] = max(groups[found][5], a0, a1)


walls = []
for orient, ruler, rooms, segs, a0, a1 in groups:
    rs = sorted(set(r[0] for r in rooms))
    rn = sorted(set(r[1] for r in rooms))
    if orient == 'V':  # 竖直墙，ruler = X，墙段沿 Z
        walls.append({
            "id": f"DW{len(walls)+1:03d}",
            "kind": "exterior" if len(rs) == 1 else "interior",
            "axis": "v",
            "x_mm": ruler,
            "z_mm": [round(a0, 1), round(a1, 1)],
            "length_mm": round(a1 - a0, 1),
            "rooms_viewdata": rs,
            "rooms_name": rn,
        })
    else:  # 水平墙，ruler = Z，墙段沿 X
        walls.append({
            "id": f"DW{len(walls)+1:03d}",
            "kind": "exterior" if len(rs) == 1 else "interior",
            "axis": "h",
            "x_mm": [round(a0, 1), round(a1, 1)],
            "z_mm": ruler,
            "length_mm": round(a1 - a0, 1),
            "rooms_viewdata": rs,
            "rooms_name": rn,
        })


# 4) 把 21 个门窗洞吸附到最近的墙段上（容差 600 mm）
SNAP_MM = 600.0
openings = WALLS.get("openings", [])
op_on_walls = []
for o in openings:
    cx, cz = o["center"]
    candidates = []
    for w in walls:
        if w["axis"] == "h":
            dz = abs(cz - w["z_mm"])
            if dz > SNAP_MM:
                continue
            x0, x1 = w["x_mm"][0], w["x_mm"][1]
            along = max(0.0, min(1.0, (cx - x0) / (x1 - x0))) if x1 != x0 else 0
            x_proj = x0 + along * (x1 - x0)
            along_dist = abs(cx - x_proj)
            candidates.append((dz + along_dist * 0.1, dz, along_dist, w["id"]))
        else:
            dx = abs(cx - w["x_mm"])
            if dx > SNAP_MM:
                continue
            z0, z1 = w["z_mm"][0], w["z_mm"][1]
            along = max(0.0, min(1.0, (cz - z0) / (z1 - z0))) if z1 != z0 else 0
            z_proj = z0 + along * (z1 - z0)
            along_dist = abs(cz - z_proj)
            candidates.append((dx + along_dist * 0.1, dx, along_dist, w["id"]))
    candidates.sort()
    if candidates:
        attached = [candidates[0][3]]
        dist_mm = round(candidates[0][1], 1)
    else:
        attached = []
        dist_mm = None
    op_on_walls.append({**o, "attached_walls": attached, "snap_dist_mm": dist_mm})


# 5) 输出
out = {
    "schema": {
        "units": "mm",
        "scale_note": "1 GLB unit = 10mm; ViewData (X,Y) → GLB (X*10, -Y*10).",
        "generated_by": "derive_walls_from_rooms.py",
        "method": "walls = union of room-net outline segments, axis-aligned & merged. Doors/windows placed by rooms_touched + center.",
        "wall_height_mm_default": 2800,
        "exterior_wall_thickness_mm": 240,
        "interior_wall_thickness_mm": 120,
    },
    "rooms": [
        {
            "id_viewdata": vd_id,
            "name_zh": nm,
            "polygon_mm": poly_g,
            "area_m2_shoelace": round(shoelace(poly_g) / 1e6, 4),
        }
        for vd_id, nm, poly_v, poly_g in rooms_outlines
    ],
    "walls": walls,
    "openings": op_on_walls,
    "summary": {
        "n_room_polygons": len(rooms_outlines),
        "n_walls": len(walls),
        "n_openings": len(op_on_walls),
        "openings_by_type": {
            t: sum(1 for o in op_on_walls if o.get("type") == t)
            for t in set(o.get("type", "?") for o in op_on_walls)
        },
    },
}

(BASE / "walls_derived.json").write_text(json.dumps(out, ensure_ascii=False, indent=2))
print(f"wrote walls_derived.json:")
print(f"  rooms: {len(rooms_outlines)}  walls: {len(walls)}  openings: {len(op_on_walls)}")
print(f"  openings by type: {out['summary']['openings_by_type']}")
print(f"  sample wall: {walls[0] if walls else None}")
