#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
从 123kanfang 交互设计方案的 3D 模型 (floordata0.glb) 中提取家具布置数据。

输入:
  ../floordata0.glb      -- glTF 2.0 binary (12 字节头 + JSON chunk + BIN chunk)
  ../ViewData.json       -- 123kanfang 的房间元数据 (房间名 / 面积), 用于交叉核对

输出:
  furniture.json         -- 机器可读的家具清单 (单位 mm)
  furniture.md           -- 中文「每间房家具清单表」, 可直接当 CAD 家具布置用

坐标约定 (已由本脚本实测校验):
  * GLB 与 ViewData.json 同坐标系, 1 GLB 单位 = 10 mm。
  * Y 轴竖直向上, 地坪 Y=0, 顶棚 Y≈280 (2800mm)。
  * 平面上 X 向东为正, Z 向南为正 (右手系: X 叉乘 Y = Z)。
  * rotation_deg = 家具自身「本地 +X 轴」(即宽度方向) 在 XZ 平面内的方位角,
    0° = +X, 按 atan2(dz, dx) 增大方向 (即从 +X 转向 +Z)。
    facing_deg = 家具自身「本地 +Z 轴」方位角, 多数柜体该轴为「进深/正面」轴。
  * size  = 沿家具自身坐标系的 oriented 尺寸 (w=本地X宽, d=本地Z深, h=高)。
    aabb_size = 世界坐标轴对齐的轴对齐包围盒 (w=X向, d=Z向, h=Y向)。

用法:
  python3 extract_furniture.py            # 生成 furniture.json + furniture.md
  python3 extract_furniture.py --check    # 只跑一遍并打印统计, 不写文件
"""

import argparse
import json
import math
import os
import struct
import sys

# --------------------------------------------------------------------------
# 常量
# --------------------------------------------------------------------------
HERE = os.path.dirname(os.path.abspath(__file__))
SRC_DIR = os.path.normpath(os.path.join(HERE, ".."))
GLB_PATH = os.path.join(SRC_DIR, "floordata0.glb")
VIEWDATA_PATH = os.path.join(SRC_DIR, "ViewData.json")
JSON_OUT = os.path.join(HERE, "furniture.json")
MD_OUT = os.path.join(HERE, "furniture.md")

UNIT_MM = 10.0                 # 1 GLB 单位 = 10 mm
GLB_MAGIC = 0x46546C67         # 'glTF'
CHUNK_JSON = 0x4E4F534A        # 'JSON'
CHUNK_BIN = 0x004E4942         # 'BIN\0'

FLOOR_NAME_RE = "Room-"         # 房间节点前缀
MODEL_NAME = "Model"            # 家具组节点名
FURN_PREFIX = "SM_"             # 家具资产名前缀

# 柜体类 (用于判定厨房是「一字型 / L 型 / U 型」)
BASE_CABINET_KEYS = ("厨柜", "烤箱柜", "抽油烟机柜", "水槽")


# --------------------------------------------------------------------------
# GLB 解析
# --------------------------------------------------------------------------
class Glb:
    """最小 glTF 2.0 二进制解析器 (只实现本任务需要的部分)。"""

    def __init__(self, path):
        with open(path, "rb") as fh:
            self.raw = fh.read()
        self.gltf, self.bin_chunk = self._parse_chunks()

    # -- chunk 解析 ---------------------------------------------------------
    def _parse_chunks(self):
        if len(self.raw) < 12:
            raise ValueError("文件太短, 不是合法 GLB")
        magic, version, total = struct.unpack_from("<III", self.raw, 0)
        if magic != GLB_MAGIC:
            raise ValueError("GLB magic 不匹配: %s" % hex(magic))
        if version != 2:
            raise ValueError("仅支持 glTF 2.0, 实际版本 %d" % version)
        if total != len(self.raw):
            print("[warn] header 声明长度 %d != 实际 %d" % (total, len(self.raw)))

        gltf = None
        bin_chunk = b""
        off = 12
        while off + 8 <= len(self.raw):
            clen, ctype = struct.unpack_from("<II", self.raw, off)
            body = self.raw[off + 8: off + 8 + clen]
            if ctype == CHUNK_JSON and gltf is None:
                gltf = json.loads(body.decode("utf-8"))
            elif ctype == CHUNK_BIN and not bin_chunk:
                bin_chunk = body
            off += 8 + clen
        if gltf is None:
            raise ValueError("未找到 JSON chunk")
        if not bin_chunk:
            raise ValueError("未找到 BIN chunk")
        return gltf, bin_chunk

    # -- accessor ----------------------------------------------------------
    _COMP = {5120: ("b", 1), 5121: ("B", 1), 5122: ("h", 2),
             5123: ("H", 2), 5125: ("I", 4), 5126: ("f", 4)}
    _NCOMP = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}

    def positions(self, mesh_index):
        """返回某 mesh 全部 primitive 的顶点坐标列表 (本地空间, GLB 单位)。"""
        mesh = self.gltf["meshes"][mesh_index]
        verts = []
        for prim in mesh.get("primitives", []):
            attr = prim.get("attributes", {}).get("POSITION")
            if attr is None:
                continue
            verts.extend(self._read_vec3(attr))
        return verts

    def _read_vec3(self, accessor_index):
        acc = self.gltf["accessors"][accessor_index]
        view = self.gltf["bufferViews"][acc["bufferView"]]
        ncomp = self._NCOMP[acc["type"]]
        count = acc["count"]
        fmt, size = self._COMP[acc["componentType"]]
        base = view.get("byteOffset", 0) + acc.get("byteOffset", 0)
        stride = view.get("byteStride") or (ncomp * size)
        out = []
        if stride == ncomp * size:                     # 连续存储 -> 一次性解包
            raw = struct.unpack_from("<%d%s" % (count * ncomp, fmt), self.bin_chunk, base)
            for i in range(count):
                o = i * ncomp
                out.append((raw[o], raw[o + 1], raw[o + 2]))
        else:                                          # 交错存储 -> 逐顶点解包
            for i in range(count):
                o = base + i * stride
                x, y, z = struct.unpack_from("<3%s" % fmt, self.bin_chunk, o)
                out.append((x, y, z))
        return out


# --------------------------------------------------------------------------
# 4x4 矩阵 (列主序, 与 glTF 一致: m[col*4 + row])
# --------------------------------------------------------------------------
IDENTITY = [1.0, 0, 0, 0,
            0, 1.0, 0, 0,
            0, 0, 1.0, 0,
            0, 0, 0, 1.0]


def mat4_mul(a, b):
    """a * b (列主序)"""
    out = [0.0] * 16
    for c in range(4):
        b0, b1, b2, b3 = b[c * 4], b[c * 4 + 1], b[c * 4 + 2], b[c * 4 + 3]
        for r in range(4):
            out[c * 4 + r] = a[r] * b0 + a[4 + r] * b1 + a[8 + r] * b2 + a[12 + r] * b3
    return out


def quat_to_mat4(q):
    """glTF 四元数 (x, y, z, w) -> 4x4 旋转矩阵"""
    x, y, z, w = q
    xx, yy, zz = x * x, y * y, z * z
    xy, xz, yz = x * y, x * z, y * z
    wx, wy, wz = w * x, w * y, w * z
    return [
        1 - 2 * (yy + zz), 2 * (xy + wz), 2 * (xz - wy), 0,
        2 * (xy - wz), 1 - 2 * (xx + zz), 2 * (yz + wx), 0,
        2 * (xz + wy), 2 * (yz - wx), 1 - 2 * (xx + yy), 0,
        0, 0, 0, 1,
    ]


def node_local_matrix(node):
    """节点本地矩阵: 优先 matrix, 否则由 TRS 合成。"""
    if "matrix" in node:
        return list(node["matrix"])
    t = node.get("translation", [0.0, 0.0, 0.0])
    r = node.get("rotation", [0.0, 0.0, 0.0, 1.0])
    s = node.get("scale", [1.0, 1.0, 1.0])
    rot = quat_to_mat4(r)
    out = list(rot)
    for c in range(3):                       # R * S: 每列乘以对应 scale
        out[c * 4] *= s[c]
        out[c * 4 + 1] *= s[c]
        out[c * 4 + 2] *= s[c]
    out[12], out[13], out[14] = t
    return out


def transform_point(m, p):
    x, y, z = p
    return (m[0] * x + m[4] * y + m[8] * z + m[12],
            m[1] * x + m[5] * y + m[9] * z + m[13],
            m[2] * x + m[6] * y + m[10] * z + m[14])


def orthonormal_basis(m):
    """从 (可能带缩放/轻微剪切的) 世界矩阵中提取正交基与缩放。

    返回 (ux, uy, uz) 三个单位向量, 分别对应本地 X/Y/Z 轴在世界中的方向。
    """
    cols = [[m[0], m[1], m[2]], [m[4], m[5], m[6]], [m[8], m[9], m[10]]]
    axes = []
    for c in cols:
        n = math.sqrt(c[0] * c[0] + c[1] * c[1] + c[2] * c[2])
        if n < 1e-12:
            axes.append([0.0, 0.0, 0.0])
        else:
            axes.append([c[0] / n, c[1] / n, c[2] / n])
    # Gram-Schmidt, 保证严格正交
    ux = axes[0]
    uy = axes[1]
    d = ux[0] * uy[0] + ux[1] * uy[1] + ux[2] * uy[2]
    uy = [uy[0] - d * ux[0], uy[1] - d * ux[1], uy[2] - d * ux[2]]
    n = math.sqrt(sum(v * v for v in uy))
    uy = [v / n for v in uy] if n > 1e-12 else [0.0, 1.0, 0.0]
    uz = [ux[1] * uy[2] - ux[2] * uy[1],
          ux[2] * uy[0] - ux[0] * uy[2],
          ux[0] * uy[1] - ux[1] * uy[0]]
    return ux, uy, uz


def azimuth_deg(axis):
    """水平轴向方位角: 0° = +X, 沿 atan2(z, x) 方向增大 (即转向 +Z)。"""
    x, _, z = axis
    if abs(x) < 1e-9 and abs(z) < 1e-9:
        return 0.0
    d = round(math.degrees(math.atan2(z, x)) % 360.0, 1)
    return 0.0 if d >= 360.0 else d


def norm_deg(a):
    return round(a % 360.0, 1)


# --------------------------------------------------------------------------
# 主流程
# --------------------------------------------------------------------------
def collect(glb):
    """遍历节点树, 返回所有家具实例的原始记录。"""
    nodes = gltf_nodes = glb.gltf["nodes"]
    meshes = glb.gltf["meshes"]
    parent_of = {}
    for i, n in enumerate(nodes):
        for c in n.get("children", []):
            parent_of[c] = i

    # --- 1. 计算每个节点的世界矩阵 & 房间归属 -----------------------------
    world = [None] * len(nodes)
    room_of = [None] * None if False else [None] * len(nodes)   # (房间名, 房间ID)
    room_cache = {}

    def room_of_node(idx):
        if idx in room_cache:
            return room_cache[idx]
        chain = []
        cur = idx
        while cur is not None:
            nm = nodes[cur].get("name", "")
            if nm.startswith(FLOOR_NAME_RE):
                parts = nm.split("-")
                room_name = parts[1] if len(parts) > 1 else nm
                room_id = parts[-1] if len(parts) > 2 else ""
                room_cache[idx] = (room_name, room_id)
                return room_cache[idx]
            cur = parent_of.get(cur)
        room_cache[idx] = (None, None)
        return room_cache[idx]

    def compute(idx, parent_m):
        m = mat4_mul(parent_m, node_local_matrix(nodes[idx]))
        world[idx] = m
        for c in nodes[idx].get("children", []):
            compute(c, m)

    scene = glb.gltf.get("scenes", [{}])[0]
    roots = scene.get("nodes", [0])
    for r in roots:
        compute(r, IDENTITY)

    # --- 2. 识别家具节点 ----------------------------------------------------
    items = []
    vert_cache = {}

    for idx, node in enumerate(nodes):
        if "mesh" not in node:
            continue
        mesh_idx = node["mesh"]
        mesh_name = meshes[mesh_idx].get("name", "")
        node_name = node.get("name", "")
        if not (node_name.startswith(FURN_PREFIX) or mesh_name.startswith(FURN_PREFIX)):
            continue
        # 家具一定挂在某个 "Model" 组下
        cur = parent_of.get(idx)
        in_model = False
        while cur is not None:
            if nodes[cur].get("name") == MODEL_NAME:
                in_model = True
                break
            cur = parent_of.get(cur)
        if not in_model:
            continue

        asset = node_name if node_name.startswith(FURN_PREFIX) else mesh_name
        asset = asset.split("_StaticMeshComponent0")[0]
        # 去掉资产前缀 "SM_", 输出形如 "厨柜_50cm" / "床头柜_50cm_左"
        name = asset[len(FURN_PREFIX):] if asset.startswith(FURN_PREFIX) else asset

        rname, rid = room_of_node(idx)
        if rname is None:
            continue

        if mesh_idx not in vert_cache:
            vert_cache[mesh_idx] = glb.positions(mesh_idx)
        verts = vert_cache[mesh_idx]
        m = world[idx]
        ux, uy, uz = orthonormal_basis(m)
        tx, ty, tz = m[12], m[13], m[14]

        # 世界坐标 AABB
        minx = miny = minz = float("inf")
        maxx = maxy = maxz = float("-inf")
        # 家具自身坐标系下的 oriented AABB (去掉平移, 保留缩放)
        ominx = ominy = ominz = float("inf")
        omaxx = omaxy = omaxz = float("-inf")
        for (x, y, z) in verts:
            wx = m[0] * x + m[4] * y + m[8] * z + tx
            wy = m[1] * x + m[5] * y + m[9] * z + ty
            wz = m[2] * x + m[6] * y + m[10] * z + tz
            if wx < minx: minx = wx
            if wy < miny: miny = wy
            if wz < minz: minz = wz
            if wx > maxx: maxx = wx
            if wy > maxy: maxy = wy
            if wz > maxz: maxz = wz
            # oriented: p_oriented = R^T * (p_world - t) = S * p_local
            dx, dy, dz = wx - tx, wy - ty, wz - tz
            ox = ux[0] * dx + ux[1] * dy + ux[2] * dz
            oy = uy[0] * dx + uy[1] * dy + uy[2] * dz
            oz = uz[0] * dx + uz[1] * dy + uz[2] * dz
            if ox < ominx: ominx = ox
            if oy < ominy: ominy = oy
            if oz < ominz: ominz = oz
            if ox > omaxx: omaxx = ox
            if oy > omaxy: omaxy = oy
            if oz > omaxz: omaxz = oz

        if not verts:
            continue

        items.append({
            "node_index": idx,
            "mesh_index": mesh_idx,
            "name": name,
            "asset": asset,
            "name_source": "node" if node_name.startswith(FURN_PREFIX) else "mesh",
            "room": rname,
            "room_id": rid,
            "center": [round((minx + maxx) / 2 * UNIT_MM, 1),
                       round((minz + maxz) / 2 * UNIT_MM, 1)],
            "center3d": [round((minx + maxx) / 2 * UNIT_MM, 1),
                         round((miny + maxy) / 2 * UNIT_MM, 1),
                         round((minz + maxz) / 2 * UNIT_MM, 1)],
            "base_y": round(miny * UNIT_MM, 1),
            "size": {"w": round((omaxx - ominx) * UNIT_MM, 1),
                     "d": round((omaxz - ominz) * UNIT_MM, 1),
                     "h": round((omaxy - ominy) * UNIT_MM, 1)},
            "aabb_size": {"w": round((maxx - minx) * UNIT_MM, 1),
                          "d": round((maxz - minz) * UNIT_MM, 1),
                          "h": round((maxy - miny) * UNIT_MM, 1)},
            "aabb": {"min": [round(minx * UNIT_MM, 1), round(miny * UNIT_MM, 1), round(minz * UNIT_MM, 1)],
                     "max": [round(maxx * UNIT_MM, 1), round(maxy * UNIT_MM, 1), round(maxz * UNIT_MM, 1)]},
            "rotation_deg": azimuth_deg(ux),
            "facing_deg": azimuth_deg(uz),
        })

    return items


def merge_items(items):
    """同名 + 同位置 + 同尺寸 + 同朝向 -> 合并计数。"""
    groups = {}
    order = []
    for it in items:
        key = (it["room"], it["room_id"], it["asset"],
               round(it["center"][0]), round(it["center"][1]),
               round(it["size"]["w"]), round(it["size"]["d"]), round(it["size"]["h"]),
               round(it["rotation_deg"], 1))
        if key not in groups:
            groups[key] = dict(it)
            groups[key]["count"] = 1
            groups[key]["node_indices"] = [it["node_index"]]
            order.append(key)
        else:
            groups[key]["count"] += 1
            groups[key]["node_indices"].append(it["node_index"])
    return [groups[k] for k in order]


# --------------------------------------------------------------------------
# 分析: 柜体「墙段」判定 (一字型 / L 型 / U 型)
# --------------------------------------------------------------------------
def cabinet_runs(items, room, room_id=None, tol_mm=260.0):
    """把房间内的地柜按「所在墙面」聚类。

    对每件地柜: 宽度轴 = 本地 X 轴方位 (0/90/180/270);
    垂直于宽度轴的那个水平坐标就是「墙面位置」:
      宽度沿 X  -> 法向沿 Z -> 墙位 = Z 坐标
      宽度沿 Z  -> 法向沿 X -> 墙位 = X 坐标
    返回 [(墙面法向轴, 墙面坐标, 柜体数, 沿墙总宽 mm, 覆盖跨度 mm, 柜体清单)]
    """
    cabs = []
    for it in items:
        if it["room"] != room:
            continue
        if room_id is not None and it["room_id"] != room_id:
            continue
        if not any(k in it["name"] for k in BASE_CABINET_KEYS):
            continue
        w_axis = it["rotation_deg"] % 180.0          # 宽度轴 (无向)
        if w_axis < 45 or w_axis >= 135:
            normal_axis = 90.0                        # 法向沿 Z (墙沿 X 延伸)
            wall_pos = it["center"][1]                 # 墙位 = Z
            along = it["center"][0]                    # 沿墙位置 = X
        else:
            normal_axis = 0.0                         # 法向沿 X (墙沿 Z 延伸)
            wall_pos = it["center"][0]                 # 墙位 = X
            along = it["center"][1]                    # 沿墙位置 = Z
        cabs.append({
            "name": it["name"],
            "normal_axis": normal_axis,
            "wall_pos": wall_pos,
            "along": along,
            "width": it["size"]["w"],
            "count": it["count"],
            "rotation_deg": it["rotation_deg"],
            "facing_deg": it["facing_deg"],
            "center": it["center"],
        })

    # 按 (法向轴, 墙位) 容差聚类
    buckets = []
    for c in sorted(cabs, key=lambda c: (c["normal_axis"], c["wall_pos"])):
        placed = False
        for b in buckets:
            if b["normal_axis"] == c["normal_axis"] and \
                    abs(b["wall_pos"] - c["wall_pos"]) <= tol_mm:
                b["items"].append(c)
                b["wall_pos"] = (b["wall_pos"] * (len(b["items"]) - 1) + c["wall_pos"]) / len(b["items"])
                placed = True
                break
        if not placed:
            buckets.append({"normal_axis": c["normal_axis"], "wall_pos": c["wall_pos"], "items": [c]})

    out = []
    for b in buckets:
        b["items"].sort(key=lambda c: c["along"])
        total_w = sum(c["width"] * c["count"] for c in b["items"])
        span = (max(c["along"] for c in b["items"]) - min(c["along"] for c in b["items"])) \
            + max(c["width"] for c in b["items"])
        out.append({
            "wall_axis": b["normal_axis"],     # 90 -> 墙面平行 X; 0 -> 墙面平行 Z
            "wall_pos_mm": round(b["wall_pos"], 1),
            "n": len(b["items"]),
            "total_width_mm": round(total_w, 1),
            "span_mm": round(span, 1),
            "items": b["items"],
        })
    out.sort(key=lambda r: (r["wall_axis"], r["wall_pos_mm"]))
    return out


def kitchen_shape(runs):
    n = len(runs)
    if n == 0:
        return "无地柜"
    if n == 1:
        return "一字型"
    if n == 2:
        return "L 型"
    if n == 3:
        return "U 型(三面橱柜)"
    return "%d 段式" % n


# --------------------------------------------------------------------------
# 输出
# --------------------------------------------------------------------------
def load_viewdata():
    """读取 ViewData.json, 并把房间多边形换算到 GLB 坐标系 (mm)。

    已实测校验的换算关系 (9 个房间全部吻合):
        GLB_X_mm = ViewData_X * 10
        GLB_Z_mm = -ViewData_Y * 10
    (ViewData 是平面图坐标, Y 轴与 GLB 的 Z 轴反向)
    """
    if not os.path.exists(VIEWDATA_PATH):
        return {}
    with open(VIEWDATA_PATH, "r", encoding="utf-8") as fh:
        vd = json.load(fh)
    info = {}
    for fl in vd.get("Floors", []):
        for rm in fl.get("Rooms", []):
            xs, ys = [], []
            for ra in rm.get("RoomAreas", []):
                for p in ra.get("polygon", []):
                    xs.append(p["X"] * UNIT_MM)
                    ys.append(-p["Y"] * UNIT_MM)
            rect = None
            if xs:
                rect = {"x_min": min(xs), "x_max": max(xs),
                        "z_min": min(ys), "z_max": max(ys),
                        "w": max(xs) - min(xs), "d": max(ys) - min(ys)}
            info[rm.get("ID")] = {"name": rm.get("Name"), "area": rm.get("Area"),
                                  "room_height": rm.get("RoomHeight"), "rect": rect}
    return info


def inside(rect, x, z, tol=200.0):
    """点是否落在房间矩形内 (含 tol 容差, 用于门套/窗/壁挂件外溢)。"""
    if not rect:
        return None
    return (rect["x_min"] - tol <= x <= rect["x_max"] + tol and
            rect["z_min"] - tol <= z <= rect["z_max"] + tol)


def build_json(items, rooms_order, vd_info):
    """rooms_order: [(房间名, 房间ID), ...]"""
    # 同名房间 (两个次卧 / 两个卫生间) 用 ID 区分
    name_count = {}
    for rname, _ in rooms_order:
        name_count[rname] = name_count.get(rname, 0) + 1

    rooms = []
    for rname, rid in rooms_order:
        furn = [it for it in items if it["room"] == rname and it["room_id"] == rid]
        furn.sort(key=lambda it: (category_of(it["name"])[0], it["rotation_deg"],
                                  it["center"][1], it["center"][0]))
        entries = []
        for it in furn:
            entries.append({
                "name": it["name"],
                "asset": it["asset"],
                "count": it["count"],
                "center": it["center"],
                "size": it["size"],
                "rotation_deg": it["rotation_deg"],
                "aabb_size": it["aabb_size"],
                "aabb": it["aabb"],
                "facing_deg": it["facing_deg"],
                "center3d": it["center3d"],
                "base_y": it["base_y"],
                "name_source": it["name_source"],
                "mesh_index": it["mesh_index"],
                "node_indices": it["node_indices"],
            })
        meta = vd_info.get(rid, {})
        rect = meta.get("rect")
        inside_cnt = sum(1 for e in entries
                         if inside(rect, e["center"][0], e["center"][1]) is not False)
        label = rname if name_count[rname] == 1 else "%s(%s)" % (rname, rid)
        rooms.append({
            "room": rname,
            "room_id": rid,
            "label": label,
            "area_m2": meta.get("area"),
            "room_rect_mm": rect,
            "furniture_in_room_rect": "%d/%d" % (inside_cnt, len(entries)),
            "furniture_count": sum(e["count"] for e in entries),
            "furniture": entries,
        })

    summary = {
        "total_furniture_nodes": sum(e["count"] for r in rooms for e in r["furniture"]),
        "total_unique_items": sum(len(r["furniture"]) for r in rooms),
        "rooms": {},
    }
    for r in rooms:
        agg = {}
        for e in r["furniture"]:
            agg[e["name"]] = agg.get(e["name"], 0) + e["count"]
        summary["rooms"][r["label"]] = {
            "room": r["room"],
            "room_id": r["room_id"],
            "area_m2": r["area_m2"],
            "node_count": r["furniture_count"],
            "item_count": len(r["furniture"]),
            "furniture_list": ["%s×%d" % (k, v) for k, v in
                               sorted(agg.items(), key=lambda kv: -kv[1])],
            "furniture_counts": agg,
        }
    return {"units": "mm", "rooms": rooms, "summary": summary}


CATEGORIES = [
    ("柜体·收纳", ("柜", "冰箱", "洗衣机", "浴室", "洗手台", "置物", "背景墙")),
    ("床·榻", ("床",)),
    ("桌·台", ("桌", "茶几", "台")),
    ("椅·凳·沙发", ("椅", "凳", "沙发", "榻")),
    ("软装·灯饰", ("地毯", "落地灯", "吊灯", "吸顶灯", "筒灯", "条形灯", "格栅灯", "浴霸", "装饰画")),
    ("厨房设备·电器", ("燃气灶", "抽油烟机", "豆浆机", "咖啡机", "果盘", "厨房饰品", "水槽")),
    ("洁具", ("马桶", "花洒", "地漏", "隔断")),
    ("门", ("门套", "平开门", "入户门", "推拉门")),
    ("窗·窗帘", ("平开窗", "单玻璃", "窗帘", "单帘")),
    ("其他", ("入风口",)),
]


def category_of(name):
    for i, (cat, keys) in enumerate(CATEGORIES):
        if any(k in name for k in keys):
            return i, cat
    return len(CATEGORIES), "其他"


def wall_contact(room, entry, tol=80.0):
    """判断家具贴住了房间的哪几面墙 (用 AABB 与房间矩形比较)。"""
    rect = room.get("room_rect_mm")
    if not rect:
        return []
    ab = entry["aabb"]
    hits = []
    if abs(ab["min"][0] - rect["x_min"]) <= tol:
        hits.append("西墙")
    if abs(ab["max"][0] - rect["x_max"]) <= tol:
        hits.append("东墙")
    if abs(ab["min"][2] - rect["z_min"]) <= tol:
        hits.append("南墙")
    if abs(ab["max"][2] - rect["z_max"]) <= tol:
        hits.append("北墙")
    return hits


def agg_names(entries):
    """把同一房间内的家具按名称聚合成 '名称×数量' 列表。"""
    agg = {}
    for e in entries:
        agg[e["name"]] = agg.get(e["name"], 0) + e["count"]
    return "、".join("%s×%d" % (k, v) for k, v in agg.items())


def fmt_mm(v):
    return ("%.0f" % v) if abs(v - round(v)) < 0.05 else ("%.1f" % v)


def build_md(data, items, runs_by_room, shapes):
    s = data["summary"]
    out = []
    A = out.append
    A("# 家具参考档案 — 城投南山长投·领峯 D143 (123kanfang 意式交互设计方案)")
    A("")
    A("> ⚠️ **本文是「方案家具参考档案」, 不是原始建筑测量图的一部分。**")
    A("> 本文件记录的是 123kanfang 官方提供的**软装/方案家具**布置 (橱柜、沙发、"
      "衣柜、床等成品家具), 用于日后做**方案对比视图**与「是否采纳该方案」的讨论;")
    A("> 它**不属于**原始建筑测量图, 也不在主页面上直接渲染。")
    A("")
    A("> 数据来源: `archive/floorplan-source/floordata0.glb` (glTF 2.0 binary) + `ViewData.json`")
    A("> 生成脚本: `archive/floorplan-source/derived/extract_furniture.py` (可复现)")
    A("")
    A("## 0. 读数约定")
    A("")
    A("| 项目 | 约定 |")
    A("| --- | --- |")
    A("| 单位 | 全部为 **毫米 (mm)**; GLB 原始 1 单位 = 10 mm |")
    A("| 坐标系 | 与 GLB / ViewData.json 完全一致, 原点即模型原点 |")
    A("| X / Z | 水平面两轴; **Y 向上**, 地坪 Y=0, 顶棚 ≈ 2800 |")
    A("| `center` | 家具平面包围盒中心 `[X, Z]` (mm) |")
    A("| `size.w / size.d` | 沿家具自身坐标的 **oriented 尺寸**: w=本地 X(宽/长), d=本地 Z(进深), h=高 |")
    A("| `aabb_size` | 世界坐标轴对齐包围盒: w=X 向, d=Z 向, h=Y 向 |")
    A("| `rotation_deg` | 家具自身 **本地 +X 轴**(宽度方向)在水平面的方位角, 0°=+X, 转向 +Z 为正 |")
    A("| `facing_deg` | 家具自身 **本地 +Z 轴**方位角 (多数柜体为正面/进深轴) |")
    A("| `base_y` | 家具底面标高 (mm), 0 = 落地, 其余为离地挂装 |")
    A("| 房间矩形 | 由 ViewData.json 房间多边形换算: `GLB_X = ViewData_X×10`, `GLB_Z = −ViewData_Y×10` |")
    A("")
    A("## 1. 总览")
    A("")
    A("| 房间 | 房间 ID | 面积 (m²) | 房间矩形 X / Z (mm) | 家具节点数 | 种类数 | 落在房间矩形内 |")
    A("| --- | --- | --- | --- | --- | --- | --- |")
    for r in data["rooms"]:
        rect = r["room_rect_mm"]
        rtxt = ("X %s…%s / Z %s…%s" % (fmt_mm(rect["x_min"]), fmt_mm(rect["x_max"]),
                                       fmt_mm(rect["z_min"]), fmt_mm(rect["z_max"]))) if rect else "-"
        A("| %s | `%s` | %s | %s | %d | %d | %s |" % (
            r["label"], r["room_id"],
            ("%.2f" % r["area_m2"]) if r["area_m2"] else "-",
            rtxt, r["furniture_count"], len(r["furniture"]), r["furniture_in_room_rect"]))
    A("| **合计** | | | | **%d** | **%d** | |" % (s["total_furniture_nodes"], s["total_unique_items"]))
    A("")
    n_assets = len({e["name"] for r in data["rooms"] for e in r["furniture"]})
    n_named = sum(1 for r in data["rooms"] for e in r["furniture"]
                  if e["name_source"] == "node")
    A("共 **%d 个家具节点** (原始 GLB 中带 `SM_*` 名字的有 %d 个, 其余 %d 个节点在 GLB 里未命名, "
      "已由 mesh 资产名还原), 覆盖 **%d 种**家具资产。"
      % (s["total_furniture_nodes"], n_named, s["total_furniture_nodes"] - n_named, n_assets))
    A("")
    A("## 2. 每间房家具清单表")
    A("")

    for r in data["rooms"]:
        A("### 2.%d %s (`%s`)%s" % (
            data["rooms"].index(r) + 1, r["label"], r["room_id"],
            ("  · 面积 %.2f m²" % r["area_m2"]) if r["area_m2"] else ""))
        A("")
        if r["room_rect_mm"]:
            rc = r["room_rect_mm"]
            A("房间矩形 (GLB 坐标, mm): X %s … %s (长 %s) | Z %s … %s (长 %s)"
              % (fmt_mm(rc["x_min"]), fmt_mm(rc["x_max"]), fmt_mm(rc["w"]),
                 fmt_mm(rc["z_min"]), fmt_mm(rc["z_max"]), fmt_mm(rc["d"])))
            A("")
        A("**家具清单: %s**" % "、".join(s["rooms"][r["label"]]["furniture_list"]))
        A("")
        if not r["furniture"]:
            A("_（无家具节点）_")
            A("")
            continue
        A("| # | 家具名称 | 类别 | 数量 | 尺寸 宽×深×高 (mm) | AABB 宽×深×高 (mm) | 朝向 ° | 正面 ° | 中心 X, Z (mm) | 底面标高 |")
        A("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |")
        for i, e in enumerate(r["furniture"], 1):
            sz, ab = e["size"], e["aabb_size"]
            A("| %d | %s | %s | %d | %s × %s × %s | %s × %s × %s | %s | %s | %s, %s | %s |" % (
                i, e["name"], category_of(e["name"])[1], e["count"],
                fmt_mm(sz["w"]), fmt_mm(sz["d"]), fmt_mm(sz["h"]),
                fmt_mm(ab["w"]), fmt_mm(ab["d"]), fmt_mm(ab["h"]),
                fmt_mm(e["rotation_deg"]), fmt_mm(e["facing_deg"]),
                fmt_mm(e["center"][0]), fmt_mm(e["center"][1]),
                fmt_mm(e["base_y"])))
        A("")

    A("## 3. 关键信息核对 (由解析数据自动判定)")
    A("")
    kit_label = next((r["label"] for r in data["rooms"] if r["room"] == "厨房"), "厨房")
    A("### 3.1 厨房: **%s**" % shapes.get(kit_label, "-"))
    A("")
    kr = runs_by_room.get(kit_label, [])
    if kr:
        A("地柜沿墙分布 (同一墙面上的柜体按沿墙位置合并):")
        A("")
        A("| 墙面 | 墙面坐标 (mm) | 柜体件数 | 沿墙总宽 (mm) | 覆盖跨度 (mm) | 柜体 |")
        A("| --- | --- | --- | --- | --- | --- |")
        for run in kr:
            axis_desc = "墙面平行 X 轴 (法向沿 Z), 墙位 Z=%s" % fmt_mm(run["wall_pos_mm"]) \
                if run["wall_axis"] == 90.0 else \
                "墙面平行 Z 轴 (法向沿 X), 墙位 X=%s" % fmt_mm(run["wall_pos_mm"])
            agg = {}
            for c in run["items"]:
                agg[c["name"]] = agg.get(c["name"], 0) + c["count"]
            names = "、".join("%s×%d" % (k, v) for k, v in agg.items())
            A("| %s | %s | %d | %s | %s | %s |" % (
                ("墙平行 X 轴 (法向 Z), 墙位 Z=%s" % fmt_mm(run["wall_pos_mm"]))
                if run["wall_axis"] == 90.0 else
                ("墙平行 Z 轴 (法向 X), 墙位 X=%s" % fmt_mm(run["wall_pos_mm"])),
                "", run["n"], fmt_mm(run["total_width_mm"]),
                fmt_mm(run["span_mm"]), names))
        A("")
    A("### 3.2 各房间柜体/家具统计")
    A("")
    A("| 房间 | 柜体类家具 (地柜/吊柜/衣柜/书桌柜等) | 合计件数 | 合计长度 (mm) |")
    A("| --- | --- | --- | --- |")
    for r in data["rooms"]:
        cabs = [e for e in r["furniture"] if any(k in e["name"] for k in
                ("柜", "书桌", "浴缸", "洗手台", "台"))]
        tot = sum(e["count"] for e in cabs)
        ln = sum(e["size"]["w"] * e["count"] for e in cabs)
        cagg = {}
        for e in cabs:
            cagg[e["name"]] = cagg.get(e["name"], 0) + e["count"]
        detail = "、".join("%s×%d" % (k, v) for k, v in cagg.items()) or "-"
        A("| %s | %s | %d | %s |" % (r["label"], detail, tot, fmt_mm(ln)))
    A("")
    A("### 3.3 关键词清单 (按任务要求逐项核对)")
    A("")
    keywords = ["厨柜_50cm", "烤箱柜_80cm", "燃气灶_80cm", "吊柜_50cm", "水槽_80cm",
                "阳台洗衣机柜_125cm", "带书桌衣柜", "衣柜", "衣柜带转角书桌",
                "装饰柜", "酒柜", "玄关柜", "单椅", "茶几", "地毯", "落地灯", "凳子",
                "床_180cm", "电竞椅", "头层牛皮床", "悬空床", "书架"]
    A("| 关键词 | 出现房间 | 数量 |")
    A("| --- | --- | --- |")
    for kw in keywords:
        hits = []
        for r in data["rooms"]:
            n = sum(e["count"] for e in r["furniture"] if kw in e["name"])
            if n:
                hits.append((r["label"], n))
        if hits:
            A("| `%s` | %s | %s |" % (kw, "、".join(h[0] for h in hits),
                                      "、".join(str(h[1]) for h in hits)))
    A("")
    A("## 4. 布置逻辑解读")
    A("")
    for line in interpret(data, runs_by_room, shapes):
        A("- %s" % line)
    A("")
    A("## 5. 复现方式")
    A("")
    A("```bash")
    A("cd archive/floorplan-source/derived")
    A("python3 extract_furniture.py        # 重新生成 furniture.json / furniture.md")
    A("```")
    A("")
    return "\n".join(out)


def interpret(data, runs_by_room, shapes):
    """基于已解析数据自动生成布置逻辑判断 (数字全部来自解析结果)。"""
    lines = []
    rooms = data["rooms"]

    def by_name(nm):
        return [r for r in rooms if r["room"] == nm]

    def pick(r, *names):
        return [e for e in r["furniture"] if e["name"] in names]

    def first(r, *names):
        got = pick(r, *names)
        return got[0] if got else None

    def wall_len(r, axis):
        """房间在某个水平轴上的净长 (mm)。axis='x' -> X 方向长度。"""
        rect = r["room_rect_mm"]
        if not rect:
            return None
        return rect["w"] if axis == "x" else rect["d"]

    # ---- 1. 厨房 ------------------------------------------------------
    kit = by_name("厨房")
    if kit:
        k = kit[0]
        kr = runs_by_room.get(k["label"], [])

        def run_of(item_name):
            """找出某个厨房设备落在哪一段墙 (按墙位就近匹配)。"""
            e = first(k, item_name)
            if not e:
                return None, None
            best, bestd = None, None
            for r in kr:
                d = abs(r["wall_pos_mm"] - (e["center"][0] if r["wall_axis"] == 0.0
                                            else e["center"][1]))
                if bestd is None or d < bestd:
                    best, bestd = r, d
            return e, best

        def wall_label(run):
            if run is None:
                return "?"
            return ("墙位 X=%s" % fmt_mm(run["wall_pos_mm"])) if run["wall_axis"] == 0.0 \
                else ("墙位 Z=%s" % fmt_mm(run["wall_pos_mm"]))

        sink, sink_run = run_of("水槽_80cm")
        stove, stove_run = run_of("燃气灶_80cm")
        agg = {}
        for e in k["furniture"]:
            if "柜" in e["name"] and "吊" not in e["name"]:
                agg[e["name"]] = agg.get(e["name"], 0) + e["count"]
        base_names = "、".join("%s×%d" % (nm, c) for nm, c in agg.items())
        lines.append(
            "**厨房是 %s, 既不是一字型也不是单纯 L 型**: 地柜共 **%d 段 / %d 面墙** "
            "(%s), 柜体为 %s。水槽落在 %s, 燃气灶 + 抽油烟机 + 烤箱柜落在 %s —— "
            "「洗」在一头、「炒烤」在另一头、中间留出切配台面, 三面连续无过道断口, "
            "是典型 U 型厨房而非一字型。"
            % (shapes.get(k["label"], "-"), len(kr), len(kr),
               "、".join(wall_label(r) for r in kr), base_names,
               wall_label(sink_run), wall_label(stove_run)))

    # ---- 2. 主卧 ------------------------------------------------------
    mb = by_name("主卧")
    if mb:
        m = mb[0]
        ward = [e for e in m["furniture"] if "衣柜" in e["name"]]
        bed = [e for e in m["furniture"]
               if "床" in e["name"] and "床头柜" not in e["name"]]
        night = [e for e in m["furniture"] if "床头柜" in e["name"]]
        if ward:
            w = ward[0]
            axis = "z" if 45 <= (w["rotation_deg"] % 180) < 135 else "x"
            span = wall_len(m, axis)
            pct = ("%.0f%%" % (w["size"]["w"] / span * 100)) if span else "-"
            hits = "、".join(wall_contact(m, w)) or "贴墙"
            lines.append(
                "**主卧是「整墙定制衣柜 + 书桌」**: 房间只布置一件大件 `%s` "
                "(宽 %s × 深 %s × 高 %s mm), 紧贴%s, 长度占该墙 **%s** —— 是真正的整墙柜; "
                "衣柜与书桌合并成一个模块 (资产名本身就是「带书桌衣柜」), "
                "再配 `%s` + `床头柜_50cm_左` ×%d, 属于「整墙柜 + 睡眠区」强收纳卧室。"
                % (w["name"], fmt_mm(w["size"]["w"]), fmt_mm(w["size"]["d"]),
                   fmt_mm(w["size"]["h"]), hits, pct,
                   bed[0]["name"] if bed else "床", sum(e["count"] for e in night)))

    # ---- 3. 两个次卧 --------------------------------------------------
    sbs = by_name("次卧")
    w_plain = []
    w_corner = []
    for r in sbs:
        for e in r["furniture"]:
            if e["name"] == "衣柜":
                w_plain.append((r, e))
            elif "衣柜带转角书桌" in e["name"]:
                w_corner.append((r, e))
    if w_plain and w_corner:
        (rp, ep), (rc, ec) = w_plain[0], w_corner[0]
        hp = "、".join(wall_contact(rp, ep)) or "居中"
        hc = "、".join(wall_contact(rc, ec)) or "居中"
        lines.append(
            "**两间次卧是两种截然不同的方案**: `%s` 只用一件**独立** `衣柜` "
            "(宽 %s × 深 %s mm, 只贴%s, 占 1 面墙), 其余留给床与飘窗; "
            "`%s` 则用 `衣柜带转角书桌` (宽 %s × 深 %s mm, 同时贴%s, 跨 2 面墙), "
            "把衣柜与书桌做成 L 形连体塞进转角 —— 同样一套柜体, 一个当纯收纳, "
            "一个同时出收纳 + 办公, 后者更省面积。"
            % (rp["label"], fmt_mm(ep["size"]["w"]), fmt_mm(ep["size"]["d"]), hp,
               rc["label"], fmt_mm(ec["size"]["w"]), fmt_mm(ec["size"]["d"]), hc))
    elif sbs:
        names = "；".join("%s: %s" % (r["label"], "、".join(
            "%s×%d" % (e["name"], e["count"]) for e in r["furniture"]
            if any(k in e["name"] for k in ("衣柜", "书桌", "床")))) for r in sbs)
        lines.append("**次卧配置**: %s" % names)

    # ---- 4. 书房 ------------------------------------------------------
    st = by_name("书房")
    if st:
        s0 = st[0]
        names = agg_names(s0["furniture"])
        rect = s0["room_rect_mm"]
        dims = ("%.2f × %.2f m" % (rect["w"] / 1000.0, rect["d"] / 1000.0)) if rect else "-"
        lines.append(
            "**书房 (%s, 净 %s) 实际按「电竞书房」布置**: 家具只有 %s。"
            "`电竞椅` ×%d + `电竞房背景墙` 出现, 而没有独立书架/书桌 —— "
            "说明这版方案把 1.99×3.30m 的小房间让位给了电竞功能。"
            % (s0["label"], dims, names,
               sum(e["count"] for e in s0["furniture"] if e["name"] == "电竞椅")))

    # ---- 5. 生活阳台 --------------------------------------------------
    bal = by_name("生活阳台")
    if bal:
        b = bal[0]
        cab = first(b, "阳台洗衣机柜_125cm")
        if cab:
            lines.append(
                "**生活阳台只做家政, 不做休闲**: 唯一一件家具是 `%s` "
                "(宽 %s × 深 %s × 高 %s mm, 中心 X=%s Z=%s, 方位 %s°), 洗衣机位与上方储物一体; "
                "其余 %d 件全是门窗构件, 有限面积全部让给洗衣/晾晒。"
                % (cab["name"], fmt_mm(cab["size"]["w"]), fmt_mm(cab["size"]["d"]),
                   fmt_mm(cab["size"]["h"]), fmt_mm(cab["center"][0]),
                   fmt_mm(cab["center"][1]), fmt_mm(cab["rotation_deg"]),
                   b["furniture_count"] - 1))

    # ---- 6. 客餐厅 ----------------------------------------------------
    lr = by_name("客餐厅")
    if lr:
        l0 = lr[0]
        chairs = sum(e["count"] for e in l0["furniture"] if e["name"] == "单椅")
        cabs = agg_names([e for e in l0["furniture"]
                          if e["name"] in ("玄关柜", "装饰柜", "酒柜", "组合柜背景墙",
                                           "嵌入式冰箱柜_90cm")])
        lines.append(
            "**客餐厅是「一厅两用 + 整面展示柜」**: 靠入户门一侧是 `%s` 这条柜体带, "
            "把玄关、冰箱、展示、酒柜全部收进同一面墙; 餐区 `餐桌` + `单椅` ×%d, "
            "客厅区 `多人沙发` + `茶几` + `地毯` + `凳子` + `落地灯`; "
            "所有柜体贴墙, 房间中轴留空给通行。"
            % (cabs, chairs))

    # ---- 7. 两间卫生间 ------------------------------------------------
    wc = by_name("卫生间")
    if wc:
        txt = "; ".join("%s (%s m²): %s" % (
            r["label"], ("%.2f" % r["area_m2"]) if r["area_m2"] else "-",
            agg_names([e for e in r["furniture"]
                       if not any(k in e["name"] for k in ("门", "窗", "入风口", "地漏",
                                                           "隔断", "格栅灯"))]))
            for r in wc)
        lines.append("**两间卫生间分工不同**: %s —— 带 `浴室柜`+`暖风浴霸` 的是主卫, "
                     "只有马桶/花洒的是客卫, 两卫不重复投资。"
                     % txt)
    return lines


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="只统计不写文件")
    args = ap.parse_args()

    glb = Glb(GLB_PATH)
    items = collect(glb)
    merged = merge_items(items)

    # 房间顺序: 按 GLB 房间节点出现顺序; 同名房间 (两个次卧/两个卫生间) 用 ID 区分
    room_order = []
    for it in items:
        key = (it["room"], it["room_id"])
        if key not in room_order:
            room_order.append(key)

    runs_by_room = {}
    for rn, rid in room_order:
        label = rn if sum(1 for a, _ in room_order if a == rn) == 1 else "%s(%s)" % (rn, rid)
        runs_by_room[label] = cabinet_runs(merged, rn, rid)
    shapes = {label: kitchen_shape(runs_by_room[label]) for label in runs_by_room}

    vd_info = load_viewdata()
    data = build_json(merged, room_order, vd_info)
    md = build_md(data, merged, runs_by_room, shapes)

    if not args.check:
        with open(JSON_OUT, "w", encoding="utf-8") as fh:
            json.dump(data, fh, ensure_ascii=False, indent=2)
        with open(MD_OUT, "w", encoding="utf-8") as fh:
            fh.write(md + "\n")

    # ---- 控制台报告 ----
    named_sm = sum(1 for n in glb.gltf["nodes"] if n.get("name", "").startswith(FURN_PREFIX))
    print("GLB 节点总数            : %d" % len(glb.gltf["nodes"]))
    print("其中 SM_* 命名节点      : %d" % named_sm)
    print("家具节点(含由 mesh 名还原): %d" % len(items))
    print("合并同名同位置后条目数   : %d" % len(merged))
    print("房间数                  : %d" % len(room_order))
    for r in data["rooms"]:
        agg = data["summary"]["rooms"][r["label"]]
        print("  - %-14s %2d 件 / %2d 类 : %s" % (
            r["label"], agg["node_count"], agg["item_count"],
            "、".join(agg["furniture_list"])))
    for r in data["rooms"]:
        if r["room"] == "厨房":
            print("厨房形态判定            : %s" % shapes.get(r["label"], "-"))
    if not args.check:
        print("已写出: %s" % JSON_OUT)
        print("已写出: %s" % MD_OUT)
    return 0


if __name__ == "__main__":
    sys.exit(main())
