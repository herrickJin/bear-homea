#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
从 123kanfang 交互设计方案中提取「房间基准表」与「材质/配色档案」。

输入 (只读):
  ../ViewData.json         -- 123kanfang 房间元数据 (房间名 / 面积 / 净区多边形 / 视点)
  ../floordata0.glb        -- glTF 2.0 binary (12 字节头 + JSON chunk + BIN chunk)
  ../plan-123kanfang.png   -- 墙体线稿平面图 (透明底 + 白色墙线)

输出:
  rooms.json               -- 房间基准表 (机器可读)
  materials.json           -- 材质与配色档案 (机器可读)
  materials.md             -- 配色体系 + 房间基准表 (中文说明)

坐标约定 (由本脚本实测校验, 与 extract_furniture.py 一致):
  * 1 GLB 单位 = 10 mm; GLB 与 ViewData.json 共用同一"平面"坐标系, 但**Y 轴反向**:
        GLB_X_mm =  ViewData_X * 10
        GLB_Z_mm = -ViewData_Y * 10
    (ViewData 的 Y 是"平面图向上", GLB 的 Z 是"平面图向下")
  * GLB 的 Y 轴竖直向上: 地坪 Y=0, 顶棚 Y=280 (=2800mm)。
  * 平面图 plan-123kanfang.png 是 GLB 场景 XZ 包围盒的 1:1 正投影 (1 px = 10 mm),
    标定式由脚本自动求解 (见 calibrate_plan()), 并用墙线吻合率自检。

用法:
  python3 extract_rooms_materials.py            # 生成 rooms.json + materials.json + materials.md
  python3 extract_rooms_materials.py --check    # 只跑一遍打印统计, 不写文件

依赖:
  * 仅标准库即可运行房间/材质几何部分。
  * 需要 Pillow (PIL) 读取 plan-123kanfang.png 与 GLB 内嵌贴图 JPEG; 缺失时
    贴图平均色与像素坐标会写 null 并在 md 中说明原因。
  * 需要 numpy 才能用向量化三角形面积算法; 缺失时自动退回纯 Python 实现。
"""

import argparse
import datetime
import hashlib
import json
import math
import os
import struct
import sys
import urllib.request
from collections import defaultdict

try:
    import numpy as _np
except Exception:                                    # pragma: no cover
    _np = None

try:
    from PIL import Image as _Image
except Exception:                                    # pragma: no cover
    _Image = None


HERE = os.path.dirname(os.path.abspath(__file__))
SRC_DIR = os.path.normpath(os.path.join(HERE, ".."))
GLB_PATH = os.path.join(SRC_DIR, "floordata0.glb")
VIEWDATA_PATH = os.path.join(SRC_DIR, "ViewData.json")
PLAN_PNG_PATH = os.path.join(SRC_DIR, "plan-123kanfang.png")
ROOMS_JSON = os.path.join(HERE, "rooms.json")
MATERIALS_JSON = os.path.join(HERE, "materials.json")
MATERIALS_MD = os.path.join(HERE, "materials.md")

UNIT_MM = 10.0
GLB_MAGIC = 0x46546C67
CHUNK_JSON = 0x4E4F534A
CHUNK_BIN = 0x004E4942
M2_PER_UNIT2 = (UNIT_MM / 1000.0) ** 2      # 1 GLB 单位^2 = 0.0001 ㎡

# 公开分享链接 (只取公开可访问的参数, 不登录、不绕过任何访问控制)
SHARE_LINK_GUID = "16836619"
SHARE_LINK_PAGE = "https://webresource.123kanfang.com/livedeco/diy2d-v2/index.html?id=%s" % SHARE_LINK_GUID
SHARE_LINK_API = ("https://decogateway.123kanfang.com/shareLinks/ShareLinks/GetParams"
                  "?guid=%s&alwaysReturn=true" % SHARE_LINK_GUID)
# 2026-10-21 抓取到的公开参数 (在线抓取失败时作为缓存回退)
SHARE_LINK_CACHE = {
    "hid": "whyjyzs-3_1e52a61365ff4704854603010c6e07b3",
    "domain": "//livedeco.oss-cn-shanghai.aliyuncs.com/",
    "bucket": "livedeco",
    "taskID": "2453652",
    "datatype": "floorplandata",
    "pc": "1",
    "styleName": "Italian_1311",
    "userGuid": "6b3724c7763140f28599b4495a1c09f8",
    "companyName": "武汉一家一欧标装饰工程有限公司",
    "houseName": "复制-城投南山长投.领峯",
    "taskIDs": "2453652",
}

# --------------------------------------------------------------------------
# 原始户型房间命名 (2026-10-21 lead 决定) + 123kanfang 方案命名
# key = ViewData Room ID
#   (原始户型名, 123kanfang 方案名, english_id, 是否推断/待确认)
# --------------------------------------------------------------------------
ROOM_NAME_MAP = {
    "mCOSmg5M": ("主卧", "主卧", "master_bedroom", False),
    "f1qYqHqH": ("北次卧", "次卧", "north_bedroom", True),
    "g3cnKYnd": ("南次卧", "次卧", "south_bedroom", True),
    "eHaXGv38": ("客厅", "客餐厅", "living_room", False),
    "XrCzEEni": ("储物间/多功能角", "书房", "utility", True),
    "EX4vhDXo": ("主卫", "卫生间", "master_bathroom", True),
    "qOPrZ97W": ("公卫", "卫生间", "guest_bathroom", True),
    "WFGji10I": ("厨房", "厨房", "kitchen", False),
    "z5u59ReE": ("生活阳台", "生活阳台", "living_balcony", False),
}

# ViewData RoomAreas (子区) 的原始户型命名
SUBNAME = {
    "G5tPo97X": "客厅区",
    "BWEQNlBP": "过道区",
    "FN31QZXk": "盥洗区",
    "Mday4YkJ": "玄关区",
}

ROOM_NOTES = {
    "eHaXGv38": "客餐厅一体化 (LDK): 北侧起居 (沙发 M_多人沙发_* / 茶几 / 地毯, GLB Z −331.7…−69) + "
                "南侧餐区 (餐桌 M_餐桌_* + 餐椅×4, GLB X 234…316, Z 72…260)。"
                "『客厅·LDK 餐厅区』是按 客厅区 polygon 在 Z=52.97 (储物间北墙线) 处切分出来的派生分区, "
                "不是独立房间; 第一版不另立『餐厅』。玄关柜/酒柜/装饰柜贴东墙 (X≈465…500)。",
    "mCOSmg5M": "主卧: 西侧 X −791.5…−460.5, 北侧 Z −428.5…53.0; 与主卫 EX4vhDXo 共墙 (Z 52.97…65.97)。",
    "f1qYqHqH": "北次卧 (客卧位): 面积 10.07㎡ 为两个次卧中较大者, 与主卧共墙 (X −462.5…−460.5), "
                 "内含衣柜/装饰画/地毯而无书桌 ⇒ 判定为客卧位。123kanfang 侧名称同样叫『次卧』, 属推断。",
    "g3cnKYnd": "南次卧 (次卧位): 面积 9.40㎡, 位于主卧南侧; 内含『衣柜带转角书桌』+ 单椅 ⇒ 带书桌功能, "
                 "判定为次卧/书房型。123kanfang 侧名称同样叫『次卧』, 属推断。",
    "EX4vhDXo": "主卫: 4.00㎡, 直接紧贴主卧南侧 (共墙 Z 52.97…65.97), 内含 8 组浴室柜 + 马桶 + 地漏 + 暖风浴霸 "
                "⇒ 为主卧套卫。",
    "qOPrZ97W": "公卫: 2.13㎡, 仅马桶 + 地漏, 紧邻盥洗区/过道, 与主卧、主卫均不相邻 ⇒ 为公共卫生间。",
    "XrCzEEni": "原始户型命名『储物间/多功能角』, 尺寸 1.99×3.30 m (19925×32975 mm)。"
                "与公卫 qOPrZ97W 共用同一段墙 (X −161.5…−139.5 墙带), 动线上是入户过渡区。"
                "原始户型待现场照片确认; 123kanfang 方案将此处改为电竞房 (推拉门 + 电竞椅×2 + 背景墙)。"
                "方案内实为电竞房: 西墙贴 M_电竞房背景墙_* 背景墙, 内含 2 组 760×1130×740 mm 桌台 (GLB 节点 173/174)。",
    "WFGji10I": "厨房: 5.33㎡, 位于东南角 (GLB X 83.75…324.5, Z 343.97…565.47), 沿东/南两侧布置厨柜。",
    "z5u59ReE": "生活阳台: 8.54㎡, 位于北端 (GLB Z −526.03…−392.53), 含阳台洗衣机柜 (X 439.7…499.8)。",
}

# 派生分区 (非 ViewData 房间)
DERIVED_NOTES = {
    "LDK_dining": "由 客厅区 polygon 在 Z=52.97 (客厅区南侧凹口 = 储物间北墙) 处切分得到的南半部分。"
                  "该切分线同时落在『沙发组 (Z ≤ −56)』与『餐桌组 (Z ≥ 72)』之间的空档里, "
                  "所以切分结果与家具布置自洽。面积由 shoelace 对切分后多边形复算。",
}


# ==========================================================================
# GLB 解析
# ==========================================================================
class Glb:
    """最小 glTF 2.0 二进制解析器。"""

    _COMP = {5120: ("b", 1), 5121: ("B", 1), 5122: ("h", 2),
             5123: ("H", 2), 5125: ("I", 4), 5126: ("f", 4)}
    _NCOMP = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}

    def __init__(self, path):
        with open(path, "rb") as fh:
            self.raw = fh.read()
        self.gltf, self.bin_chunk = self._parse_chunks()

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
        gltf, bin_chunk, off = None, b"", 12
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

    # -- accessor ---------------------------------------------------------
    def accessor(self, index):
        """返回 (numpy 数组或 list, accessor 字典)。"""
        acc = self.gltf["accessors"][index]
        view = self.gltf["bufferViews"][acc["bufferView"]]
        ncomp = self._NCOMP[acc["type"]]
        fmt, size = self._COMP[acc["componentType"]]
        base = view.get("byteOffset", 0) + acc.get("byteOffset", 0)
        count = acc["count"]
        stride = view.get("byteStride") or (ncomp * size)
        if _np is not None:
            if stride == ncomp * size:
                arr = _np.frombuffer(self.bin_chunk, dtype=_np.dtype(fmt).newbyteorder("<"),
                                    count=count * ncomp, offset=base).reshape(count, ncomp)
            else:
                raw = _np.frombuffer(self.bin_chunk, dtype=_np.uint8, offset=base,
                                     count=(count - 1) * stride + ncomp * size)
                arr = _np.lib.stride_tricks.as_strided(
                    raw, shape=(count, ncomp * size), strides=(stride, 1)).copy()
                arr = arr.view(_np.dtype(fmt).newbyteorder("<")).reshape(count, ncomp)
            return arr, acc
        out = []
        if stride == ncomp * size:
            vals = struct.unpack_from("<%d%s" % (count * ncomp, fmt), self.bin_chunk, base)
            for i in range(count):
                o = i * ncomp
                out.append(tuple(vals[o:o + ncomp]))
        else:
            for i in range(count):
                out.append(struct.unpack_from("<%d%s" % (ncomp, fmt), self.bin_chunk,
                                             base + i * stride))
        return out, acc

    def indices(self, index):
        arr, acc = self.accessor(index)
        if _np is not None:
            return list(arr.reshape(-1))
        return [int(v[0]) for v in arr]


# -- 4x4 矩阵 (列主序, glTF 规范) ----------------------------------------
def mat4_identity():
    return [1.0, 0, 0, 0, 0, 1.0, 0, 0, 0, 0, 1.0, 0, 0, 0, 0, 1.0]


def mat4_mul(a, b):
    out = [0.0] * 16
    for c in range(4):
        b0, b1, b2, b3 = b[c * 4], b[c * 4 + 1], b[c * 4 + 2], b[c * 4 + 3]
        for r in range(4):
            out[c * 4 + r] = a[r] * b0 + a[4 + r] * b1 + a[8 + r] * b2 + a[12 + r] * b3
    return out


def quat_to_mat4(q):
    x, y, z, w = q
    xx, yy, zz = x * x, y * y, z * z
    xy, xz, yz = x * y, x * z, y * z
    wx, wy, wz = w * x, w * y, w * z
    return [
        1 - 2 * (yy + zz), 2 * (xy - wz), 2 * (xz + wy), 0,
        2 * (xy + wz), 1 - 2 * (xx + zz), 2 * (yz - wx), 0,
        2 * (xz - wy), 2 * (yz + wx), 1 - 2 * (xx + yy), 0,
        0, 0, 0, 1,
    ]


def node_local_matrix(node):
    if "matrix" in node:
        return list(node["matrix"])
    t = node.get("translation", [0.0, 0.0, 0.0])
    r = node.get("rotation", [0.0, 0.0, 0.0, 1.0])
    s = node.get("scale", [1.0, 1.0, 1.0])
    rot = quat_to_mat4(r)
    out = list(rot)
    for c in range(3):
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


def world_np(m):
    """列主序 16 元矩阵 -> numpy 4x4 (行主序)。"""
    return _np.asarray(m, dtype=float).reshape(4, 4).T


# ==========================================================================
# 多边形工具
# ==========================================================================
def shoelace_area_m2(poly_mm):
    """有符号面积 (㎡), 输入单位 mm。"""
    if len(poly_mm) < 3:
        return 0.0
    s = 0.0
    n = len(poly_mm)
    for i in range(n):
        x1, y1 = poly_mm[i]
        x2, y2 = poly_mm[(i + 1) % n]
        s += x1 * y2 - x2 * y1
    return abs(s) / 2.0 / (1000.0 * 1000.0)


def clip_halfplane_z(poly, value, keep_ge):
    """Sutherland–Hodgman: 用直线 z=value 切多边形, keep_ge=True 取 z>=value 一侧。"""
    out = []
    n = len(poly)
    if n == 0:
        return out
    for i in range(n):
        a = poly[i]
        b = poly[(i + 1) % n]
        ain = (a[1] >= value) if keep_ge else (a[1] <= value)
        bin_ = (b[1] >= value) if keep_ge else (b[1] <= value)
        if ain:
            out.append(a)
        if ain != bin_ and abs(b[1] - a[1]) > 1e-9:
            t = (value - a[1]) / (b[1] - a[1])
            out.append((a[0] + (b[0] - a[0]) * t, value))
    return out


# ==========================================================================
# 材质用途推断
# ==========================================================================
# (关键词, 用途标签); 先匹配先命中, 顺序即优先级
USAGE_RULES = [
    ("踢脚", "门/踢脚线"),
    ("门套", "门/踢脚线"),
    ("垭口", "门/踢脚线"),
    ("入户门", "门/踢脚线"),
    ("平开门", "门/踢脚线"),
    ("门窗", "门/踢脚线"),
    ("木饰面", "木饰面"),
    ("背景墙", "木饰面/背景墙"),
    ("墙面", "墙面"),
    ("乳胶漆", "墙面"),
    ("墙漆", "墙面"),
    ("硅藻泥", "墙面"),
    ("石膏", "墙面"),
    ("壁纸", "墙面"),
    ("墙布", "墙面"),
    ("护墙板", "墙面"),
    ("木地板", "地板"),
    ("地板", "地板"),
    ("地面", "地板"),
    ("地砖", "陶瓷(地/墙砖)"),
    ("通体砖", "陶瓷(地/墙砖)"),
    ("瓷砖", "陶瓷(地/墙砖)"),
    ("岩板", "陶瓷(地/墙砖)"),
    ("石材", "陶瓷(地/墙砖)"),
    ("洁具", "陶瓷/洁具"),
    ("马桶", "陶瓷/洁具"),
    ("洗手台", "陶瓷/洁具"),
    ("台面", "陶瓷/洁具"),
    ("水槽", "陶瓷/洁具"),
    ("浴霸", "陶瓷/洁具"),
    ("花洒", "陶瓷/洁具"),
    ("浴室柜", "柜体"),
    ("厨柜", "柜体"),
    ("橱柜", "柜体"),
    ("衣柜", "柜体"),
    ("组合柜", "柜体"),
    ("玄关柜", "柜体"),
    ("装饰柜", "柜体"),
    ("酒柜", "柜体"),
    ("床头柜", "柜体"),
    ("吊柜", "柜体"),
    ("书柜", "柜体"),
    ("鞋柜", "柜体"),
    ("柜", "柜体"),
    ("板材", "柜体"),
    ("地毯", "软包/织物"),
    ("沙发", "软包/织物"),
    ("单椅", "软包/织物"),
    ("休闲椅", "软包/织物"),
    ("窗帘", "软包/织物"),
    ("单帘", "软包/织物"),
    ("纱帘", "软包/织物"),
    ("床", "软包/织物"),
    ("绒布", "软包/织物"),
    ("皮革", "软包/织物"),
    ("布艺", "软包/织物"),
    ("软包", "软包/织物"),
    ("靠垫", "软包/织物"),
    ("金属", "金属"),
    ("不锈钢", "金属"),
    ("铜", "金属"),
    ("铝", "金属"),
    ("铁", "金属"),
    ("塑料", "金属/塑料"),
    ("玻璃", "玻璃"),
    ("普通窗", "门窗框/五金"),
    ("窗户压条", "门窗框/五金"),
    ("压条", "门窗框/五金"),
    ("灯", "灯具/光源"),
    ("发光", "灯具/光源"),
    ("自发光", "灯具/光源"),
    ("装饰画", "装饰画"),
    ("空调", "设备/风口"),
    ("风口", "设备/风口"),
    ("插座", "设备/风口"),
    ("开关", "设备/风口"),
    ("冰箱", "电器"),
    ("咖啡机", "电器"),
    ("微波炉", "电器"),
    ("烤箱", "电器"),
    ("燃气灶", "电器"),
    ("热水器", "电器"),
    ("餐桌", "家具"),
    ("茶几", "家具"),
    ("凳子", "家具"),
    ("书桌", "家具"),
    ("桌", "家具"),
    ("椅", "家具"),
]

# 资产节点名 (SM_xxx) -> 用途
ASSET_RULES = [
    ("地毯", "软包/织物"),
    ("沙发", "软包/织物"),
    ("单椅", "软包/织物"),
    ("休闲椅", "软包/织物"),
    ("窗帘", "软包/织物"),
    ("床", "家具"),
    ("厨柜", "柜体"),
    ("烤箱柜", "柜体"),
    ("衣柜", "柜体"),
    ("玄关柜", "柜体"),
    ("装饰柜", "柜体"),
    ("酒柜", "柜体"),
    ("床头柜", "柜体"),
    ("组合柜", "柜体"),
    ("浴室柜", "柜体"),
    ("吊柜", "柜体"),
    ("平开门", "门/踢脚线"),
    ("门套", "门/踢脚线"),
    ("入户门", "门/踢脚线"),
    ("马桶", "陶瓷/洁具"),
    ("洗手台", "陶瓷/洁具"),
    ("灶台", "电器"),
    ("燃气灶", "电器"),
    ("水槽", "陶瓷/洁具"),
    ("地漏", "设备/风口"),
    ("暖风浴霸", "设备/风口"),
    ("吸顶灯", "灯具/光源"),
    ("吊灯", "灯具/光源"),
    ("落地灯", "灯具/光源"),
    ("壁灯", "灯具/光源"),
    ("格栅灯", "灯具/光源"),
    ("装饰画", "装饰画"),
    ("茶几", "家具"),
    ("餐桌", "家具"),
    ("凳子", "家具"),
    ("椅", "家具"),
    ("书桌", "家具"),
]


def guess_usage_from_name(name):
    if not name:
        return None
    for key, label in USAGE_RULES:
        if key in name:
            return label
    return None


def guess_usage_from_asset(asset):
    if not asset:
        return None
    for key, label in ASSET_RULES:
        if key in asset:
            return label
    return None


def hex_of(rgb):
    def c(v):
        v = int(round(max(0.0, min(1.0, v)) * 255.0))
        return "%02X" % v
    return "#" + c(rgb[0]) + c(rgb[1]) + c(rgb[2])


def display_name(name, index):
    """GLB 里大量材质名是 '1' / 空, 显示时补一个可辨识的标签。"""
    if name and name.strip() and name.strip() != "1":
        return name
    return "未命名材质#%d" % index


# ==========================================================================
# 贴图平均色
# ==========================================================================
def image_stats(data, mime):
    """返回 (宽, 高, 平均色 sRGB 0-1, 主色 sRGB 0-1) 或 (None, None, None, None)。"""
    if _Image is None:
        return None, None, None, None
    import io
    try:
        im = _Image.open(io.BytesIO(data)).convert("RGB")
        w, h = im.size
        small = im.resize((min(48, w), min(48, h)))
        if _np is not None:
            arr = _np.asarray(small, dtype=float) / 255.0
            mean = arr.reshape(-1, 3).mean(axis=0)
            q = _np.round(arr * 12).astype(int).reshape(-1, 3)
            uniq, counts = _np.unique(q, axis=0, return_counts=True)
            best = uniq[int(_np.argmax(counts))] / 12.0
            return w, h, [float(x) for x in mean], [float(x) for x in best]
        px = list(small.getdata())
        n = len(px)
        mean = [sum(p[i] for p in px) / n / 255.0 for i in range(3)]
        return w, h, mean, mean
    except Exception as exc:                                    # pragma: no cover
        print("[warn] 贴图解码失败 (%s): %s" % (mime, exc))
        return None, None, None, None


# ==========================================================================
# 公开分享链接参数
# ==========================================================================
def fetch_share_link_params():
    """抓取公开分享链接参数 (只读公开接口)。失败则用缓存。"""
    out = {
        "share_page": SHARE_LINK_PAGE,
        "api_endpoint": SHARE_LINK_API,
        "retrieved_at_utc": datetime.datetime.utcnow().isoformat(timespec="seconds") + "Z",
        "access_note": "公开分享链接, 未登录、未绕过任何访问控制; 只读取公开参数",
    }
    try:
        req = urllib.request.Request(SHARE_LINK_API, headers={"Accept": "application/json",
                                                              "User-Agent": "home-design-archiver/1.0"})
        with urllib.request.urlopen(req, timeout=20) as resp:
            body = json.loads(resp.read().decode("utf-8"))
        payload = body.get("payload") or {}
        params = {}
        for part in (payload.get("parameters") or "").lstrip("?").split("&"):
            if "=" in part:
                k, v = part.split("=", 1)
                params[k] = v
        out["parameters_raw"] = payload.get("parameters")
        out["parameters"] = params
        out["status"] = "live"
        return out
    except Exception as exc:
        out["status"] = "cached"
        out["error"] = "%s: %s" % (type(exc).__name__, exc)
        out["parameters_raw"] = "?" + "&".join("%s=%s" % (k, v) for k, v in SHARE_LINK_CACHE.items())
        out["parameters"] = dict(SHARE_LINK_CACHE)
        return out


# ==========================================================================
# 主流程
# ==========================================================================
def sha256_of(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for blk in iter(lambda: fh.read(1 << 20), b""):
            h.update(blk)
    return h.hexdigest()


def build():
    glb = Glb(GLB_PATH)
    g = glb.gltf
    nodes = g["nodes"]
    meshes = g["meshes"]
    mats = g["materials"]
    textures = g.get("textures", [])
    images = g.get("images", [])
    buffer_views = g.get("bufferViews", [])

    with open(VIEWDATA_PATH, "r", encoding="utf-8") as fh:
        viewdata = json.load(fh)
    floor = viewdata["Floors"][0]

    # ------------------------------------------------------------------
    # 1) 节点遍历: 世界矩阵 / 房间归属 / 几何包围盒
    # ------------------------------------------------------------------
    room_of_node = {}
    node_world = {}
    node_bbox = {}
    scene_min = [float("inf")] * 3
    scene_max = [float("-inf")] * 3

    def walk(node_index, parent, room_name):
        node = nodes[node_index]
        world = mat4_mul(parent, node_local_matrix(node))
        name = node.get("name") or ""
        if name.startswith("Room-"):
            room_name = name
        room_of_node[node_index] = room_name
        node_world[node_index] = world
        mesh_index = node.get("mesh")
        if mesh_index is not None:
            mn = [float("inf")] * 3
            mx = [float("-inf")] * 3
            for prim in meshes[mesh_index].get("primitives", []):
                attr = prim.get("attributes", {}).get("POSITION")
                if attr is None:
                    continue
                pos, _ = glb.accessor(attr)
                if _np is not None:
                    W = world_np(world)
                    pts = (W[:3, :3] @ _np.asarray(pos).T).T + W[:3, 3]
                    mn = [min(mn[i], float(pts[:, i].min())) for i in range(3)]
                    mx = [max(mx[i], float(pts[:, i].max())) for i in range(3)]
                else:
                    for p in pos:
                        w = transform_point(world, p)
                        for i in range(3):
                            mn[i] = min(mn[i], w[i])
                            mx[i] = max(mx[i], w[i])
            node_bbox[node_index] = (mn, mx)
            for i in range(3):
                scene_min[i] = min(scene_min[i], mn[i])
                scene_max[i] = max(scene_max[i], mx[i])
        for child in node.get("children", []):
            walk(child, world, room_name)

    for root in g["scenes"][0]["nodes"]:
        walk(root, mat4_identity(), None)

    # ------------------------------------------------------------------
    # 2) 材质面积 (世界空间三角形面积) + 归属房间 + 几何姿态分类
    # ------------------------------------------------------------------
    mat_area = defaultdict(float)
    mat_rooms = defaultdict(set)
    mat_nodes = defaultdict(set)
    mat_arch = defaultdict(float)
    mat_furn = defaultdict(float)
    mat_orient = defaultdict(lambda: defaultdict(float))
    # 关键字 -> 世界包围盒 (用于派生分区锚点)
    keyword_bbox = defaultdict(lambda: ([float("inf")] * 3, [float("-inf")] * 3))

    for node_index, node in enumerate(nodes):
        mesh_index = node.get("mesh")
        if mesh_index is None:
            continue
        world = node_world[node_index]
        room = room_of_node.get(node_index) or ""
        asset = node.get("name") or ""
        is_arch = asset.startswith("Section-") or asset.startswith("MergedMesh_")
        for prim in meshes[mesh_index].get("primitives", []):
            if prim.get("mode", 4) != 4:
                continue
            mi = prim.get("material")
            attr = prim.get("attributes", {}).get("POSITION")
            if attr is None or mi is None:
                continue
            pos, _ = glb.accessor(attr)
            if "indices" in prim:
                idx = glb.indices(prim["indices"])
            else:
                idx = list(range(len(pos)))
            if len(idx) < 3:
                continue
            mname = mats[mi].get("name") or ""
            if _np is not None:
                W = world_np(world)
                P = (W[:3, :3] @ _np.asarray(pos).T).T + W[:3, 3]
                I = _np.asarray(idx, dtype=_np.int64).reshape(-1, 3)
                a, b, c = P[I[:, 0]], P[I[:, 1]], P[I[:, 2]]
                area = 0.5 * _np.linalg.norm(_np.cross(b - a, c - a), axis=1).sum()
                area_m2 = float(area) * M2_PER_UNIT2
                ymin = float(P[:, 1].min())
                ymax = float(P[:, 1].max())
                pmin = P.min(axis=0).tolist()
                pmax = P.max(axis=0).tolist()
            else:
                pts = [transform_point(world, tuple(p)) for p in pos]
                tot = 0.0
                for k in range(0, len(idx) - 2, 3):
                    p0, p1, p2 = pts[idx[k]], pts[idx[k + 1]], pts[idx[k + 2]]
                    u = (p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2])
                    v = (p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2])
                    cx = u[1] * v[2] - u[2] * v[1]
                    cy = u[2] * v[0] - u[0] * v[2]
                    cz = u[0] * v[1] - u[1] * v[0]
                    tot += 0.5 * math.sqrt(cx * cx + cy * cy + cz * cz)
                area_m2 = tot * M2_PER_UNIT2
                ymin = min(p[1] for p in pts)
                ymax = max(p[1] for p in pts)
                pmin = [min(p[i] for p in pts) for i in range(3)]
                pmax = [max(p[i] for p in pts) for i in range(3)]
            mat_area[mi] += area_m2
            if room:
                mat_rooms[mi].add(room)
            if asset:
                mat_nodes[mi].add(asset)
            if is_arch:
                mat_arch[mi] += area_m2
            else:
                mat_furn[mi] += area_m2
            if (ymax - ymin) <= 0.05:
                if abs(ymin) <= 0.6:
                    mat_orient[mi]["地面(水平, Y≈0)"] += area_m2
                elif abs(ymin - 280.0) <= 2.0:
                    mat_orient[mi]["顶棚(水平, Y≈280)"] += area_m2
                else:
                    mat_orient[mi]["水平板件"] += area_m2
            else:
                mat_orient[mi]["竖直/立体"] += area_m2
            for kw in ("餐桌", "沙发", "茶几", "地毯"):
                if kw in mname:
                    kb = keyword_bbox[kw]
                    for i in range(3):
                        kb[0][i] = min(kb[0][i], pmin[i])
                        kb[1][i] = max(kb[1][i], pmax[i])

    # ------------------------------------------------------------------
    # 3) 贴图平均色
    # ------------------------------------------------------------------
    tex_stats = {}
    for ti, tex in enumerate(textures):
        src = tex.get("source")
        if src is None or src >= len(images):
            continue
        img = images[src]
        bv_index = img.get("bufferView")
        if bv_index is None:
            continue
        bv = buffer_views[bv_index]
        base = bv.get("byteOffset", 0)
        length = bv.get("byteLength", 0)
        data = glb.bin_chunk[base:base + length]
        w, h, mean, dom = image_stats(data, img.get("mimeType", "?"))
        tex_stats[ti] = {
            "texture_index": ti,
            "image_index": src,
            "image_name": img.get("name") or ("image_%03d.%s" % (
                src, "jpg" if "jpeg" in img.get("mimeType", "") else "bin")),
            "mime_type": img.get("mimeType"),
            "byte_length": length,
            "width_px": w,
            "height_px": h,
            "avg_color_srgb": mean,
            "avg_color_hex": hex_of(mean) if mean else None,
            "dominant_color_hex": hex_of(dom) if dom else None,
        }

    # ------------------------------------------------------------------
    # 4) 平面图标定
    # ------------------------------------------------------------------
    plan = calibrate_plan(scene_min, scene_max)

    # ------------------------------------------------------------------
    # 5) 房间基准表
    # ------------------------------------------------------------------
    room_node_index = {}
    for i, node in enumerate(nodes):
        nm = node.get("name") or ""
        if nm.startswith("Room-"):
            room_node_index[nm] = i

    def mm(v):
        return round(v * UNIT_MM, 2)

    def room_world_bbox(room_name):
        mn = [float("inf")] * 3
        mx = [float("-inf")] * 3
        for idx, rn in room_of_node.items():
            if rn != room_name or idx not in node_bbox:
                continue
            bmn, bmx = node_bbox[idx]
            for i in range(3):
                mn[i] = min(mn[i], bmn[i])
                mx[i] = max(mx[i], bmx[i])
        return mn, mx

    hotspots = {h["ID"]: h for h in viewdata.get("HotSpots", [])}
    rooms_out = []
    sub_areas_out = []
    ldk_entry = None

    for room in floor["Rooms"]:
        rid = room["ID"]
        rname = room["Name"]
        areas = room.get("RoomAreas", []) or []
        polys = []
        for ra in areas:
            poly_vd = [[p["X"], p["Y"]] for p in ra["polygon"]]
            poly_glb_mm = [[mm(p[0]), mm(-p[1])] for p in poly_vd]
            xs = [p[0] for p in poly_vd]
            ys = [p[1] for p in poly_vd]
            bbox = {
                "x_min_mm": mm(min(xs)), "x_max_mm": mm(max(xs)),
                "z_min_mm": mm(-max(ys)), "z_max_mm": mm(-min(ys)),
            }
            bbox["width_mm"] = round(bbox["x_max_mm"] - bbox["x_min_mm"], 2)
            bbox["depth_mm"] = round(bbox["z_max_mm"] - bbox["z_min_mm"], 2)
            px_pts = [plan["to_px"](p[0], -p[1]) for p in poly_vd]
            poly_px = [[round(a, 1), round(b, 1)] for a, b in px_pts] if plan["available"] else []
            xs_p = [q[0] for q in poly_px] or [0]
            ys_p = [q[1] for q in poly_px] or [0]
            sub = {
                "id_viewdata": ra["ID"],
                "name_original_plan": (ROOM_NAME_MAP.get(rid, (rname,))[0] if len(areas) == 1
                                       else SUBNAME.get(ra["ID"], ra["Name"])),
                "name_123kanfang": ra["Name"],
                "room_id_viewdata": rid,
                "room_name_123kanfang": rname,
                "hotspot_ids": ra.get("HotSpotIds", []),
                "net_bbox_mm": bbox,
                "area_m2_recomputed_shoelace": round(shoelace_area_m2(poly_glb_mm), 4),
                "net_polygon_glb_mm": [[round(a, 2), round(b, 2)] for a, b in poly_glb_mm],
                "plan_pixels": ({
                    "bbox": {"x_min": round(min(xs_p), 1), "x_max": round(max(xs_p), 1),
                             "y_min": round(min(ys_p), 1), "y_max": round(max(ys_p), 1)},
                    "polygon": poly_px,
                    "boundary_wall_ink_match_ratio": plan["boundary_match"](poly_glb_mm),
                } if plan["available"] else None),
            }
            sub_areas_out.append(sub)
            polys.append(poly_glb_mm)

        all_pts = [p for poly in polys for p in poly]
        if all_pts:
            net_bbox = {
                "x_min_mm": round(min(p[0] for p in all_pts), 2),
                "x_max_mm": round(max(p[0] for p in all_pts), 2),
                "z_min_mm": round(min(p[1] for p in all_pts), 2),
                "z_max_mm": round(max(p[1] for p in all_pts), 2),
            }
            net_bbox["width_mm"] = round(net_bbox["x_max_mm"] - net_bbox["x_min_mm"], 2)
            net_bbox["depth_mm"] = round(net_bbox["z_max_mm"] - net_bbox["z_min_mm"], 2)
        else:
            net_bbox = None

        glb_name = "Room-%s-%s" % (rname, rid)
        ni = room_node_index.get(glb_name)
        if ni is not None:
            wmn, wmx = room_world_bbox(glb_name)
            world_bbox = {
                "x_min_mm": mm(wmn[0]), "x_max_mm": mm(wmx[0]),
                "y_min_mm": mm(wmn[1]), "y_max_mm": mm(wmx[1]),
                "z_min_mm": mm(wmn[2]), "z_max_mm": mm(wmx[2]),
            }
            world_bbox["width_mm"] = round(world_bbox["x_max_mm"] - world_bbox["x_min_mm"], 2)
            world_bbox["height_mm"] = round(world_bbox["y_max_mm"] - world_bbox["y_min_mm"], 2)
            world_bbox["depth_mm"] = round(world_bbox["z_max_mm"] - world_bbox["z_min_mm"], 2)
            glb_children = [nodes[c].get("name") for c in nodes[ni].get("children", [])]
        else:
            world_bbox = None
            glb_children = []

        name_org, name_kf, english_id, inferred = ROOM_NAME_MAP.get(
            rid, (rname, rname, "unknown", True))

        rec = {
            "id_viewdata": rid,
            "english_id": english_id,
            "name_original_plan": name_org,
            "name_123kanfang": rname,
            "name_needs_confirmation": inferred,
            "area_m2": room.get("Area"),
            "area_source": "ViewData.json Rooms[].Area",
            "room_height_units": room.get("RoomHeight"),
            "net_bbox_mm": net_bbox,
            "net_bbox_scope": ("union of all RoomAreas" if len(polys) > 1
                               else "the single RoomArea (== room outline)"),
            "net_polygon_glb_mm": [[round(a, 2), round(b, 2)] for a, b in polys[0]] if polys else [],
            "world_bbox_mm": world_bbox,
            "glb_node": {"index": ni, "name": glb_name, "child_groups": glb_children},
            "plan_pixels": plan["room_pixels"](polys),
            "hotspot_ids": room.get("HotSpotIds", []),
            "hotspots": [hotspots[h] for h in room.get("HotSpotIds", []) if h in hotspots],
            "notes": ROOM_NOTES.get(rid, ""),
        }
        rooms_out.append(rec)

        # ---- 派生条目: 客厅·LDK 餐厅区 -------------------------------------
        if rid == "eHaXGv38":
            ldk = derive_ldk_dining(polys, keyword_bbox, plan, floor)
            ldk_entry = ldk

    # ------------------------------------------------------------------
    # 6) 材质表
    # ------------------------------------------------------------------
    order = sorted(mat_area.items(), key=lambda kv: -kv[1])
    rank = {mi: i + 1 for i, (mi, _a) in enumerate(order)}

    materials_out = []
    for mi in range(len(mats)):
        mat = mats[mi]
        pbr = mat.get("pbrMetallicRoughness", {}) or {}
        factor = pbr.get("baseColorFactor")
        bcf = None
        bcf_hex = None
        if factor:
            bcf = [round(float(v), 6) for v in factor]
            bcf_hex = hex_of(factor[:3])
        tex_info = None
        tex_avg = None
        if "baseColorTexture" in pbr:
            ti = pbr["baseColorTexture"].get("index")
            st = tex_stats.get(ti)
            if st:
                tex_info = dict(st)
                tex_avg = st["avg_color_srgb"]
        effective = None
        effective_hex = None
        if tex_avg:
            f = factor if factor else [1.0, 1.0, 1.0, 1.0]
            eff = [tex_avg[i] * f[i] for i in range(3)]
            effective = [round(v, 6) for v in eff]
            effective_hex = hex_of(eff)
        elif factor:
            effective = [round(float(v), 6) for v in factor[:3]]
            effective_hex = bcf_hex

        usage, reason = infer_usage(mat, mat_nodes.get(mi, set()), mat_orient.get(mi, {}),
                                    mat_arch.get(mi, 0.0), mat_furn.get(mi, 0.0))
        materials_out.append({
            "index": mi,
            "name": mat.get("name"),
            "display_name": display_name(mat.get("name"), mi),
            "base_color_factor": bcf,
            "base_color_hex": bcf_hex,
            "base_color_texture": tex_info,
            "has_texture": tex_info is not None,
            "effective_color_srgb": effective,
            "effective_color_hex": effective_hex,
            "metallic_factor": pbr.get("metallicFactor"),
            "roughness_factor": pbr.get("roughnessFactor"),
            "emissive_factor": mat.get("emissiveFactor"),
            "alpha_mode": mat.get("alphaMode", "OPAQUE"),
            "alpha_cutoff": mat.get("alphaCutoff"),
            "double_sided": bool(mat.get("doubleSided")),
            "extensions": sorted((mat.get("extensions") or {}).keys()),
            "usage": usage,
            "usage_reason": reason,
            "surface_area_m2": round(mat_area.get(mi, 0.0), 4),
            "area_rank": rank.get(mi),
            "area_architecture_m2": round(mat_arch.get(mi, 0.0), 4),
            "area_furniture_m2": round(mat_furn.get(mi, 0.0), 4),
            "orientation_area_m2": {k: round(v, 4) for k, v in
                                    sorted(mat_orient.get(mi, {}).items(), key=lambda kv: -kv[1])},
            "rooms": sorted(mat_rooms.get(mi, set())),
            "asset_nodes": sorted(mat_nodes.get(mi, set()))[:12],
        })

    top30 = sorted([m for m in materials_out if m["surface_area_m2"] > 0],
                    key=lambda m: -m["surface_area_m2"])[:30]
    scheme = build_color_scheme(materials_out)

    # ------------------------------------------------------------------
    # 7) 写文件
    # ------------------------------------------------------------------
    share = fetch_share_link_params()
    px_formula = plan["meta"].get("formula_px", "n/a")
    meta = {
        "generated_by": "extract_rooms_materials.py",
        "generated_at_utc": datetime.datetime.utcnow().isoformat(timespec="seconds") + "Z",
        "project": "城投南山长投·领峯 D143 (123kanfang 交互设计方案)",
        "role": "参考档案 —— 第一版工具只做『还原原始建筑测量图』, 本文件暂不直接显示",
        "sources": {
            "ViewData.json": {"path": "archive/floorplan-source/ViewData.json",
                              "sha256": sha256_of(VIEWDATA_PATH)},
            "floordata0.glb": {"path": "archive/floorplan-source/floordata0.glb",
                               "sha256": sha256_of(GLB_PATH),
                               "bytes": os.path.getsize(GLB_PATH)},
            "plan-123kanfang.png": {"path": "archive/floorplan-source/plan-123kanfang.png",
                                    "sha256": sha256_of(PLAN_PNG_PATH),
                                    "bytes": os.path.getsize(PLAN_PNG_PATH)},
        },
        "units": {
            "glb_unit_mm": UNIT_MM,
            "area_m2_per_glb_unit2": M2_PER_UNIT2,
            "note": "ViewData.Area 直接是 ㎡; 其余长度由 GLB 单位 ×10 得到 mm",
        },
        "coordinate_system": {
            "glb": "右手系, Y 轴竖直向上 (地坪 Y=0, 顶棚 Y=280 → 2800mm); X 向右为正, Z 向下(平面图南)为正",
            "viewdata_to_glb": "GLB_X_mm = ViewData_X × 10 ; GLB_Z_mm = −ViewData_Y × 10",
            "warning": "ViewData 的 Y 与 GLB 的 Z **方向相反** (ViewData Y 向上为正)。"
                       "『同坐标系』只对单位成立, 轴向需翻转。",
            "glb_scene_bbox_mm": {
                "x_min": mm(scene_min[0]), "x_max": mm(scene_max[0]),
                "y_min": mm(scene_min[1]), "y_max": mm(scene_max[1]),
                "z_min": mm(scene_min[2]), "z_max": mm(scene_max[2]),
            },
        },
        "plan_image_calibration": dict(plan["meta"]),
        "px_mm_conversion": {
            "formula": px_formula,
            "inverse": "X_glb = px − %.3f ; Z_glb = py − %.3f" % (
                plan["meta"].get("offset_px", {}).get("x", 0.0),
                plan["meta"].get("offset_px", {}).get("z", 0.0)),
            "scale": "1 px = 1 GLB 单位 = 10 mm",
            "origin": "图片左上角; x 向右, y 向下 (与 GLB 的 +Z 同向)",
            "note": "平面图是 123kanfang 的渲染图, 标定式由脚本自动求解并用墙线吻合率自检",
        },
        "share_link_public": share,
        "room_naming": {
            "policy": "主名使用原始户型命名; 同时保留 123kanfang 方案命名与两级 ID 供反查",
            "decided_by": "lead, 2026-10-21",
            "map": {k: {"name_original_plan": v[0], "name_123kanfang": v[1],
                        "english_id": v[2], "needs_confirmation": v[3]}
                    for k, v in ROOM_NAME_MAP.items()},
        },
        "notes": [
            "1. 命名以『原始户型』为准 (主卧/北次卧/南次卧/客厅/储物间·多功能角/厨房/生活阳台/公卫/主卫), "
            "『客厅·LDK 餐厅区』是客厅区内的派生分区, 不是独立房间; 第一版不另立『餐厅』。",
            "2. px↔mm 换算: %s" % px_formula,
            "3. ViewData→GLB 换算: GLB_X_mm = ViewData_X × 10 ; GLB_Z_mm = −ViewData_Y × 10。",
            "4. 公开分享链接参数 (可复用): %s" % share.get("parameters_raw"),
            "5. 两个『次卧』按位置/面积/家具判定为北次卧(客卧位)/南次卧(次卧位); "
            "两个『卫生间』按与主卧的相邻关系判定为主卫/公卫 —— 123kanfang 原始数据没有区分标签, 属推断。",
            "6. 储物间/多功能角 (6.57㎡) 的原始户型名待现场照片确认; "
            "123kanfang 方案将此处改为电竞房 (推拉门 + 电竞椅×2 + 背景墙)。",
            "7. 平面图 plan-123kanfang.png 是渲染图不是测量图, 不含尺寸标注, 不能替代原始户型测量图。",
        ],
        "hotspots_public": [
            {"id": h["ID"], "name": h["Name"], "room": room_of_hotspot(h, floor),
             "position": h.get("Position"), "camera_height": h.get("CameraHeight"),
             "thumbnail_path": h.get("ThumbnailPath"),
             "panorama_tile_paths": h.get("TileImagesPath", [])}
            for h in viewdata.get("HotSpots", [])
        ],
    }

    derived_rooms = [ldk_entry] if ldk_entry else []

    with open(ROOMS_JSON, "w", encoding="utf-8") as fh:
        json.dump({"meta": meta, "rooms": rooms_out,
                   "room_sub_areas": sub_areas_out,
                   "derived_rooms": derived_rooms},
                  fh, ensure_ascii=False, indent=2)

    with open(MATERIALS_JSON, "w", encoding="utf-8") as fh:
        json.dump({"meta": meta,
                   "material_count": len(materials_out),
                   "materials": materials_out,
                   "top30_by_area": top30,
                   "color_scheme": scheme},
                  fh, ensure_ascii=False, indent=2)

    write_md(meta, rooms_out, sub_areas_out, derived_rooms, materials_out, top30, scheme, plan)
    return meta, rooms_out, sub_areas_out, derived_rooms, materials_out, top30, scheme


# ==========================================================================
# 派生分区: 客厅·LDK 餐厅区
# ==========================================================================
def derive_ldk_dining(polys, keyword_bbox, plan, floor):
    """把 客厅区 polygon 在 Z=52.97 (储物间北墙线) 处切开, 取南半部分作为 LDK 餐区。"""
    if not polys:
        return None
    poly = polys[0]                       # mm, GLB 坐标 (x, z)
    z_split = 529.7                       # = 52.97 GLB 单位 × 10 mm
    south = clip_halfplane_z(poly, z_split, True)
    north = clip_halfplane_z(poly, z_split, False)
    if len(south) < 3:
        return None
    area = shoelace_area_m2(south)
    xs = [p[0] for p in south]
    zs = [p[1] for p in south]
    px_pts = [plan["to_px"](x / UNIT_MM, z / UNIT_MM) for x, z in south] if plan["available"] else []
    tb = keyword_bbox.get("餐桌")
    anchor = None
    if tb and tb[0][0] < float("inf"):
        anchor = {
            "anchor_object": "餐桌 (材质 M_餐桌_*)",
            "glb_bbox_mm": {
                "x_min": round(tb[0][0] * UNIT_MM, 1), "x_max": round(tb[1][0] * UNIT_MM, 1),
                "z_min": round(tb[0][2] * UNIT_MM, 1), "z_max": round(tb[1][2] * UNIT_MM, 1),
            },
        }
    return {
        "id_viewdata": None,
        "english_id": "living_dining_zone",
        "name_original_plan": "客厅·LDK 餐厅区",
        "name_123kanfang": "客厅区 (子分区)",
        "name_needs_confirmation": True,
        "derived": True,
        "derived_from": "客餐厅 eHaXGv38 / 客厅区 G5tPo97X polygon 按 Z=52.97 切分",
        "parent_room_id_viewdata": "eHaXGv38",
        "parent_room_name": "客厅",
        "area_m2": round(area, 3),
        "area_source": "切分后多边形 shoelace 复算 (非平台 Area 字段)",
        "net_bbox_mm": {
            "x_min_mm": round(min(xs), 1), "x_max_mm": round(max(xs), 1),
            "z_min_mm": round(min(zs), 1), "z_max_mm": round(max(zs), 1),
            "width_mm": round(max(xs) - min(xs), 1),
            "depth_mm": round(max(zs) - min(zs), 1),
        },
        "net_polygon_glb_mm": [[round(x, 2), round(z, 2)] for x, z in south],
        "plan_pixels": ({
            "bbox": {"x_min": round(min(p[0] for p in px_pts), 1),
                     "x_max": round(max(p[0] for p in px_pts), 1),
                     "y_min": round(min(p[1] for p in px_pts), 1),
                     "y_max": round(max(p[1] for p in px_pts), 1)},
            "polygon": [[round(a, 1), round(b, 1)] for a, b in px_pts],
            "boundary_wall_ink_match_ratio": plan["boundary_match"](south),
        } if plan["available"] else None),
        "sibling_area_m2": {
            "客厅 (北半部分)": round(shoelace_area_m2(north), 3),
        },
        "furniture_anchor": anchor,
        "notes": DERIVED_NOTES["LDK_dining"],
    }


def room_of_hotspot(hot, floor):
    for room in floor["Rooms"]:
        if hot["ID"] in room.get("HotSpotIds", []):
            return room["Name"]
        for ra in room.get("RoomAreas", []):
            if hot["ID"] in ra.get("HotSpotIds", []):
                return "%s/%s" % (room["Name"], ra["Name"])
    return None


# ==========================================================================
# 用途推断
# ==========================================================================
def infer_usage(mat, assets, orient, arch_area, furn_area):
    name = mat.get("name") or ""
    reasons = []
    usage = guess_usage_from_name(name)
    if usage:
        reasons.append("材质名『%s』命中关键词" % name)
    if not usage:
        counts = defaultdict(int)
        for a in assets:
            u = guess_usage_from_asset(a)
            if u:
                counts[u] += 1
        if counts:
            usage = max(counts.items(), key=lambda kv: kv[1])[0]
            reasons.append("按资产节点名推断 (%d 个节点)" % sum(counts.values()))
    if not usage:
        if orient:
            top = max(orient.items(), key=lambda kv: kv[1])
            if top[0].startswith("地面"):
                usage = "地板"
            elif top[0].startswith("顶棚"):
                usage = "顶棚"
            elif top[0] == "竖直/立体" and arch_area > furn_area:
                usage = "墙面/建筑构件"
            else:
                usage = "其他"
            reasons.append("按几何姿态推断 (建筑面 %.2f㎡ vs 家具面 %.2f㎡)" % (arch_area, furn_area))
    else:
        if arch_area > furn_area and usage != "地板":
            reasons.append("面积以建筑面为主 (%.2f㎡ / %.2f㎡)" % (arch_area, furn_area))
    if not usage:
        usage = "未判定"
        reasons.append("材质名与节点名均无关键词")
    return usage, "; ".join(reasons)


# ==========================================================================
# 配色方案
# ==========================================================================
def build_color_scheme(materials_out):
    """按用途挑出各分项的主色。取不到就写 null 并说明。"""
    by_usage = defaultdict(list)
    for m in materials_out:
        if m["surface_area_m2"] <= 0:
            continue
        by_usage[m["usage"]].append(m)

    def brief(m, value_fn=None):
        return {
            "material_index": m["index"],
            "material_name": m["name"],
            "material_display_name": m.get("display_name") or m["name"],
            "usage": m["usage"],
            "surface_area_m2": m["surface_area_m2"],
            "basis_area_m2": round(value_fn(m), 4) if value_fn else m["surface_area_m2"],
            "hex": m["effective_color_hex"],
            "base_color_hex": m["base_color_hex"],
            "texture_avg_hex": (m["base_color_texture"] or {}).get("avg_color_hex"),
            "has_texture": m["has_texture"],
            "note": None if m["effective_color_hex"] else "GLB 里既无 baseColorFactor 也无可用贴图均值, 无法取色",
        }

    def pick(usages, exclude_names=(), key=None, value_fn=None):
        cands = []
        for u in usages:
            for m in by_usage.get(u, []):
                if any(x in (m["name"] or "") for x in exclude_names):
                    continue
                cands.append(m)
        if not cands:
            return None
        cands.sort(key=key or (lambda m: -m["surface_area_m2"]))
        return brief(cands[0], value_fn)

    def palette(usages, n=5, key=None):
        cands = []
        for u in usages:
            cands.extend(by_usage.get(u, []))
        cands.sort(key=key or (lambda m: -m["surface_area_m2"]))
        return [brief(m) for m in cands[:n]]

    vertical = lambda m: m["orientation_area_m2"].get("竖直/立体", 0.0)
    ceiling = lambda m: m["orientation_area_m2"].get("顶棚(水平, Y≈280)", 0.0)

    wall_usages = ("墙面", "木饰面/背景墙", "木饰面", "墙面/建筑构件", "未判定")
    scheme = {
        "floor_primary": pick(["地板", "陶瓷(地/墙砖)"]),
        "floor_palette": palette(["地板", "陶瓷(地/墙砖)"], 5),
        "wall_primary": pick(wall_usages, exclude_names=("地板",), key=lambda m: -vertical(m),
                             value_fn=vertical),
        "wall_palette": palette(wall_usages, 6, key=lambda m: -vertical(m)),
        "ceiling_primary": pick(wall_usages, key=lambda m: -ceiling(m), value_fn=ceiling),
        "cabinet_primary": pick(["柜体"]),
        "cabinet_palette": palette(["柜体"], 5),
        "soft_accent": pick(["软包/织物"]),
        "soft_palette": palette(["软包/织物"], 5),
        "door_and_skirting": pick(["门/踢脚线"]),
        "skirting": pick(["门/踢脚线"], key=lambda m: -m["surface_area_m2"]
                          if "踢脚" not in (m["name"] or "") else 1),
        "metal_secondary": pick(["金属", "金属/塑料", "门窗框/五金"]),
        "glass_secondary": pick(["玻璃"]),
        "ceramic_fixtures": pick(["陶瓷/洁具"]),
        "light_source": pick(["灯具/光源"]),
    }
    # skirting 单独挑「名字含踢脚」的材质
    skirt = [m for m in by_usage.get("门/踢脚线", []) if "踢脚" in (m["name"] or "")]
    if skirt:
        skirt.sort(key=lambda m: -m["surface_area_m2"])
        scheme["skirting"] = brief(skirt[0])
    else:
        scheme["skirting"] = None
    notes = []
    for k, v in scheme.items():
        if isinstance(v, list):
            for item in v:
                if item["hex"] is None:
                    notes.append("%s: 材质『%s』无可解析颜色 → null" % (k, item["material_name"]))
            continue
        if v is None:
            notes.append("%s: 无可用材质 → null" % k)
        elif v["hex"] is None:
            notes.append("%s: 材质『%s』无可解析颜色 → null" % (k, v["material_name"]))
    scheme["null_reasons"] = notes
    scheme["method"] = ("按 GLB 世界空间三角形面积排序, 在每个用途分组内取面积最大的材质;"
                        "墙面/顶棚按『竖直面积』『顶棚水平面积』分别排序; "
                        "贴图材质取内嵌 JPEG 的平均色 (sRGB, 未做线性化), 无贴图时取 baseColorFactor。")
    return scheme


# ==========================================================================
# 平面图标定
# ==========================================================================
def calibrate_plan(scene_min, scene_max):
    """求 plan-123kanfang.png 与 GLB 场景 XZ 的像素映射, 并做墙线自检。"""
    meta = {
        "plan_image": os.path.relpath(PLAN_PNG_PATH, HERE),
        "method": "平面图 = GLB 场景 XZ 包围盒的 1:1 正投影 (1 px = 1 GLB 单位 = 10 mm), "
                  "原点锚定在图像墨迹包围盒左上角对应的场景包围盒角点",
    }
    if _Image is None:
        meta["status"] = "unavailable"
        meta["reason"] = "未安装 Pillow, 无法读取 plan-123kanfang.png"
        return {"meta": meta,
                "available": False,
                "to_px": lambda x, z: (None, None),
                "room_pixels": lambda polys: None,
                "boundary_match": lambda poly: None}

    im = _Image.open(PLAN_PNG_PATH)
    width, height = im.size
    alpha = im.convert("RGBA").getchannel("A")
    if _np is not None:
        a = _np.asarray(alpha)
        ink = a > 200
        ys, xs = _np.nonzero(ink)
        ink_min_x, ink_max_x = int(xs.min()), int(xs.max())
        ink_min_y, ink_max_y = int(ys.min()), int(ys.max())
        ink_arr = ink
    else:
        px = alpha.load()
        ink_min_x = ink_min_y = 10 ** 9
        ink_max_x = ink_max_y = -1
        for yy in range(height):
            for xx in range(width):
                if px[xx, yy] > 200:
                    ink_min_x = min(ink_min_x, xx); ink_max_x = max(ink_max_x, xx)
                    ink_min_y = min(ink_min_y, yy); ink_max_y = max(ink_max_y, yy)
        ink_arr = None

    scene_w = scene_max[0] - scene_min[0]
    scene_h = scene_max[2] - scene_min[2]
    off_x = ink_min_x - scene_min[0]
    off_z = ink_min_y - scene_min[2]
    meta.update({
        "status": "ok",
        "image_size_px": [width, height],
        "ink_bbox_px": {"x_min": ink_min_x, "x_max": ink_max_x,
                        "y_min": ink_min_y, "y_max": ink_max_y},
        "scene_bbox_glb_units": {"x_min": round(scene_min[0], 4), "x_max": round(scene_max[0], 4),
                                 "z_min": round(scene_min[2], 4), "z_max": round(scene_max[2], 4)},
        "scene_bbox_mm": {"x_min": round(scene_min[0] * UNIT_MM, 1),
                          "x_max": round(scene_max[0] * UNIT_MM, 1),
                          "z_min": round(scene_min[2] * UNIT_MM, 1),
                          "z_max": round(scene_max[2] * UNIT_MM, 1)},
        "scale_px_per_glb_unit": 1.0,
        "offset_px": {"x": round(off_x, 3), "z": round(off_z, 3)},
        "formula_px": "px = X_glb + %.3f ; py = Z_glb + %.3f" % (off_x, off_z),
        "scale_check": {
            "ink_width_px": ink_max_x - ink_min_x + 1,
            "scene_width_units": round(scene_w, 3),
            "delta_px": round((ink_max_x - ink_min_x + 1) - scene_w, 3),
            "ink_height_px": ink_max_y - ink_min_y + 1,
            "scene_depth_units": round(scene_h, 3),
            "delta_px_y": round((ink_max_y - ink_min_y + 1) - scene_h, 3),
            "note": "Y 向墨迹下沿比场景多出的部分来自入户门开启弧线, 不参与标定",
        },
    })

    def to_px(x_glb, z_glb):
        return (x_glb + off_x, z_glb + off_z)

    def boundary_match(poly_mm):
        """多边形边界 (mm, GLB 坐标) 上的采样点有多少落在墙线上 (容差 ±3 px)。"""
        if ink_arr is None:
            return None
        pts = poly_mm
        total = 0
        hit = 0
        for i in range(len(pts)):
            a = pts[i]
            b = pts[(i + 1) % len(pts)]
            length = math.hypot(b[0] - a[0], b[1] - a[1])
            n = max(2, int(length / 20.0))
            for k in range(n + 1):
                t = k / float(n)
                gx = a[0] + (b[0] - a[0]) * t
                gz = a[1] + (b[1] - a[1]) * t
                px, py = to_px(gx / UNIT_MM, gz / UNIT_MM)
                xi, yi = int(round(px)), int(round(py))
                total += 1
                ok = False
                for dy in range(-3, 4):
                    yy = yi + dy
                    if yy < 0 or yy >= height:
                        continue
                    for dx in range(-3, 4):
                        xx = xi + dx
                        if 0 <= xx < width and ink_arr[yy, xx]:
                            ok = True
                            break
                    if ok:
                        break
                if ok:
                    hit += 1
        return round(hit / float(total), 4) if total else None

    def room_pixels(polys):
        if not polys:
            return None
        pts = [p for poly in polys for p in poly]
        px_pts = [to_px(p[0] / UNIT_MM, p[1] / UNIT_MM) for p in pts]
        xs = [p[0] for p in px_pts]
        ys = [p[1] for p in px_pts]
        return {
            "bbox": {"x_min": round(min(xs), 1), "x_max": round(max(xs), 1),
                     "y_min": round(min(ys), 1), "y_max": round(max(ys), 1)},
            "centroid": [round(sum(xs) / len(xs), 1), round(sum(ys) / len(ys), 1)],
            "note": "像素坐标原点在图片左上角, x 向右, y 向下; 与 GLB 的 +Z 同向",
        }

    return {"meta": meta, "available": True, "to_px": to_px, "room_pixels": room_pixels,
            "boundary_match": boundary_match}


# ==========================================================================
# materials.md
# ==========================================================================
def write_md(meta, rooms, sub_areas, derived, materials, top30, scheme, plan):
    L = []
    A = L.append
    A("# 材质 / 配色参考档案 — 城投南山长投·领峯 D143 (123kanfang 交互设计方案)")
    A("")
    A("> **用途定位**：本文件是**参考档案**。新工具第一版只做「还原原始建筑测量图」，")
    A("> 不做方案视图，因此配色信息暂不直接显示；切到方案视图时本档案可直接取用。")
    A("> 房间基准表的机读版见 `rooms.json`，材质机读版见 `materials.json`。")
    A("")
    A("## 0. 数据来源与坐标基准")
    A("")
    A("| 项 | 值 |")
    A("| --- | --- |")
    A("| 房间/面积/多边形 | `archive/floorplan-source/ViewData.json` |")
    A("| 3D 几何 + 材质 + 贴图 | `archive/floorplan-source/floordata0.glb` (glTF 2.0 binary, %d bytes) |"
      % meta["sources"]["floordata0.glb"]["bytes"])
    A("| 墙体线稿平面图 | `archive/floorplan-source/plan-123kanfang.png` (%d×%d px) |"
      % (plan["meta"].get("image_size_px", [0, 0])[0], plan["meta"].get("image_size_px", [0, 0])[1]))
    A("| 生成脚本 | `archive/floorplan-source/derived/extract_rooms_materials.py` |")
    A("")
    A("| 坐标基准 | 换算 |")
    A("| --- | --- |")
    A("| 单位 | 1 GLB 单位 = **10 mm** |")
    A("| 面积 | ViewData `Rooms[].Area` 直接是 **㎡**；几何面积按 1 单位² = 0.0001 ㎡ 换算 |")
    A("| 平面坐标 | `GLB_X_mm = ViewData_X × 10`，`GLB_Z_mm = −ViewData_Y × 10` |")
    A("| 竖向 | GLB `Y` 向上，地坪 0、顶棚 280 (2800 mm) |")
    A("| 平面图像素 | `%s` |" % plan["meta"].get("formula_px", "n/a"))
    A("")
    A("> ⚠️ **轴向提醒**：ViewData 的 `Y` 与 GLB 的 `Z` **方向相反**（ViewData Y 向上为正，GLB Z 向下为正）。")
    A("> 只按“同坐标系”直接取用 Z 会把整套房上下颠倒。")
    A("")
    A("**复现方式**")
    A("")
    A("```bash")
    A("cd archive/floorplan-source/derived")
    A("python3 extract_rooms_materials.py            # 重写 rooms.json / materials.json / materials.md")
    A("python3 extract_rooms_materials.py --check    # 只打印统计, 不写文件")
    A("```")
    A("")
    A("> 脚本只用标准库即可跑出房间/材质几何（numpy 缺失时自动退回纯 Python，"
      "两者算出的材质面积完全一致）；**Pillow 缺失时贴图取色与像素定位会写 null 并注明原因**。")
    A("")
    A("> 🔗 **公开分享链接参数**（只读公开接口，未登录、未绕过访问控制）：")
    A(">")
    A("> ```")
    A("> %s" % meta["share_link_public"].get("parameters_raw"))
    A("> ```")
    A("")
    A("## 1. 房间基准表")
    A("")
    A("主名用**原始户型命名**，同时保留 123kanfang 方案命名与两级 ID 便于反查。")
    A("命名口径：三室两厅两卫（主卧 + 北次卧 + 南次卧），客厅为 LDK 客餐厅一体。")
    A("")
    A("| 原始户型名 | english_id | 123kanfang 名 | 净面积(㎡) | 净包围盒 X (mm) | 净包围盒 Z (mm) | 平面图像素框 (px) | ViewData ID | GLB 节点 |")
    A("| --- | --- | --- | --- | --- | --- | --- | --- | --- |")
    for r in rooms:
        bb = r["net_bbox_mm"] or {}
        pp = (r["plan_pixels"] or {}).get("bbox") or {}
        A("| %s%s | `%s` | %s | %s | %s … %s | %s … %s | %s … %s / %s … %s | `%s` | #%s `%s` |" % (
            r["name_original_plan"], " ⚠" if r["name_needs_confirmation"] else "",
            r["english_id"], r["name_123kanfang"], r["area_m2"],
            bb.get("x_min_mm"), bb.get("x_max_mm"), bb.get("z_min_mm"), bb.get("z_max_mm"),
            pp.get("x_min"), pp.get("x_max"), pp.get("y_min"), pp.get("y_max"),
            r["id_viewdata"], r["glb_node"]["index"], r["glb_node"]["name"]))
    for r in derived:
        bb = r["net_bbox_mm"]
        pp = (r["plan_pixels"] or {}).get("bbox") or {}
        A("| %s (派生) | `%s` | %s | %s | %s … %s | %s … %s | %s … %s / %s … %s | — | — |" % (
            r["name_original_plan"], r["english_id"], r["name_123kanfang"], r["area_m2"],
            bb["x_min_mm"], bb["x_max_mm"], bb["z_min_mm"], bb["z_max_mm"],
            pp.get("x_min"), pp.get("x_max"), pp.get("y_min"), pp.get("y_max")))
    A("")
    A("⚠ = 名称或归属为推断 / 待现场确认。")
    A("")
    A("> 「客厅」一行的净面积 46.56㎡ 与净包围盒是客餐厅 4 个子区（客厅区 / 过道区 / 盥洗区 / 玄关区）"
      "的**并集**（见 1.2 表）；其余各行只有 1 个子区，包围盒即房间轮廓。")
    A("> 全部为净区（内墙面）尺寸；`rooms.json` 的 `world_bbox_mm` 另给了 GLB 实体的三维包围盒（含 2900mm 层高）。")
    A("")
    A("### 1.1 同名房间的区分判据")
    A("")
    for r in rooms:
        if r["notes"]:
            A("- **%s** (`%s` / %s)：%s" % (r["name_original_plan"], r["id_viewdata"],
                                          r["name_123kanfang"], r["notes"]))
    for r in derived:
        A("- **%s**（派生）：%s" % (r["name_original_plan"], r["notes"]))
    A("")
    A("### 1.2 房间子区（ViewData RoomAreas）")
    A("")
    A("| 所属房间 | 原始户型名 | 123kanfang 名 | 净包围盒 X (mm) | 净包围盒 Z (mm) | 像素框 (px) | 复算面积(㎡) | 墙线吻合率 |")
    A("| --- | --- | --- | --- | --- | --- | --- | --- |")
    for s in sub_areas:
        bb = s["net_bbox_mm"]
        pp = (s["plan_pixels"] or {}).get("bbox") or {}
        match = (s["plan_pixels"] or {}).get("boundary_wall_ink_match_ratio")
        A("| %s | %s | %s | %s … %s | %s … %s | %s … %s / %s … %s | %s | %s |" % (
            s["room_name_123kanfang"], s["name_original_plan"], s["name_123kanfang"],
            bb["x_min_mm"], bb["x_max_mm"], bb["z_min_mm"], bb["z_max_mm"],
            pp.get("x_min"), pp.get("x_max"), pp.get("y_min"), pp.get("y_max"),
            s["area_m2_recomputed_shoelace"],
            match if match is not None else "n/a"))
    A("")
    A("> 墙线吻合率 = 房间净区多边形边界采样点中，有多少落在平面图墙线（含 ±3 px 容差）上的比例。")
    A("> 该值同时用于验证平面图↔GLB 的像素标定是否可靠。")
    A("")
    A("## 2. 材质与配色")
    A("")
    A("### 2.1 配色方案建议（按用途取面积最大的材质）")
    A("")
    A("| 用途 | 建议主色 | 材质 (#index) | 覆盖面积(㎡) | 取色来源 |")
    A("| --- | --- | --- | --- | --- |")
    labels = [("floor_primary", "地板主色"), ("wall_primary", "墙面主色"),
              ("ceiling_primary", "顶棚色"), ("cabinet_primary", "柜体主色"),
              ("soft_accent", "软包/点缀色"), ("door_and_skirting", "门/踢脚线色"),
              ("skirting", "踢脚线色"), ("metal_secondary", "金属/门窗辅色"),
              ("glass_secondary", "玻璃辅色"), ("ceramic_fixtures", "陶瓷洁具色"),
              ("light_source", "灯具/光源色")]
    for key, label in labels:
        v = scheme.get(key)
        if not v:
            A("| %s | `null` | — | — | 无可用材质 |" % label)
            continue
        src = "贴图平均色" if v["has_texture"] else "baseColorFactor"
        A("| %s | `%s` | %s (#%d) | %s | %s |" % (label, v["hex"] or "`null`",
                                                  v.get("material_display_name", v["material_name"]),
                                                  v["material_index"], v.get("basis_area_m2",
                                                                          v["surface_area_m2"]), src))
    A("")
    for pkey, plabel in (("floor_palette", "地板配色组（同一用途下不止一种主色）"),
                         ("wall_palette", "墙面配色组"),
                         ("cabinet_palette", "柜体配色组"),
                         ("soft_palette", "软包/织物配色组")):
        pl = scheme.get(pkey) or []
        if not pl:
            continue
        A("**%s**：" % plabel)
        A("")
        A("| 色值 | 材质 (#index) | 面积(㎡) | 取色来源 |")
        A("| --- | --- | --- | --- |")
        for it in pl:
            src = "贴图平均色" if it["has_texture"] else "baseColorFactor"
            A("| `%s` | %s (#%d) | %s | %s |" % (it["hex"] or "null",
                                                it.get("material_display_name", it["material_name"]),
                                                it["material_index"], it["surface_area_m2"], src))
        A("")
    if scheme.get("null_reasons"):
        A("**取不到色的原因：**")
        for n in scheme["null_reasons"]:
            A("- %s" % n)
        A("")
    A("取色方法：%s" % scheme["method"])
    A("")
    A("### 2.2 材质面积 Top 30")
    A("")
    A("| # | 材质名 (#index) | 用途 | 面积(㎡) | 有效色 | baseColor | 有贴图 | 贴图平均色 | 出现房间 |")
    A("| --- | --- | --- | --- | --- | --- | --- | --- | --- |")
    for m in top30:
        rooms_s = ", ".join(x.replace("Room-", "") for x in m["rooms"][:3])
        A("| %s | %s (#%d) | %s | %s | %s | %s | %s | %s | %s |" % (
            m["area_rank"], m.get("display_name") or m["name"], m["index"], m["usage"], m["surface_area_m2"],
            ("`%s`" % m["effective_color_hex"]) if m["effective_color_hex"] else "`null`",
            ("`%s`" % m["base_color_hex"]) if m["base_color_hex"] else "`null`",
            "是" if m["has_texture"] else "否",
            ("`%s`" % (m["base_color_texture"] or {}).get("avg_color_hex"))
            if (m["base_color_texture"] or {}).get("avg_color_hex") else "`null`",
            rooms_s))
    A("")
    A("### 2.3 全部材质统计")
    A("")
    A("- 材质总数：**%d**（其中有贴图 %d 个，有 baseColorFactor %d 个）" % (
        len(materials), sum(1 for m in materials if m["has_texture"]),
        sum(1 for m in materials if m["base_color_hex"])))
    A("- 合计表面积：**%s ㎡**（含重复利用的同一 mesh，属模型几何量而非实际装修量）" %
      round(sum(m["surface_area_m2"] for m in materials), 2))
    A("")
    A("## 3. 平面图 ↔ GLB 标定")
    A("")
    A("```")
    A(plan["meta"].get("formula_px", "n/a"))
    A("```")
    A("")
    A("- 图像尺寸：%s px" % plan["meta"].get("image_size_px"))
    A("- 墨迹包围盒：%s" % plan["meta"].get("ink_bbox_px"))
    A("- 场景包围盒（GLB 单位）：%s" % plan["meta"].get("scene_bbox_glb_units"))
    sc = plan["meta"].get("scale_check")
    if sc:
        A("- 尺度自检：墨迹宽 %s px vs 场景宽 %s 单位（差 %s px）" % (
            sc["ink_width_px"], sc["scene_width_units"], sc["delta_px"]))
    else:
        A("- 尺度自检：%s" % plan["meta"].get("reason", "n/a"))
    A("")
    A("## 4. 数据可信度说明")
    A("")
    A("1. **平面图是渲染图，不是测量图**：plan-123kanfang.png 是 123kanfang 按 GLB 场景包围盒渲染的墙线图，")
    A("   像素定位由脚本自动标定并用墙线吻合率自检；但它不含尺寸标注，不能替代原始户型测量图。")
    A("2. **材质名大量为上传素材/实例名**（如 `M_上传_005`、`111_Inst`、`1`），用途靠节点名与几何姿态推断，")
    A("   推断依据逐条写在 `materials.json` 的 `usage_reason` 里。")
    A("3. **贴图取色是平均值**：对可平铺贴图取平均色只能给出色调与明度，")
    A("   真实纹理的深浅分布会被抹平，不能直接当作色卡。")
    A("4. **房间名称部分为推断**：两个「次卧」按位置/面积/家具判定为北次卧(客卧位)/南次卧(次卧位)，")
    A("   两个「卫生间」按与主卧的相邻关系判定为主卫/公卫；123kanfang 原始数据没有区分标签。")
    A("5. **面积口径**：ViewData 的 `Area` 是平台算的净面积，与按多边形 shoelace 复算的值可能略有差异；")
    A("   `rooms.json` 同时给出两者供核对。")
    A("6. **储物间/多功能角 (6.57㎡) 待现场确认**：原始户型名是推断，")
    A("   123kanfang 方案把这里封成电竞房，与用户「三室两厅两卫」的原始户型诉求不一致。")
    A("")
    A("---")
    A("")
    A("生成时间（UTC）：%s ｜ 脚本：`extract_rooms_materials.py`" % meta["generated_at_utc"])
    A("")
    with open(MATERIALS_MD, "w", encoding="utf-8") as fh:
        fh.write("\n".join(L))


# ==========================================================================
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="只打印统计, 不写文件")
    args = ap.parse_args()

    meta, rooms, sub_areas, derived, materials, top30, scheme = build()
    print("[ok] 解析完成")
    print("  房间 %d 个, 子区 %d 个, 派生分区 %d 个, 材质 %d 个"
          % (len(rooms), len(sub_areas), len(derived), len(materials)))
    for r in rooms:
        pp = (r["plan_pixels"] or {}).get("bbox")
        print("  - %-14s %-8s %6.2f㎡  像素框 %s" % (
            r["name_original_plan"], r["name_123kanfang"], r["area_m2"] or 0,
            "%s…%s / %s…%s" % (pp["x_min"], pp["x_max"], pp["y_min"], pp["y_max"]) if pp else "n/a"))
    for r in derived:
        pp = (r["plan_pixels"] or {}).get("bbox") or {}
        print("  - %-14s %-8s %6.2f㎡  像素框 %s…%s / %s…%s  (派生)" % (
            r["name_original_plan"], r["name_123kanfang"], r["area_m2"],
            pp.get("x_min"), pp.get("x_max"), pp.get("y_min"), pp.get("y_max")))
    print("  Top 材质:")
    for m in top30[:10]:
        print("    %2d. %-22s %-12s %8.2f㎡  %s" % (
            m["area_rank"], (m["name"] or "-")[:22], m["usage"], m["surface_area_m2"],
            m["effective_color_hex"] or "null"))
    if args.check:
        return
    print("[ok] 已写出 %s / %s / %s" % (ROOMS_JSON, MATERIALS_JSON, MATERIALS_MD))


if __name__ == "__main__":
    main()
