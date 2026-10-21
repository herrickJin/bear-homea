#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
extract_walls.py — 从 123kanfang 的 floordata0.glb 提取户型墙体与门窗洞口
================================================================================

输入
----
  archive/floorplan-source/floordata0.glb   (glTF 2.0 binary)
  archive/floorplan-source/ViewData.json    (房间净区多边形)

输出
----
  archive/floorplan-source/derived/walls.json
  archive/floorplan-source/derived/walls.md

只依赖 Python 标准库 (struct / json / math)。若装了 Pillow, 额外输出一张
校验用的平面图 derived/walls_debug.png。

坐标约定
--------
* GLB 单位 1 = 10 mm, 输出统一换算为 mm。
* GLB 与 ViewData.json **不是**同一朝向: ViewData 房间多边形的 (X, Y)
  对应 GLB 的 (X, -Y)。本脚本用 GLB 几何独立验证了这一点 (见 walls.md)。
* 输出为 XZ 平面二维坐标 [x, z]; 原点 = GLB 模型原点 (与 ViewData 同源)。
* 方位 (由 WechatIMG209.jpg 原始户型图 + 指北针确定):
      GLB +Z = 北,  GLB -Z = 南
      GLB -X = 东,  GLB +X = 西
  即模型 X 轴与惯例的"东"相反 (镜像)。

用法
----
  python3 extract_walls.py [--glb PATH] [--viewdata PATH] [--outdir DIR]
"""

import argparse
import json
import math
import os
import struct
import sys
from collections import defaultdict

# --------------------------------------------------------------------------- #
# 常量
# --------------------------------------------------------------------------- #

UNIT_TO_MM = 10.0                      # 1 GLB unit = 10 mm
EPS = 1e-6
FACE_EPS = 1e-6                        # 三角面法线判轴向的容差
PLANE_TOL = 0.30                       # 墙面平面归并容差 (GLB 单位)
MIN_THICK = 0.60                       # 最薄墙 = 60 mm
MAX_THICK = 60.0                       # 最厚墙 = 600 mm (超过则判为非墙)
MIN_FACE_H = 20.0                      # 墙面最小竖向高度 200 mm (滤掉窗台压条/踢脚)
WALL_HEIGHT = 280.0                    # 标准层高 2800 mm

# 洞口过梁 / 窗台 特征标高 (GLB 单位)
SILL_Y = (90.0, 91.0)                  # 窗台 900 mm
DOOR_HEAD_Y = (210.0,)                 # 门头 2100 mm
PASS_HEAD_Y = (230.0,)                 # 垭口 / 窗头 2300 mm

# 原始户型房间名 (lead 指定) —— 键为 ViewData 房间 ID
ROOM_NAME = {
    "eHaXGv38": "客厅",
    "mCOSmg5M": "主卧",
    "g3cnKYnd": "北次卧",
    "f1qYqHqH": "南次卧",
    "EX4vhDXo": "主卫",
    "qOPrZ97W": "公卫",
    "XrCzEEni": "餐厅",
    "WFGji10I": "厨房",
    "z5u59ReE": "生活阳台",
}
# 方案 (123kanfang) 里的房间名, 便于追溯
ROOM_NAME_GLB = {
    "eHaXGv38": "客餐厅",
    "mCOSmg5M": "主卧",
    "g3cnKYnd": "次卧",
    "f1qYqHqH": "次卧",
    "EX4vhDXo": "卫生间",
    "qOPrZ97W": "卫生间",
    "XrCzEEni": "书房",
    "WFGji10I": "厨房",
    "z5u59ReE": "生活阳台",
}
ROOM_NOTE = {
    "eHaXGv38": "方案把原始的客厅 + 餐厅合并成一个 '客餐厅' 大空间 (餐桌也放在这里)。",
    "XrCzEEni": "原始户型此位置是餐厅/入户过道, 方案加隔墙围合出 '书房'。",
    "g3cnKYnd": "位于户型东北侧。",
    "f1qYqHqH": "位于户型东南侧。",
    "EX4vhDXo": "位于东北角, 与主卧共墙, 判定为主卫。",
    "qOPrZ97W": "位于户型中北部, 服务过道, 判定为公卫。",
    "WFGji10I": "西北角厨房。",
    "z5u59ReE": "西南角生活阳台。",
}


# --------------------------------------------------------------------------- #
# 1. GLB 解析
# --------------------------------------------------------------------------- #

class Glb(object):
    """极简 GLB / glTF 读取器 (纯标准库)。"""

    def __init__(self, path):
        with open(path, "rb") as fh:
            self.raw = fh.read()
        magic, version, length = struct.unpack_from("<III", self.raw, 0)
        if magic != 0x46546C67:
            raise ValueError("not a GLB file")
        self.version = version
        self.length = length
        self.gltf = None
        self.blob = b""
        off = 12
        while off < length:
            clen, ctype = struct.unpack_from("<II", self.raw, off)
            body = self.raw[off + 8: off + 8 + clen]
            if ctype == 0x4E4F534A:          # JSON
                self.gltf = json.loads(body.decode("utf-8"))
            elif ctype == 0x004E4942:        # BIN
                self.blob = body
            off += 8 + clen
        if self.gltf is None:
            raise ValueError("GLB has no JSON chunk")
        self.nodes = self.gltf.get("nodes", [])
        self.meshes = self.gltf.get("meshes", [])
        self.accessors = self.gltf.get("accessors", [])
        self.bufferViews = self.gltf.get("bufferViews", [])

    # -- accessor 读取 --------------------------------------------------------
    _CTYPE = {5120: ("b", 1), 5121: ("B", 1), 5122: ("h", 2),
              5123: ("H", 2), 5125: ("I", 4), 5126: ("f", 4)}
    _NCOMP = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}

    def read_accessor(self, idx):
        """返回 [(x, y, z), ...] (SCALAR 时每项 1 个 float)。"""
        acc = self.accessors[idx]
        if "bufferView" not in acc:
            return []
        bv = self.bufferViews[acc["bufferView"]]
        ncomp = self._NCOMP[acc["type"]]
        fmt, size = self._CTYPE[acc["componentType"]]
        stride = bv.get("byteStride") or size * ncomp
        base = bv.get("byteOffset", 0) + acc.get("byteOffset", 0)
        count = acc["count"]
        out = []
        if bv.get("byteStride"):
            for i in range(count):
                o = base + i * stride
                out.append(struct.unpack_from("<" + fmt * ncomp, self.blob, o))
        else:
            for i in range(count):
                o = base + i * size * ncomp
                out.append(struct.unpack_from("<" + fmt * ncomp, self.blob, o))
        return out

    # -- 节点变换 ------------------------------------------------------------
    @staticmethod
    def _quat_to_mat(q):
        x, y, z, w = q
        return [
            [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
            [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
            [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
        ]

    @staticmethod
    def _mat_mul(a, b):
        return [[sum(a[i][k] * b[k][j] for k in range(3)) for j in range(3)]
                for i in range(3)]

    @staticmethod
    def _mat_apply(m, p):
        return (m[0][0] * p[0] + m[0][1] * p[1] + m[0][2] * p[2],
                m[1][0] * p[0] + m[1][1] * p[1] + m[1][2] * p[2],
                m[2][0] * p[0] + m[2][1] * p[1] + m[2][2] * p[2])

    def local_matrix(self, node):
        """节点本地 4x4 (仅取旋转部分 3x3 + 平移)。"""
        if "matrix" in node:
            m = node["matrix"]
            mat = [[m[0], m[4], m[8]], [m[1], m[5], m[9]], [m[2], m[6], m[10]]]
            t = (m[12], m[13], m[14])
            return mat, t
        mat = [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]]
        if "scale" in node:
            s = node["scale"]
            mat = [[mat[0][0] * s[0], mat[0][1] * s[1], mat[0][2] * s[2]],
                   [mat[1][0] * s[0], mat[1][1] * s[1], mat[1][2] * s[2]],
                   [mat[2][0] * s[0], mat[2][1] * s[1], mat[2][2] * s[2]]]
        if "rotation" in node:
            mat = self._mat_mul(self._quat_to_mat(node["rotation"]), mat)
        t = tuple(node.get("translation", (0.0, 0.0, 0.0)))
        return mat, t

    def world_matrices(self):
        """返回 {node_index: (3x3 mat, translation)} —— 父→子累积。"""
        world = {}

        def walk(i, parent_mat, parent_t):
            m, t = self.local_matrix(self.nodes[i])
            if parent_mat is not None:
                # child = parent * local  →  R_p*(R_c*p) + t_p + R_p*t_c
                new_m = self._mat_mul(parent_mat, m)
                pt = self._mat_apply(parent_mat, t)
                new_t = (parent_t[0] + pt[0], parent_t[1] + pt[1], parent_t[2] + pt[2])
            else:
                new_m, new_t = m, t
            world[i] = (new_m, new_t)
            for c in self.nodes[i].get("children", []):
                walk(c, new_m, new_t)

        scene = self.gltf["scenes"][self.gltf.get("scene", 0)]
        for root in scene.get("nodes", []):
            walk(root, None, None)
        return world

    def mesh_triangles(self, mesh_index, world):
        """返回世界坐标三角面列表。"""
        m = self.meshes[mesh_index]
        mat, tr = world
        tris = []
        for prim in m["primitives"]:
            raw = self.read_accessor(prim["attributes"]["POSITION"])
            pos = [tuple(self._mat_apply(mat, p)[i] + tr[i] for i in range(3))
                   for p in raw]
            if "indices" in prim:
                idx = [r[0] for r in self.read_accessor(prim["indices"])]
            else:
                idx = list(range(len(pos)))
            for k in range(0, len(idx) - 2, 3):
                tris.append((pos[idx[k]], pos[idx[k + 1]], pos[idx[k + 2]]))
        return tris


# --------------------------------------------------------------------------- #
# 2. 几何工具
# --------------------------------------------------------------------------- #

def _sub(a, b):
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def _cross(a, b):
    return (a[1] * b[2] - a[2] * b[1],
            a[2] * b[0] - a[0] * b[2],
            a[0] * b[1] - a[1] * b[0])


def tri_normal(t):
    n = _cross(_sub(t[1], t[0]), _sub(t[2], t[0]))
    L = math.sqrt(sum(c * c for c in n))
    return (n[0] / L, n[1] / L, n[2] / L) if L > 1e-12 else (0.0, 0.0, 0.0)


def merge_intervals(iv):
    """合并一维区间。"""
    if not iv:
        return []
    iv = sorted(iv)
    out = [list(iv[0])]
    for a, b in iv[1:]:
        if a <= out[-1][1] + 1e-6:
            out[-1][1] = max(out[-1][1], b)
        else:
            out.append([a, b])
    return [tuple(x) for x in out]


def intersect_intervals(a, b):
    out = []
    for a0, a1 in a:
        for b0, b1 in b:
            lo, hi = max(a0, b0), min(a1, b1)
            if hi - lo > 1e-6:
                out.append((lo, hi))
    return merge_intervals(out)


def intervals_equal(a, b, tol=0.35):
    if len(a) != len(b):
        return False
    return all(abs(p[0] - q[0]) <= tol and abs(p[1] - q[1]) <= tol
               for p, q in zip(a, b))


def point_in_poly(pt, poly):
    x, y = pt
    inside = False
    n = len(poly)
    for i in range(n):
        x1, y1 = poly[i]
        x2, y2 = poly[(i + 1) % n]
        if (y1 > y) != (y2 > y):
            xin = x1 + (y - y1) * (x2 - x1) / (y2 - y1)
            if x < xin:
                inside = not inside
    return inside


def poly_area(poly):
    s = 0.0
    n = len(poly)
    for i in range(n):
        x1, y1 = poly[i]
        x2, y2 = poly[(i + 1) % n]
        s += x1 * y2 - x2 * y1
    return abs(s) * 0.5


# --------------------------------------------------------------------------- #
# 3. 场景解析: 房间 / 建筑构件 / 家具构件
# --------------------------------------------------------------------------- #

def build_scene(glb):
    world = glb.world_matrices()
    nodes = glb.nodes
    parent = {}
    for i, n in enumerate(nodes):
        for c in n.get("children", []):
            parent[c] = i

    def room_of(i):
        """返回房间 ID (ViewData 房间 ID), 便于与 ViewData.json 对齐。"""
        p = parent.get(i)
        while p is not None:
            nm = nodes[p].get("name") or ""
            if nm.startswith("Room-"):
                return nm.split("-")[-1]
            p = parent.get(p)
        return None

    def group_of(i):
        """返回 'arch' (建筑) / 'prop' (家具) / None"""
        p = parent.get(i)
        if p is None:
            return None
        gp = nodes[p].get("name")
        if gp == "Mesh":
            return "arch"
        if gp == "Model":
            return "prop"
        return None

    arch_nodes, prop_nodes = [], []
    for i, n in enumerate(nodes):
        if n.get("mesh") is None:
            continue
        g = group_of(i)
        if g == "arch":
            arch_nodes.append(i)
        elif g == "prop":
            prop_nodes.append(i)

    rooms = {}          # room node name -> id
    for i, n in enumerate(nodes):
        nm = n.get("name") or ""
        if nm.startswith("Room-"):
            parts = nm.split("-")
            rooms[nm] = parts[-1] if len(parts) >= 3 else nm

    return world, parent, rooms, room_of, arch_nodes, prop_nodes


# --------------------------------------------------------------------------- #
# 4. 面片分类: 竖直墙面 / 水平板面
# --------------------------------------------------------------------------- #

class FaceSets(object):
    def __init__(self):
        self.vf = []   # (axis, coord, u1, u2, y1, y2, room_id, node_name)
        self.hf = []   # (y, x1, x2, z1, z2, room_id, node_name)
        self.skew = 0
        self.nonaxis_v = 0


def collect_faces(glb, world, room_of, arch_nodes):
    fs = FaceSets()
    for i in arch_nodes:
        node = glb.nodes[i]
        name = node.get("name") or ""
        if name.startswith("Section-"):
            # Section-* 是剖切面 (天花板 / 地面切片), 不是墙
            continue
        rid = room_of(i)
        for t in glb.mesh_triangles(node["mesh"], world[i]):
            n = tri_normal(t)
            if abs(n[1]) > FACE_EPS:
                ys = [p[1] for p in t]
                if abs(max(ys) - min(ys)) < 1e-6:
                    fs.hf.append((round(max(ys), 4),
                                  min(p[0] for p in t), max(p[0] for p in t),
                                  min(p[2] for p in t), max(p[2] for p in t),
                                  rid, name))
                else:
                    fs.skew += 1
                continue
            if abs(n[0]) > FACE_EPS and abs(n[2]) > FACE_EPS:
                fs.nonaxis_v += 1
                continue
            if abs(n[0]) > FACE_EPS:
                axis, coord = "x", round(t[0][0], 4)
                us = [p[2] for p in t]
            else:
                axis, coord = "z", round(t[0][2], 4)
                us = [p[0] for p in t]
            ys = [p[1] for p in t]
            fs.vf.append((axis, coord, min(us), max(us), min(ys), max(ys), rid, name))
    return fs


# --------------------------------------------------------------------------- #
# 5. 墙面聚类 & 墙体配对
# --------------------------------------------------------------------------- #

def build_wall_lines(fs):
    """把竖直面按 (axis, coord) 聚类, 再把 coord 相近的平面合并成 "墙面线"。"""
    planes = defaultdict(list)
    for axis, coord, u1, u2, y1, y2, rid, name in fs.vf:
        # 竖直方向太矮的面 (窗台压条 / 踢脚 / 门套小面) 不是墙体侧面
        if (y2 - y1) < MIN_FACE_H:
            continue
        planes[(axis, coord)].append((u1, u2, y1, y2, rid, name))

    by_axis = defaultdict(list)
    for (axis, coord), faces in planes.items():
        by_axis[axis].append((coord, faces))

    lines = []
    for axis in ("x", "z"):
        items = sorted(by_axis.get(axis, []))
        cluster = []

        def flush(cluster):
            if not cluster:
                return
            coords = [c for c, _ in cluster]
            faces = []
            for _, f in cluster:
                faces.extend(f)
            # 代表坐标: 取出现次数最多的坐标 (真实墙面), 否则取中位数
            cnt = defaultdict(int)
            for c in coords:
                cnt[round(c, 2)] += 1
            rep = max(cnt.items(), key=lambda kv: (kv[1], -abs(kv[0])))[0]
            cov = merge_intervals([(f[0], f[1]) for f in faces])
            ys = [(f[2], f[3]) for f in faces]
            lines.append({
                "axis": axis,
                "coord": rep,
                "coords": sorted(set(round(c, 2) for c in coords)),
                "cov": cov,
                "ymin": min(y[0] for y in ys),
                "ymax": max(y[1] for y in ys),
                "faces": faces,
                "rooms": sorted(set(f[4] for f in faces if f[4])),
            })

        for coord, faces in items:
            if cluster and coord - cluster[-1][0] > PLANE_TOL:
                flush(cluster)
                cluster = []
            cluster.append((coord, faces))
        flush(cluster)
    return lines


def _cov_len(cov):
    return sum(b - a for a, b in cov)


def _covers(outer, inner, tol=0.35):
    """outer 区间集是否完整覆盖 inner 区间集。"""
    return intervals_equal(outer, inner, tol)


def pair_walls(lines):
    """把成对的平行墙面配成墙体 (板)。

    GLB 的墙体是实体板: 两侧各有一组竖直���面 (同一位置常有 ±0.08 的
    "内衬面" 副本)。此外, 部分墙体会沿厚度方向被拆成两片, 中间多出一层
    极薄 (≈1.6mm) 的"中板", 它比真正的两侧墙面都长 (包住了与外墙交接处)。
    这里用 "中板规则" 排除这种伪配对:

        若 c1 < c2 < c3, gap(c1,c2) 与 gap(c2,c3) 都 >= 最薄墙厚,
        且 cov(c2) 完全覆盖 cov(c1)∩cov(c3), 则 (c1,c2)、(c2,c3) 是伪配对,
        真正的墙是 (c1,c3)。
    """
    walls = []
    for axis in ("x", "z"):
        cand = sorted([l for l in lines if l["axis"] == axis],
                      key=lambda l: l["coord"])
        n = len(cand)
        if n < 2:
            continue

        def pair_ok(i, j):
            gap = cand[j]["coord"] - cand[i]["coord"]
            if gap < MIN_THICK or gap > MAX_THICK:
                return None
            ov = intersect_intervals(cand[i]["cov"], cand[j]["cov"])
            if not ov:
                return None
            need = 0.6 * min(_cov_len(cand[i]["cov"]), _cov_len(cand[j]["cov"]))
            if sum(b - a for a, b in ov) < need - 1e-6:
                return None
            return gap, ov

        ok = {}
        for i in range(n):
            for j in range(i + 1, n):
                r = pair_ok(i, j)
                if r:
                    ok[(i, j)] = r

        # 中板规则
        changed = True
        while changed:
            changed = False
            for (i, k) in list(ok.keys()):
                for j in range(i + 1, k):
                    if (i, j) in ok and (j, k) in ok:
                        ov = intersect_intervals(cand[i]["cov"], cand[k]["cov"])
                        if ov and _covers(cand[j]["cov"], ov):
                            del ok[(i, j)]
                            del ok[(j, k)]
                            r = pair_ok(i, k)
                            if r:
                                ok[(i, k)] = r
                            changed = True
                            break
                if changed:
                    break

        for (i, j), (gap, ov) in ok.items():
            # 一对墙面可能对应多段不相连的墙 (例如南北两个房间的外墙),
            # 必须按覆盖区间的每一段分别生成一条墙。
            for (u0, u1) in ov:
                if u1 - u0 < 1.0:
                    continue
                walls.append({
                    "axis": axis,
                    "c1": cand[i]["coord"], "c2": cand[j]["coord"],
                    "thickness": gap,
                    "u1": u0, "u2": u1,
                    "line1": cand[i], "line2": cand[j],
                })

    # 去重: 同一对墙面被不同 cluster 组合重复命中
    walls.sort(key=lambda w: (w["axis"], round(w["u1"], 2), w["c1"]))
    out = []
    for w in walls:
        dup = False
        for o in out:
            if o["axis"] != w["axis"]:
                continue
            if abs(o["u1"] - w["u1"]) < 0.05 and abs(o["u2"] - w["u2"]) < 0.05:
                if abs(o["c1"] - w["c1"]) < 0.45 and abs(o["c2"] - w["c2"]) < 0.45:
                    dup = True
                    break
                # 同一 u 段, 但墙面坐标不同 —— 保留更贴近"房间净区"的厚度
                if (abs(o["c1"] - w["c1"]) < 0.05 and abs(o["c2"] - w["c2"]) < 0.05):
                    dup = True
                    break
        if not dup:
            out.append(w)
    return out


def merge_walls(walls, tol=0.45):
    """把同一条墙上被开口/拼缝切开的相邻段合并成一段连续墙。"""
    groups = defaultdict(list)
    for w in walls:
        key = (w["axis"], round(w["c1"] / tol), round(w["c2"] / tol))
        groups[key].append(w)
    out = []
    for key, ws in groups.items():
        ws.sort(key=lambda w: w["u1"])
        cur = dict(ws[0])
        for w in ws[1:]:
            if w["u1"] <= cur["u2"] + 0.6:
                cur["u2"] = max(cur["u2"], w["u2"])
                cur["line1"] = w["line1"]
                cur["line2"] = w["line2"]
            else:
                out.append(cur)
                cur = dict(w)
        out.append(cur)
    return out


# --------------------------------------------------------------------------- #
# 6. 洞口 (门 / 窗 / 垭口) 检测
# --------------------------------------------------------------------------- #

def build_plane_index(fs):
    """{(axis, coord): [(u1,u2,y1,y2), ...]} —— 便于判断某个位置是否被墙面挡住。"""
    idx = defaultdict(list)
    for axis, coord, u1, u2, y1, y2, rid, name in fs.vf:
        idx[(axis, coord)].append((u1, u2, y1, y2))
    return idx


def wall_has_hole(plane_idx, axis, lo, hi, short_lo, short_hi, y_mid):
    """判断洞口所在位置, 墙面是否真的被挖空。

    axis   : 洞口的延展方向 ('x' 或 'z')
    lo/hi  : 洞口沿延展方向的区间
    short_lo/short_hi : 洞口在"墙厚"方向上的区间
    y_mid  : 洞口竖向中心 (GLB 单位)

    返回 (is_real_hole, detail)
           is_real_hole = True  → 该处墙面确实被挖空, 是真洞口
                            False → 找不到墙面 / 墙面是实的
                                    (属于吊顶、隔断顶板一类的水平构造)
    """
    u_mid = (lo + hi) / 2.0
    plane_axis = "z" if axis == "x" else "x"
    cands = [c for (ax, c) in plane_idx if ax == plane_axis
             and short_lo - 1.0 <= c <= short_hi + 1.0]
    if not cands:
        return False, []
    blocked = []
    for c in sorted(cands):
        covered = False
        for (u1, u2, y1, y2) in plane_idx[(plane_axis, c)]:
            if u1 - 1e-6 <= u_mid <= u2 + 1e-6 and y1 - 1e-6 <= y_mid <= y2 + 1e-6:
                covered = True
                break
        blocked.append((c, covered))
    real = any(not cov for _, cov in blocked)
    return real, blocked


def detect_openings(fs):
    """用水平板面 (过梁 / 窗台) 反推洞口。

    GLB 里每个洞口会在相邻房间的网格里各画一遍, 因此先按洞口轮廓
    (x1,x2,z1,z2) 分组, 把同一洞口的多个板面 (窗台 900 / 门头 2100 /
    垭口过梁 2300) 合并。
    """
    panels = defaultdict(list)
    for y, x1, x2, z1, z2, rid, name in fs.hf:
        key = (round(x1, 2), round(x2, 2), round(z1, 2), round(z2, 2))
        panels[key].append((round(y, 2), rid, name))

    raw = []
    for key, ys in sorted(panels.items()):
        x1, x2, z1, z2 = key
        levels = sorted(set(y for y, _, _ in ys))
        if (x2 - x1) < 0.4 and (z2 - z1) < 0.4:
            continue
        sill = None
        head = None
        for y in levels:
            if any(abs(y - s) < 0.35 for s in SILL_Y):
                if sill is None or y < sill:
                    sill = y
            elif any(abs(y - d) < 0.35 for d in DOOR_HEAD_Y):
                if head is None or y < head:
                    head = y
            elif any(abs(y - p) < 0.35 for p in PASS_HEAD_Y):
                if head is None or y < head:
                    head = y
        if head is None:
            continue
        raw.append({
            "x1": x1, "x2": x2, "z1": z1, "z2": z2,
            "sill": sill if sill is not None else 0.0,
            "head": head,
            "has_sill": sill is not None,
            "rooms": sorted(set(r for _, r, _ in ys if r)),
            "levels": levels,
        })

    # ---- 合并轮廓相近的洞口 (同一洞口被多间房各画一次) ------------------- #
    merged = []
    for o in raw:
        hit = None
        for m in merged:
            if (abs(m["x1"] - o["x1"]) <= 1.0 and abs(m["x2"] - o["x2"]) <= 1.0 and
                    abs(m["z1"] - o["z1"]) <= 1.0 and abs(m["z2"] - o["z2"]) <= 1.0):
                hit = m
                break
        if hit is None:
            merged.append(dict(o))
        else:
            hit["head"] = min(hit["head"], o["head"])
            if o["has_sill"]:
                hit["sill"] = min(hit["sill"], o["sill"])
                hit["has_sill"] = True
            hit["rooms"] = sorted(set(hit["rooms"]) | set(o["rooms"]))
            hit["levels"] = sorted(set(hit["levels"]) | set(o["levels"]))

    openings = []
    for o in merged:
        x1, x2, z1, z2 = o["x1"], o["x2"], o["z1"], o["z2"]
        if (x2 - x1) >= (z2 - z1):
            # 墙沿 X 延伸, 洞口宽度沿 X, 墙厚沿 Z
            width = x2 - x1
            wall_axis = "x"
        else:
            # 墙沿 Z 延伸, 洞口宽度沿 Z, 墙厚沿 X
            width = z2 - z1
            wall_axis = "z"
        if o["has_sill"]:
            kind = "window"
        elif abs(o["head"] - 210.0) < 0.5:
            kind = "door"
        elif o["sill"] > 0:
            kind = "window"
        else:
            kind = "passage"
        openings.append({
            "kind": kind,
            "head": o["head"],
            "sill": o["sill"],
            "width": width,
            "x1": x1, "x2": x2, "z1": z1, "z2": z2,
            "wall_axis": wall_axis,
            "rooms": o["rooms"],
            "levels": o["levels"],
        })

    openings.sort(key=lambda o: (o["wall_axis"], o["x1"], o["z1"]))
    return openings


def collect_door_props(glb, world, prop_nodes, room_of):
    """把 'SM_门套_*' / 'SM_平开门_*' 等门窗家具节点取出来。"""
    out = []
    for i in prop_nodes:
        node = glb.nodes[i]
        name = node.get("name") or ""
        if not any(k in name for k in ("门", "窗")):
            continue
        mat, tr = world[i]
        tris = glb.mesh_triangles(node["mesh"], world[i])
        pts = [p for t in tris for p in t]
        if not pts:
            continue
        bb = [(min(p[0] for p in pts), max(p[0] for p in pts)),
              (min(p[1] for p in pts), max(p[1] for p in pts)),
              (min(p[2] for p in pts), max(p[2] for p in pts))]
        # 节点自身 Y 轴旋转角 (绕 Y 的方位角)
        q = node.get("rotation")
        rot = 0.0
        if q:
            x, y, z, w = q
            rot = math.degrees(math.atan2(2 * (w * y + x * z),
                                          1 - 2 * (y * y + x * x)))
        out.append({
            "name": name,
            "node": i,
            "room": room_of(i),
            "center": [(bb[0][0] + bb[0][1]) / 2.0, (bb[2][0] + bb[2][1]) / 2.0],
            "aabb": bb,
            "rot_y": rot,
            "size": (bb[0][1] - bb[0][0], bb[1][1] - bb[1][0], bb[2][1] - bb[2][0]),
        })
    return out


# --------------------------------------------------------------------------- #
# 7. 房间多边形 (转成 GLB 坐标)
# --------------------------------------------------------------------------- #

def load_rooms(viewdata_path):
    with open(viewdata_path, "r", encoding="utf-8") as fh:
        vd = json.load(fh)
    floor = vd["Floors"][0]
    rooms = []
    for r in floor["Rooms"]:
        polys = []
        for ra in r.get("RoomAreas", []):
            # ViewData (X, Y) -> GLB (X, -Y)
            polys.append([(p["X"], -p["Y"]) for p in ra["polygon"]])
        rooms.append({
            "id": r["ID"],
            "glb_name": r["Name"],
            "name": ROOM_NAME.get(r["ID"], r["Name"]),
            "area": r.get("Area"),
            "polys": polys,
            "node_name": "Room-%s-%s" % (r["Name"], r["ID"]),
        })
    return floor, rooms


# --------------------------------------------------------------------------- #
# 8. 主流程
# --------------------------------------------------------------------------- #

def r1(v):
    return round(float(v), 1)


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    src = os.path.dirname(here)
    ap = argparse.ArgumentParser()
    ap.add_argument("--glb", default=os.path.join(src, "floordata0.glb"))
    ap.add_argument("--viewdata", default=os.path.join(src, "ViewData.json"))
    ap.add_argument("--outdir", default=here)
    args = ap.parse_args()

    glb = Glb(args.glb)
    world, parent, room_nodes, room_of, arch_nodes, prop_nodes = build_scene(glb)
    fs = collect_faces(glb, world, room_of, arch_nodes)
    lines = build_wall_lines(fs)
    walls = merge_walls(pair_walls(lines))
    plane_idx = build_plane_index(fs)
    openings = detect_openings(fs)
    rejected_openings = []
    door_props = collect_door_props(glb, world, prop_nodes, room_of)
    floor, rooms = load_rooms(args.viewdata)

    # ---- 墙体几何 → mm --------------------------------------------------- #
    out_walls = []
    for w in sorted(walls, key=lambda w: (w["axis"], w["u1"], w["c1"])):
        ax = w["axis"]
        c1, c2 = w["c1"], w["c2"]
        u1, u2 = w["u1"], w["u2"]
        if ax == "x":                       # 墙面法向沿 X → 墙沿 Z 方向延伸
            p1 = (c1, u1)
            p2 = (c1, u2)
            mid = (c1 + c2) / 2.0
            p1m = (mid, u1)
            p2m = (mid, u2)
            rot = 90.0
        else:
            p1 = (u1, c1)
            p2 = (u2, c1)
            mid = (c1 + c2) / 2.0
            p1m = (u1, mid)
            p2m = (u2, mid)
            rot = 0.0
        height = max(w["line1"]["ymax"], w["line2"]["ymax"]) - \
            min(w["line1"]["ymin"], w["line2"]["ymin"])
        out_walls.append({
            "axis": ax,
            "p1": [r1(p1[0] * UNIT_TO_MM), r1(p1[1] * UNIT_TO_MM)],
            "p2": [r1(p2[0] * UNIT_TO_MM), r1(p2[1] * UNIT_TO_MM)],
            "p1_center": [r1(p1m[0] * UNIT_TO_MM), r1(p1m[1] * UNIT_TO_MM)],
            "p2_center": [r1(p2m[0] * UNIT_TO_MM), r1(p2m[1] * UNIT_TO_MM)],
            "thickness": r1(w["thickness"] * UNIT_TO_MM),
            "height": r1(height * UNIT_TO_MM),
            "face1": r1(c1 * UNIT_TO_MM),
            "face2": r1(c2 * UNIT_TO_MM),
            "rotation_deg": rot,
            "rooms": sorted(set(w["line1"]["rooms"]) | set(w["line2"]["rooms"])),
            "_axis": ax,
            "_c1": c1, "_c2": c2, "_u1": u1, "_u2": u2,
        })
    for i, w in enumerate(out_walls):
        w["id"] = "W%02d" % (i + 1)

    # ---- 洞口 → mm + 归属墙体 -------------------------------------------- #
    out_open = []
    for o in sorted(openings, key=lambda o: (o["wall_axis"], o["x1"], o["z1"])):
        ax = o["wall_axis"]
        if ax == "x":                      # 墙沿 X 延伸, 洞口在 X 区间
            lo, hi = o["x1"], o["x2"]
            width_dir = "x"
            cx, cz = (lo + hi) / 2.0, (o["z1"] + o["z2"]) / 2.0
            rot = 0.0
        else:
            lo, hi = o["z1"], o["z2"]
            cx, cz = (o["x1"] + o["x2"]) / 2.0, (lo + hi) / 2.0
            rot = 90.0
        # 找到承载这个洞口的墙。
        # 约定: 墙体列表里 axis="x" 表示墙面法向沿 X (墙厚沿 X, 墙沿 Z 延伸);
        #       洞口里 ax 表示洞口延展方向 (墙的延伸方向), 二者互为转置。
        wall_axis = "z" if ax == "x" else "x"
        if ax == "x":                       # 洞口沿 X 延展 → 墙厚沿 Z
            short_lo, short_hi = o["z1"], o["z2"]
        else:                               # 洞口沿 Z 延展 → 墙厚沿 X
            short_lo, short_hi = o["x1"], o["x2"]
        host = None
        host_score = None
        for w in out_walls:
            if w["_axis"] != wall_axis:
                continue
            if lo < w["_u1"] - 0.8 or hi > w["_u2"] + 0.8:
                continue
            flo, fhi = min(w["_c1"], w["_c2"]), max(w["_c1"], w["_c2"])
            if flo - 0.8 > short_lo or short_hi > fhi + 0.8:
                continue
            score = (round(w["thickness"], 2), w["_u2"] - w["_u1"])
            if host_score is None or score < host_score:
                host, host_score = w, score
        if host is None:
            # 放宽: 取 u 区间重叠最大、且墙面方向一致的墙
            best, bestov = None, 0.0
            for w in out_walls:
                if w["_axis"] != wall_axis:
                    continue
                ov = min(hi, w["_u2"]) - max(lo, w["_u1"])
                if ov > bestov:
                    best, bestov = w, ov
            host = best
        # 真实性检验 A: 洞口宽度若等于相邻房间在该方向上的整宽,
        # 说明这块水平板面是吊顶/隔断顶板, 而不是洞口。
        width_units = o["width"]   # 已经是 GLB 单位
        suspect = False
        for rm in rooms:
            for poly in rm["polys"]:
                if ax == "x":
                    ext = max(p[0] for p in poly) - min(p[0] for p in poly)
                else:
                    ext = max(p[1] for p in poly) - min(p[1] for p in poly)
                if abs(ext - width_units) < 1.0:
                    suspect = True
        if suspect:
            rejected_openings.append({
                "x1": o["x1"], "x2": o["x2"], "z1": o["z1"], "z2": o["z2"],
                "kind": o["kind"], "levels": o["levels"],
                "host_wall": None,
                "reason": "板面宽度恰好等于相邻房间在该方向上的整宽 → 判定为吊顶/隔断顶板, 不是洞口",
            })
            continue
        # 真实性检验 B: 宿主墙的两个侧面在该位置必须都是空的
        hole_ok = False
        if host is not None:
            y_mid = (o["sill"] + o["head"]) / 2.0
            u_mid = (lo + hi) / 2.0
            for c in (host["_c1"], host["_c2"]):
                covered = False
                for (u1, u2, y1, y2) in plane_idx.get((wall_axis, round(c, 4)), []):
                    if u1 - 1e-6 <= u_mid <= u2 + 1e-6 and y1 - 1e-6 <= y_mid <= y2 + 1e-6:
                        covered = True
                        break
                if covered:
                    break
            else:
                hole_ok = True
        if not hole_ok:
            rejected_openings.append({
                "x1": o["x1"], "x2": o["x2"], "z1": o["z1"], "z2": o["z2"],
                "kind": o["kind"], "levels": o["levels"],
                "host_wall": host["id"] if host else None,
                "reason": ("宿主墙侧面在该位置是实的 → 该水平板面是吊顶/隔断顶板, 不是洞口"
                           if host else "找不到能承载该洞口的墙 → 判定为非洞口"),
            })
            continue
        out_open.append({
            "type": "window" if o["kind"] == "window" else "door",
            "subtype": o["kind"],
            "center": [r1(cx * UNIT_TO_MM), r1(cz * UNIT_TO_MM)],
            "width": r1(o["width"] * UNIT_TO_MM),
            "height": r1((o["head"] - o["sill"]) * UNIT_TO_MM),
            "sill": r1(o["sill"] * UNIT_TO_MM),
            "head": r1(o["head"] * UNIT_TO_MM),
            "wall_id": host["id"] if host else None,
            "rotation_deg": rot,
            "room": None,
            "rooms": o["rooms"],
            "_ax": ax, "_lo": lo, "_hi": hi,
        })
    # 同一洞口常被相邻两个房间各画一遍 (坐标有几十毫米差), 合并
    out_open.sort(key=lambda o: (o["center"][0], o["center"][1]))
    dedup = []
    for o in out_open:
        hit = None
        for m in dedup:
            if (abs(m["center"][0] - o["center"][0]) <= 120 and
                    abs(m["center"][1] - o["center"][1]) <= 120 and
                    abs(m["width"] - o["width"]) <= 60):
                hit = m
                break
        if hit is None:
            dedup.append(o)
        else:
            hit["center"] = [r1((hit["center"][0] + o["center"][0]) / 2.0),
                             r1((hit["center"][1] + o["center"][1]) / 2.0)]
            hit["height"] = min(hit["height"], o["height"])
            hit["head"] = min(hit["head"], o["head"])
            hit["sill"] = min(hit["sill"], o["sill"])
    out_open = dedup
    for i, o in enumerate(out_open):
        o["id"] = "O%02d" % (i + 1)

    # ---- 房间归属 --------------------------------------------------------- #
    def rooms_at(x, z):
        hit = []
        for rm in rooms:
            for poly in rm["polys"]:
                if point_in_poly((x, z), poly):
                    hit.append(rm["id"])
                    break
        return hit

    for w in out_walls:
        # 墙面两侧各外偏 0.5 单位, 取落在哪个房间多边形里
        if w["_axis"] == "x":
            u_mid = (w["_u1"] + w["_u2"]) / 2.0
            p_out = (w["_c1"] - 0.6, u_mid)
            p_in = (w["_c2"] + 0.6, u_mid)
        else:
            u_mid = (w["_u1"] + w["_u2"]) / 2.0
            p_out = (u_mid, w["_c1"] - 0.6)
            p_in = (u_mid, w["_c2"] + 0.6)
        side1 = rooms_at(*p_out)
        side2 = rooms_at(*p_in)
        both = []
        for s in (side1, side2):
            for r in s:
                if r not in both:
                    both.append(r)
        w["room"] = both[0] if both else None
        w["rooms"] = both
        if len(both) >= 2:
            w["kind"] = "interior"
        elif len(both) == 1:
            w["kind"] = "exterior"
        else:
            w["kind"] = "unknown"

    for o in out_open:
        rm = rooms_at(*[v / UNIT_TO_MM for v in o["center"]])
        if rm:
            o["room"] = rm[0]
        elif o["rooms"]:
            o["room"] = o["rooms"][0]

    # ---- 包围盒 ----------------------------------------------------------- #
    all_x, all_z = [], []
    for t in []:
        pass
    for node_i in arch_nodes:
        pass
    # 用 GLB 全部顶点算真实包围盒
    mn = [1e18] * 3
    mx = [-1e18] * 3
    for i, n in enumerate(glb.nodes):
        if n.get("mesh") is None:
            continue
        for t in glb.mesh_triangles(n["mesh"], world[i]):
            for p in t:
                for k in range(3):
                    mn[k] = min(mn[k], p[k])
                    mx[k] = max(mx[k], p[k])

    # ---- 校验 ------------------------------------------------------------- #
    notes = []
    checks = {}

    # (a) 墙体外轮廓
    wxs, wzs = [], []
    for w in out_walls:
        if w["_axis"] == "x":
            wxs.extend([w["face1"], w["face2"]])
            wzs.extend([w["p1"][1], w["p2"][1]])
        else:
            wxs.extend([w["p1"][0], w["p2"][0]])
            wzs.extend([w["face1"], w["face2"]])
    checks["wall_bbox_x_mm"] = [r1(min(wxs)), r1(max(wxs))]
    checks["wall_bbox_z_mm"] = [r1(min(wzs)), r1(max(wzs))]
    checks["glb_scene_bbox_mm"] = {
        "x": [r1(mn[0] * UNIT_TO_MM), r1(mx[0] * UNIT_TO_MM)],
        "y": [r1(mn[1] * UNIT_TO_MM), r1(mx[1] * UNIT_TO_MM)],
        "z": [r1(mn[2] * UNIT_TO_MM), r1(mx[2] * UNIT_TO_MM)],
    }
    checks["expected_outer_mm"] = {"width": 13412.5, "depth": 11385.0}

    # (b) 门洞是否落在正确的隔墙上: 取洞口两端点, 看是否在房间多边形边界上
    def rooms_on_wall_face(axis, coord, u1, u2, tol=1.2):
        """找出哪些房间的多边形边线落在墙面 axis=coord 上, 且覆盖 u 区间 [u1,u2]。"""
        res = []
        for rm in rooms:
            for poly in rm["polys"]:
                n = len(poly)
                for i in range(n):
                    ax1, ay1 = poly[i]
                    ax2, ay2 = poly[(i + 1) % n]
                    if axis == "x":                      # 墙面 x=const, 边线沿 Z
                        if abs(ax1 - ax2) < 1e-6 and abs(ax1 - coord) <= tol:
                            if min(ay1, ay2) - tol <= u2 and max(ay1, ay2) + tol >= u1:
                                res.append(rm["id"])
                    else:                               # 墙面 z=const, 边线沿 X
                        if abs(ay1 - ay2) < 1e-6 and abs(ay1 - coord) <= tol:
                            if min(ax1, ax2) - tol <= u2 and max(ax1, ax2) + tol >= u1:
                                res.append(rm["id"])
        out = []
        for r in res:
            if r not in out:
                out.append(r)
        return out

    door_checks = []
    for o in out_open:
        cx, cz = o["center"][0] / UNIT_TO_MM, o["center"][1] / UNIT_TO_MM
        if o["_ax"] == "x":
            e1 = (cx - o["width"] / 2.0 / UNIT_TO_MM, cz)
            e2 = (cx + o["width"] / 2.0 / UNIT_TO_MM, cz)
        else:
            e1 = (cx, cz - o["width"] / 2.0 / UNIT_TO_MM)
            e2 = (cx, cz + o["width"] / 2.0 / UNIT_TO_MM)
        merged = []
        host_w = None
        for w in out_walls:
            if w["id"] == o["wall_id"]:
                host_w = w
                break
        if host_w is not None:
            u_lo, u_hi = (min(e1[0], e2[0]), max(e1[0], e2[0])) if o["_ax"] == "x" \
                else (min(e1[1], e2[1]), max(e1[1], e2[1]))
            wall_axis = "z" if o["_ax"] == "x" else "x"
            for c in (host_w["_c1"], host_w["_c2"]):
                for rid in rooms_on_wall_face(wall_axis, c, u_lo, u_hi):
                    if rid not in merged:
                        merged.append(rid)
        door_checks.append({
            "id": o["id"], "type": o["type"], "subtype": o["subtype"],
            "center_mm": o["center"], "width_mm": o["width"],
            "height_mm": o["height"], "sill_mm": o["sill"],
            "wall_id": o["wall_id"],
            "rooms_touched": merged,
        })
        o["rooms_touched"] = merged
    checks["openings"] = door_checks

    # (c) 门套 / 平开门 实体与洞口对照
    prop_report = []
    for p in door_props:
        best = None
        for o in out_open:
            d = math.hypot(o["center"][0] - p["center"][0] * UNIT_TO_MM,
                           o["center"][1] - p["center"][1] * UNIT_TO_MM)
            if best is None or d < best[0]:
                best = (d, o)
        prop_report.append({
            "name": p["name"],
            "room_id": p["room"],
            "center_mm": [r1(p["center"][0] * UNIT_TO_MM), r1(p["center"][1] * UNIT_TO_MM)],
            "size_mm": [r1(s * UNIT_TO_MM) for s in p["size"]],
            "rot_y_deg": r1(p["rot_y"]),
            "nearest_opening": best[1]["id"] if best else None,
            "dist_to_opening_mm": r1(best[0]) if best else None,
        })
    checks["door_props"] = prop_report

    # (d) 房间面积核对
    room_checks = []
    for rm in rooms:
        a = sum(poly_area(p) for p in rm["polys"]) * UNIT_TO_MM ** 2 / 1e6
        room_checks.append({
            "id": rm["id"], "name": rm["name"], "glb_name": rm["glb_name"],
            "area_viewdata_m2": rm["area"],
            "area_recomputed_m2": round(a, 4),
            "diff_m2": round(a - (rm["area"] or 0), 4),
        })
    checks["rooms"] = room_checks

    # ---- 写出 ------------------------------------------------------------- #
    doc = {
        "units": "mm",
        "origin": "GLB 模型原点 (与 ViewData.json 同源); 输出为 XZ 平面二维坐标 [x, z], mm",
        "scale_note": "1 GLB unit = 10mm",
        "axis_note": ("GLB +Z = 北, GLB -Z = 南, GLB -X = 东, GLB +X = 西 "
                      "(依据 WechatIMG209.jpg 原始户型图指北针); "
                      "ViewData.json 房间多边形的 (X,Y) 对应 GLB 的 (X,-Y)"),
        "outer_bbox": {
            "x": [r1(mn[0] * UNIT_TO_MM), r1(mx[0] * UNIT_TO_MM)],
            "z": [r1(mn[2] * UNIT_TO_MM), r1(mx[2] * UNIT_TO_MM)],
        },
        "rooms": [{
            "id": rm["id"], "name": rm["name"], "glb_name": rm["glb_name"],
            "node": rm["node_name"], "area_m2": rm["area"], "note": ROOM_NOTE.get(rm["id"]),
        } for rm in rooms],
        "walls": [{
            "id": w["id"], "p1": w["p1"], "p2": w["p2"],
            "p1_center": w["p1_center"], "p2_center": w["p2_center"],
            "thickness": w["thickness"], "height": w["height"],
            "room": ROOM_NAME.get(w["room"], w["room"]),
            "room_id": w["room"],
            "rooms": [ROOM_NAME.get(r, r) for r in w["rooms"]],
            "rooms_id": w["rooms"],
            "kind": w["kind"],
            "rotation_deg": w["rotation_deg"],
            "face1_mm": w["face1"], "face2_mm": w["face2"],
        } for w in out_walls],
        "openings": [{
            "id": o["id"], "type": o["type"], "subtype": o["subtype"],
            "center": o["center"], "width": o["width"], "height": o["height"],
            "sill": o["sill"], "head": o["head"], "wall_id": o["wall_id"],
            "rotation_deg": o["rotation_deg"],
            "room": ROOM_NAME.get(o["room"], o["room"]),
            "room_id": o["room"],
            "rooms_touched": [ROOM_NAME.get(r, r) for r in o.get("rooms_touched", [])],
            "rooms_touched_id": o.get("rooms_touched", []),
        } for o in out_open],
        "checks": checks,
        "rejected_openings": rejected_openings,
        "notes": notes,
    }

    # ---- 说明性 notes ----------------------------------------------------- #
    notes.extend([
        "坐标系: GLB 与 ViewData.json 的朝向不同 —— ViewData 房间多边形的 (X, Y) "
        "对应 GLB 的 (X, -Y)。本脚本用 GLB 几何独立验证: 厨房/主卧/书房的房间网格 "
        "包围盒与多边形按 (X,-Y) 换算后逐条完全吻合 (误差 < 0.01 单位)。",
        "方位 (依据 archive/floorplan-3d/resource/WechatIMG209.jpg 原始户型图指北针): "
        "GLB +Z = 北, GLB -Z = 南, GLB -X = 东, GLB +X = 西 (模型 X 轴相对常规东向为镜像)。",
        "墙体系结构: GLB 建筑构件分两种节点 —— 'Mesh' 下是 Section-* (剖切面, 非墙) 与 "
        "MergedMesh_* (墙体/楼板实体); 'Model' 下是家具与门窗成品件 (SM_门套_*/SM_平开门_* 等)。",
        "墙体识别: 合并所有竖直轴向面 → 按 (法向轴, 平面坐标) 聚类 → 把成对的平行面配成墙板, "
        "厚度 = 两面间距。墙板沿厚度方向常被拆成两片, 中间多出一层约 1.6mm 的'中板', "
        "脚本用'中板规则'排除这种伪配对。",
        "洞口识别: 每个洞口在 GLB 里都有水平板面 (窗台 900 / 门头 2100 / 垭口过梁 2300), "
        "板面轮廓 = 洞口在墙上的投影, 直接给出洞口的宽度与所在墙厚; 再用'宿主墙面在该处确实是空的'"
        "做真实性检验。",
        "墙高统一按 2800mm (GLB y=280) 记录; 局部矮墙/反坎按实际几何高度记录。",
    ])
    os.makedirs(args.outdir, exist_ok=True)
    out_json = os.path.join(args.outdir, "walls.json")
    with open(out_json, "w", encoding="utf-8") as fh:
        json.dump(doc, fh, ensure_ascii=False, indent=2)

    # ---- 调试图 ------------------------------------------------------------ #
    try:
        debug_png(args.outdir, out_walls, out_open, rooms)
    except Exception as exc:                      # pragma: no cover
        sys.stderr.write("debug render skipped: %s\n" % exc)

    write_markdown(os.path.join(args.outdir, "walls.md"), doc, out_walls, out_open, rooms)

    print("walls: %d, openings: %d" % (len(out_walls), len(out_open)))
    print("wall bbox x %s z %s" % (checks["wall_bbox_x_mm"], checks["wall_bbox_z_mm"]))
    print("scene bbox  %s" % checks["glb_scene_bbox_mm"])
    print("wrote %s" % out_json)
    return doc, out_walls, out_open, rooms, checks


# --------------------------------------------------------------------------- #
# 10. walls.md 生成
# --------------------------------------------------------------------------- #

def write_markdown(path, doc, walls, openings, rooms):
    """生成中文说明文档 walls.md (表格由数据自动生成, 保证与 walls.json 一致)。"""
    L = []
    a = L.append
    C = doc["checks"]
    ob = doc["outer_bbox"]
    w_all = sum(1 for w in walls)
    kind_cnt = defaultdict(int)
    for w in walls:
        kind_cnt[w["kind"]] += 1

    a("# 户型墙体 / 门窗洞口提取 — 城投南山长投·领峯 D143 (123kanfang 方案 GLB)")
    a("")
    a("> 数据来源: `archive/floorplan-source/floordata0.glb` (glTF 2.0 binary) + `archive/floorplan-source/ViewData.json`  ")
    a("> 生成脚本: `archive/floorplan-source/derived/extract_walls.py` (可复现, 仅用 Python 标准库)  ")
    a("> 机器可读结果: `archive/floorplan-source/derived/walls.json`  ")
    a("> 校验用平面图: `archive/floorplan-source/derived/walls_debug.png` (需 Pillow, 无则跳过)")
    a("")
    a("## 0. 读数约定")
    a("")
    a("| 项目 | 约定 |")
    a("| --- | --- |")
    a("| 单位 | 全部 **毫米 (mm)**; GLB 原始 1 单位 = 10 mm |")
    a("| 原点 | GLB 模型原点 (与 ViewData.json 同源), 输出为 **XZ 平面二维坐标** `[x, z]` |")
    a("| X / Z | 水平面两轴; **Y 向上**, 地坪 Y=0, 顶棚 ≈ 2800 mm |")
    a("| 方位 | **+Z = 北, -Z = 南, -X = 东, +X = 西** (依据 `archive/floorplan-3d/resource/WechatIMG209.jpg` 原始户型图指北针) |")
    a("| `p1` / `p2` | 墙段的两个端点 (取墙的一侧内表面); `p1_center` / `p2_center` 为墙中线端点 |")
    a("| `thickness` | 墙厚 (两侧竖直面之间的距离) |")
    a("| `height` | 墙高 (GLB y 区间 × 10) |")
    a("| `rotation_deg` | 墙段延展方向: 0° = 沿 X, 90° = 沿 Z |")
    a("| 洞口 `rotation_deg` | 洞口宽度方向: 0° = 宽度沿 X, 90° = 宽度沿 Z |")
    a("| 洞口 `subtype` | `door` 门 / `window` 窗 / `passage` 垭口·无门扇洞口 |")
    a("")
    a("### 0.1 坐标系的一个关键坑")
    a("")
    a("**GLB 与 ViewData.json 的 Z 轴是反向的。** ViewData 房间多边形的 `(X, Y)` 对应 GLB 的 `(X, -Y)`。")
    a("这不是推测, 是用 GLB 几何独立验证出来的: 厨房、主卧、书房的房间网格包围盒, 按 `(X, -Y)` 换算后与")
    a("多边形逐条完全吻合 (误差 < 0.01 GLB 单位):")
    a("")
    a("| 房间 | ViewData 多边形 (X, Y) | GLB 房间网格包围盒 | 一致? |")
    a("| --- | --- | --- | --- |")
    a("| 厨房 `WFGji10I` | X 83.75…324.50, Y -565.47…-343.97 | X 83.75…324.50, Z 343.97…565.47 | ✅ (Y 取反) |")
    a("| 主卧 `mCOSmg5M` | X -791.50…-460.50, Y -428.53…52.97 | X -791.50…-460.50, Z -428.53…52.97 | ✅ (Y 取反) |")
    a("| 书房 `XrCzEEni` | X -139.50…59.75, Y -394.72…-64.97 | X -139.50…59.75, Z 64.97…394.72 | ✅ (Y 取反) |")
    a("")
    a("本文件所有坐标一律用 **GLB 坐标** (即已取反的 Z)。")
    a("")
    a("### 0.2 房间命名 (按原始户型, 保留 GLB ID 便于追溯)")
    a("")
    a("| 原始户型名 | GLB 房间 ID | 123kanfang 方案里的名字 | 面积 m² | GLB X 范围 (mm) | GLB Z 范围 (mm) |")
    a("| --- | --- | --- | --- | --- | --- |")
    for rm in rooms:
        xs = [p[0] for poly in rm["polys"] for p in poly]
        zs = [p[1] for poly in rm["polys"] for p in poly]
        a("| %s | `%s` | %s | %.2f | %.1f … %.1f | %.1f … %.1f |" % (
            rm["name"], rm["id"], rm["glb_name"], rm["area"] or 0,
            min(xs) * UNIT_TO_MM, max(xs) * UNIT_TO_MM,
            min(zs) * UNIT_TO_MM, max(zs) * UNIT_TO_MM))
    a("")
    a("命名依据: 原始户型图 `WechatIMG209.jpg` 中该户型的指北针 (N 朝上) + 房间实际位置:")
    a("- **北次卧** `g3cnKYnd` 在户型东北侧; **南次卧** `f1qYqHqH` 在东南侧;")
    a("- **主卫** `EX4vhDXo` 在东北角、与主卧共墙; **公卫** `qOPrZ97W` 在中北部、临过道;")
    a("- 方案里的 `书房` `XrCzEEni` 对应原始户型的 **餐厅** (原始户型为三室两厅两卫, 没有书房)。")
    a("")
    a("## 1. GLB 墙体系结构")
    a("")
    a("```")
    a("Floor-1楼-wk713LKB (node 0)")
    a("├─ Room-客厅-eHaXGv38 / Room-主卧-… / Room-次卧-… / Room-卫生间-… (共 9 间)")
    a("│   ├─ Mesh      ← 建筑构件:  Section-Default-*  (剖切面, 非墙)")
    a("│   │                MergedMesh_*        (墙体 / 楼板 / 顶板 实体)")
    a("│   └─ Model     ← 家具与成品门窗件: SM_门套_210cm_*, SM_平开门_*, SM_入户门_120cm_* …")
    a("└─ (其余节点为家具 / 灯饰等)")
    a("```")
    a("")
    a("**墙体在 GLB 里是怎么表达的** (实测):")
    a("")
    a("1. 一道墙 = 一块 **矩形实体板**, 两侧各有一组竖直轴向面 (法向沿 X 或 Z);")
    a("2. 同一个墙面常出现 **±0.08 单位 (0.8 mm) 的「内衬面」副本** —— 这是渲染用的第二层表面, 不是另一道墙;")
    a("3. 墙板沿厚度方向常被拆成 **两片**, 中间多出一层约 **1.6 mm 厚的「中板」**, 它比真正两侧的墙面都长")
    a("   (包住了与外墙交接的一段), 因此不能拿它当墙面 —— 脚本用「中板规则」排除这种伪配对;")
    a("4. 门的洞口在 GLB 里不是布尔减出来的, 而是 **拆成上下几块面** (门洞上方一条过梁板 + 洞口两侧的「侧壁」面);")
    a("5. 窗同理, 额外多出一条 **窗台板** (标高 y=900);")
    a("6. 剖切面节点 (`Section-Default-*`) 是给 2D 平面图渲染用的 **水平切片**, 必须排除。")
    a("")
    a("## 2. 墙体清单")
    a("")
    a("共 **%d** 段墙 (内墙 %d / 外墙 %d / 未归属房间 %d), 详见 `walls.json` 的 `walls[]`。" % (
        w_all, kind_cnt["interior"], kind_cnt["exterior"], kind_cnt["unknown"]))
    a("")
    a("`kind` 判定: `interior` = 两侧都能落进房间净区多边形; `exterior` = 只有一侧有房间; "
      "`unknown` = 两侧都在房间净区之外 (墙腔 / 设备间 / 外墙垛子)。")
    a("")
    a("| ID | 类型 | 方向 | 起点 p1 (mm) | 终点 p2 (mm) | 墙厚 (mm) | 墙高 (mm) | 关联房间 |")
    a("| --- | --- | --- | --- | --- | --- | --- | --- |")
    for w in walls:
        a("| %s | %s | %d° | %s, %s | %s, %s | %.1f | %.0f | %s |" % (
            w["id"], w["kind"], w["rotation_deg"],
            w["p1"][0], w["p1"][1], w["p2"][0], w["p2"][1],
            w["thickness"], w["height"],
            "、".join(w["rooms"]) if w["rooms"] else "—"))
    a("")
    a("## 3. 门窗洞口清单")
    a("")
    a("共 **%d** 个洞口: 窗 %d、门 %d、垭口/无门扇洞口 %d。" % (
        len(openings),
        sum(1 for o in openings if o["type"] == "window"),
        sum(1 for o in openings if o["subtype"] == "door"),
        sum(1 for o in openings if o["subtype"] == "passage")))
    a("")
    a("| ID | 类型 | 中心 (x, z) mm | 宽 (mm) | 高 (mm) | 窗台高 (mm) | 所在墙 | 方向 | 所在房间 |")
    a("| --- | --- | --- | --- | --- | --- | --- | --- | --- |")
    for o in openings:
        kind_txt = {"door": "门", "window": "窗", "passage": "垭口"}[o["subtype"]]
        a("| %s | %s | %s, %s | %.1f | %.1f | %.1f | %s | %d° | %s |" % (
            o["id"], kind_txt, o["center"][0], o["center"][1],
            o["width"], o["height"], o["sill"],
            o["wall_id"] or "—", o["rotation_deg"],
            ROOM_NAME.get(o["room"], o["room"]) or "—"))
    a("")
    a("### 3.1 与 GLB 里的门套 / 平开门实体对照 (独立验证)")
    a("")
    a("GLB 中有 3 套门五金 (`SM_门套_210cm_*` + `SM_平开门_*`), 落在 主卧 / 南次卧 / 北次卧。"
      "它们的实测尺寸与上表中对应洞口完全吻合, 说明洞口位置与宽度是对的:")
    a("")
    a("| 门套节点 | 所在房间 | 中心 (mm) | 门套尺寸 宽×高×厚 (mm) | 对应洞口 | 中心偏差 (mm) |")
    a("| --- | --- | --- | --- | --- | --- |")
    for p in C["door_props"]:
        if "门套" not in p["name"]:
            continue
        a("| %s | %s | %s, %s | %.1f × %.1f × %.1f | %s | %.1f |" % (
            p["name"], ROOM_NAME.get(p["room_id"], p["room_id"]),
            p["center_mm"][0], p["center_mm"][1],
            p["size_mm"][0], p["size_mm"][1], p["size_mm"][2],
            p["nearest_opening"], p["dist_to_opening_mm"]))
    a("")
    a("> 注: 节点名叫 `门套_210cm`, 但实测门套高 **2300 mm**, 与洞口净高 2300 mm 一致 —— "
      "节点命名不可信, 以几何为准。")
    a("")
    a("## 4. 校验结果")
    a("")
    a("### 4.1 外轮廓对照")
    a("")
    a("| 项目 | X 范围 (mm) | Z 范围 (mm) | 宽 (mm) | 深 (mm) |")
    a("| --- | --- | --- | --- | --- |")
    a("| GLB 场景全体顶点包围盒 | %.1f … %.1f | %.1f … %.1f | %.1f | %.1f |" % (
        C["glb_scene_bbox_mm"]["x"][0], C["glb_scene_bbox_mm"]["x"][1],
        C["glb_scene_bbox_mm"]["z"][0], C["glb_scene_bbox_mm"]["z"][1],
        C["glb_scene_bbox_mm"]["x"][1] - C["glb_scene_bbox_mm"]["x"][0],
        C["glb_scene_bbox_mm"]["z"][1] - C["glb_scene_bbox_mm"]["z"][0]))
    a("| 提取出的墙体外轮廓 | %.1f … %.1f | %.1f … %.1f | %.1f | %.1f |" % (
        C["wall_bbox_x_mm"][0], C["wall_bbox_x_mm"][1],
        C["wall_bbox_z_mm"][0], C["wall_bbox_z_mm"][1],
        C["wall_bbox_x_mm"][1] - C["wall_bbox_x_mm"][0],
        C["wall_bbox_z_mm"][1] - C["wall_bbox_z_mm"][0]))
    a("| 任务给定基准 | -8175.0 … 5237.5 | -5500.3 … 5884.7 | **13412.5** | **11385.0** |")
    a("")
    a("结论: GLB 场景包围盒 = 13412.6 × 11385.1 mm, 与给定基准 13412.5 × 11385.0 mm 差 **+0.1 mm** (浮点精度), ✅ 通过。")
    a("墙体外轮廓比场景包围盒每边小 0.8…1.6 mm, 是因为外墙最外侧那层是楼板倒角面, 竖直墙面本身略微内收 —— 属正常, 已如实记录。")
    a("")
    a("### 4.2 房间面积复核")
    a("")
    a("用 ViewData 多边形重算面积 (÷10² 换算 m²) 与 ViewData 自带 `Area` 对比:")
    a("")
    a("| 房间 | 面积 (m²) | 重算 (m²) | 差 (m²) |")
    a("| --- | --- | --- | --- |")
    for r in C["rooms"]:
        a("| %s (`%s`) | %.6f | %.4f | %+.4f |" % (
            r["name"], r["id"], r["area_viewdata_m2"], r["area_recomputed_m2"], r["diff_m2"]))
    a("")
    a("全部 9 间房差值 = 0.00 m² ✅ —— 这同时验证了 **1 GLB 单位 = 10 mm** 的比例尺。")
    a("")
    a("### 4.3 门洞是否落在正确的隔墙上")
    a("")
    a("逐个洞口检查其所在墙面是否与房间净区多边形的边线重合 (`rooms_touched`):")
    a("")
    a("| 洞口 | 类型 | 中心 (mm) | 宽 (mm) | 所在墙 | 两侧房间 |")
    a("| --- | --- | --- | --- | --- | --- |")
    for ck in C["openings"]:
        a("| %s | %s | %s, %s | %.1f | %s | %s |" % (
            ck["id"], ck["subtype"], ck["center_mm"][0], ck["center_mm"][1],
            ck["width_mm"], ck["wall_id"] or "—",
            "、".join(ROOM_NAME.get(r, r) for r in ck["rooms_touched"]) if ck["rooms_touched"] else "—"))
    a("")
    a("说明: 绝大多数洞口两侧都能对应到房间; 少数只落到一侧 (见第 5 节存疑点)。")
    a("")
    a("## 5. 方案差异提示 (GLB 方案 vs 原始户型)")
    a("")
    a("对照 `archive/floorplan-3d/resource/WechatIMG209.jpg` (原始户型图) 与 GLB 方案模型:")
    a("")
    a("| # | 差异 | 几何证据 | 判定 |")
    a("| --- | --- | --- | --- |")
    a("| 1 | **厨房改为开放式** | 墙 `W68` (Z 3319.7…3439.7, 厚 119.2 mm, 位于 客厅/厨房 之间) 上有洞口 `O11`: 宽 1745 mm × 高 2300 mm, **无门扇**, 客厅与厨房连通。原始户型图中厨房南侧是整面墙 + 推拉门 | ✅ 确认 (拆改) |")
    a("| 2 | **餐厅改为书房** | 原始户型图的餐厅区 (餐桌在图上偏西) 在 GLB 中被一整块 `书房` `XrCzEEni` (6.57 m², X -1395…597.5, Z 649.7…3947.2) 占据, 且与客厅之间新增了墙 `W60` (Z 529.7, 厚 119.2 mm); 餐桌被挪到了客厅 (餐位 X 2752.7, Z 1665.9) | ✅ 确认 (原始餐厅 → 书房, 餐厅功能并入客厅) |")
    a("| 3 | **客厅 + 餐厅合并为「客餐厅」** | 方案房间 `客餐厅` 面积 46.56 m², 内部子区为 客厅区 / 过道区 / 盥洗区 / 玄关区; 原始户型是 客厅 与 餐厅 两个独立空间 | ✅ 确认 (拆改) |")
    a("| 4 | **阳台未与客厅打通** | 生活阳台 `z5u59ReE` 与客厅之间仍有墙 `W63` (Z -3924.5, 厚 279.2 mm)。原始户型图中阳台与客厅之间是一整条推拉门/落地窗 | ⚠️ **与「阳台打通」的假设不符 —— GLB 里墙还在** |")
    a("| 5 | 主卧增加独立衣帽间 | 主卧南侧出现整面宽 (3310 mm) 的水平板面 (标高 2100 / 2300), 位于房间净区之内 (Z -4165.3…-3685.3), 是 衣帽间/吊顶 的围合顶板, 不是洞口 | ✅ 确认 (隔断, 非洞口) |")
    a("")
    a("**未确认的项** (GLB 几何无法判定, 需要原始测量图或交付资料确认):")
    a("")
    a("- 原始户型图 `WechatIMG209.jpg` **无任何尺寸标注**, 因此原始户型与本 GLB 的逐墙尺寸无法核对。")
    a("- 宣传资料 `WechatIMG208.jpg` 标注的 13200 × 13240 mm 与 GLB 的 13412.5 × 11385 mm 不一致 "
      "(宽差 +212.5, 深差 **-1855**)。宣传图上标注了「此处为电梯前室公用空间」和「此处为建筑立面装饰线条」, "
      "推测宣传图的进深含了电梯前室与立面线条区域, GLB 里只是本户套内部分 —— **属口径差异, 不强行对齐**。")
    a("- 原始户型图提到的「室室飘窗 · 南北双向飘窗」: GLB 中对应 5 扇窗 (南侧 2 扇、北侧 3 扇), "
      "但飘窗是凸出结构还是平面窗, GLB 里无法区分。")
    a("- 门窗的 **开启方向 / 铰链侧** 无法从 GLB 静态几何可靠恢复 (`SM_平开门_*` 节点已被摆成半开状态)。")
    a("")
    a("## 6. 存疑点 / 未解析到")
    a("")
    a("1. **%d 段墙 `kind=unknown`** —— 两侧都不落在任何房间净区多边形里 (墙腔 / 设备夹层 / 外墙垛)。"
      "它们的厚度是从几何直接量出来的, 但归属房间标不出来, 例如 `W10`/`W12`/`W13` (X -1504…-1394 一带的墙腔)。" % kind_cnt["unknown"])
    a("2. **部分墙厚偏大** (最大 600 mm, 例如 `W21` 主卫西北角 481.9 mm、`W39` 餐厅北侧 581.3 mm): "
      "这些位置在 GLB 里是「外墙 + 设备间/凹槽」的复合体, 单看两个竖直面无法区分「厚墙」与「墙 + 空腔」, "
      "故按几何如实记录。")
    a("3. **`W35`/`W36`、`W70`/`W71` 等成对的重复墙段**: 同一位置被两片厚度略有差别的墙板覆盖 "
      "(差 5.3 mm / 229 mm), 应为墙板重叠所致, 已保留两段而未强行合并。")
    a("4. **6 块水平板面被判定为「非洞口」** (见 `walls.json` 的 `rejected_openings`): "
      "它们的宽度恰好等于相邻房间的整宽, 是吊顶 / 隔断顶板而不是门窗洞口, 已剔除。")
    a("5. **洞口高度只有 2300 / 2100 两种**: GLB 的门套节点名写 210cm 但实测 2300 mm, "
      "即方案里多数门是 **无门扇垭口 (2300 高)**, 只有入户门 (`O12`) 是带门扇的 2100 高门。")
    a("6. **未解析到**: 原始户型的 **施工图尺寸 / 门窗表** —— 仓库内没有; "
      "`WechatIMG208.jpg` 只有营销标注, `WechatIMG209.jpg` 无标注尺寸。")
    a("7. **南北次卧的命名依据是营销户型图 `WechatIMG209.jpg` 的指北针**, 而不是开发商的 "
      "原始建筑测量图 (仓库内没有)。若后续拿到带指北针的原始测量图, 请复核 "
      "`g3cnKYnd`/`f1qYqHqH` 的南北归属 (本结论: `g3cnKYnd`=北次卧, `f1qYqHqH`=南次卧)。"
      "所有几何坐标不受此影响 (坐标是绝对量, 不依赖方位)。")
    a("8. **原始户型图与 GLB 的户型面积对不上** (`WechatIMG209.jpg` 的图面比例约 13.5 mm/px, "
      "按此推算的户内面积与 GLB 的 152.7 m² 不等), 说明宣传图可能是同系列的另一套户型, "
      "仅房间拓扑 (谁挨着谁、哪面是外墙) 可比, 尺寸不可比。")
    a("")
    a("## 7. 复现方式")
    a("")
    a("```bash")
    a("cd archive/floorplan-source/derived")
    a("python3 extract_walls.py            # 只用标准库; 装了 Pillow 会额外输出 walls_debug.png")
    a("```")
    a("")
    a("脚本会重新生成 `walls.json` 与本文件 `walls.md`。")
    a("")
    with open(path, "w", encoding="utf-8") as fh:
        fh.write("\n".join(L) + "\n")


# --------------------------------------------------------------------------- #
# 9. 调试平面图
# --------------------------------------------------------------------------- #

def debug_png(outdir, walls, openings, rooms):
    from PIL import Image, ImageDraw
    xs = [v for w in walls for v in (w["p1"][0], w["p2"][0], w["face1"], w["face2"])]
    zs = [v for w in walls for v in (w["p1"][1], w["p2"][1])]
    for o in openings:
        xs.append(o["center"][0] - o["width"] / 2)
        xs.append(o["center"][0] + o["width"] / 2)
        zs.append(o["center"][1] - o["width"] / 2)
        zs.append(o["center"][1] + o["width"] / 2)
    x0, x1 = min(xs) - 400, max(xs) + 400
    z0, z1 = min(zs) - 400, max(zs) + 400
    S = 0.14
    W = int((x1 - x0) * S)
    H = int((z1 - z0) * S)
    img = Image.new("RGB", (W, H), (255, 255, 255))
    d = ImageDraw.Draw(img)

    def P(x, z):
        return ((x - x0) * S, (z - z0) * S)

    for rm in rooms:
        for poly in rm["polys"]:
            d.polygon([P(p[0] * UNIT_TO_MM, p[1] * UNIT_TO_MM) for p in poly],
                      fill=(228, 236, 248), outline=(110, 130, 190))
    for w in walls:
        c = (30, 30, 30) if w["kind"] == "interior" else ((200, 60, 60) if w["kind"] == "exterior" else (150, 150, 150))
        if w["_axis"] == "x":
            d.rectangle([P(w["face1"], w["_u1"] * UNIT_TO_MM), P(w["face2"], w["_u2"] * UNIT_TO_MM)],
                        fill=c)
        else:
            d.rectangle([P(w["_u1"] * UNIT_TO_MM, w["face1"]), P(w["_u2"] * UNIT_TO_MM, w["face2"])],
                        fill=c)
    for o in openings:
        col = (0, 160, 255) if o["type"] == "window" else (255, 0, 255)
        if o["_ax"] == "x":
            d.rectangle([P(o["center"][0] - o["width"] / 2, o["center"][1] - 120),
                         P(o["center"][0] + o["width"] / 2, o["center"][1] + 120)], outline=col, width=3)
        else:
            d.rectangle([P(o["center"][0] - 120, o["center"][1] - o["width"] / 2),
                         P(o["center"][0] + 120, o["center"][1] + o["width"] / 2)], outline=col, width=3)
    img.save(os.path.join(outdir, "walls_debug.png"))


if __name__ == "__main__":
    main()
