#!/usr/bin/env python3
"""
vf-convert.py — visualize-floorplans (chemny) JSON → Hermes home-design unified schema converter

Inputs (from https://github.com/chemny/visualize-floorplans):
  - synthetic-layout-v1.json : plan geometry (walls/rooms/doors/furniture, canvas units)
  - sample-project.json      : project metadata (rooms names/styles/locks/design)
  - sample-topology.json     : zone graph + access points (door connects which rooms)

Output: merged unified schema JSON consumed by index.html (three.js viewer):
  { meta, unit, canvas, walls[], rooms[], doors[], furniture[], structural_locks[] }

Notes on honesty:
  - synthetic-layout coordinates are canvas pixels of a FICTIONAL example.
    We normalize them to meters via a configurable scale (default 0.05 m/px,
    i.e. 800px canvas ≈ 40m? no — we pick scale so the studio reads plausibly:
    canvas 720x480 px * 0.01 = 7.2m x 4.8m — set via --scale).
  - Door hinge/open-tip become position+width+swing; no fabricated dimensions.
"""
import json, math, argparse, os, sys
from pathlib import Path

# room-type → Chinese label fallback + floor color + furniture hints
ROOM_META = {
    "living_room": {"label": "客厅", "color": 0xf5efe6},
    "dining_room": {"label": "餐厅", "color": 0xf5efe6},
    "bedroom":     {"label": "卧室", "color": 0xeef2f7},
    "kitchen":     {"label": "厨房", "color": 0xeef7ee},
    "bathroom":    {"label": "卫生间", "color": 0xe8f1f8},
    "balcony":     {"label": "阳台", "color": 0xfdf6e3},
    "studio":      {"label": "工作室", "color": 0xf5efe6},
}
FURN_META = {
    "bed":     {"h": 0.5, "color": 0xd8cfc0, "label": "床"},
    "sofa":    {"h": 0.75, "color": 0xb9aa92, "label": "沙发"},
    "cabinet": {"h": 0.9, "color": 0xc9b99a, "label": "柜"},
    "table":   {"h": 0.72, "color": 0xc9b99a, "label": "桌"},
}

def convert(plan, project, topology, scale, revision):
    s = scale
    canvas = plan["plan"]["canvas"] if "plan" in plan and "canvas" in plan["plan"] else plan["canvas"]
    W, H = canvas["width"], canvas["height"]

    def px(pt):  # canvas px → meters, flip Y (canvas y-down → 3D z-up-ish north)
        return [round(pt[0] * s, 3), round((H - pt[1]) * s, 3)]

    walls = []
    for w in (plan["plan"]["walls"] if "plan" in plan else plan["walls"]):
        a, b = px(w["start"]), px(w["end"])
        walls.append({
            "id": w["id"],
            "a": a, "b": b,
            "thickness": w.get("thickness", 12) * s,
            "height": 2.8,  # assumed — sample has no storey height
            "assumed": {"height": "sample-project.json 不含层高, 默认 2.8m"},
        })

    rooms = []
    project_rooms = {r["id"]: r for r in project.get("floor_plan", {}).get("rooms", [])}
    for r in (plan["plan"].get("rooms", []) if "plan" in plan else plan.get("rooms", [])):
        rid = r["id"]
        meta = project_rooms.get(rid, {})
        rtype = meta.get("type", rid)
        info = ROOM_META.get(rtype, {"label": meta.get("name", rid), "color": 0xf0ece4})
        poly_m = [px(p) for p in r["polygon"]]
        # shoelace area in m²
        area = abs(sum(poly_m[i][0]*poly_m[(i+1) % len(poly_m)][1] -
                       poly_m[(i+1) % len(poly_m)][0]*poly_m[i][1]
                       for i in range(len(poly_m))) / 2)
        rooms.append({
            "id": rid,
            "name": meta.get("name", info["label"]),
            "type": rtype,
            "polygon": poly_m,
            "area_m2": round(area, 2),
            "floor_color": info["color"],
            "label_point": px(r["label_point"]) if "label_point" in r else None,
            "certainty": meta.get("certainty", "synthetic"),
        })

    doors = []
    for d in (plan["plan"].get("doors", []) if "plan" in plan else plan.get("doors", [])):
        hinge, tip = px(d["hinge"]), px(d["closed_tip"])
        width = round(math.dist(hinge, tip), 3)
        topo = next((a for a in topology.get("access_points", []) if a["id"] == d["id"]), {})
        doors.append({
            "id": d["id"],
            "hinge": hinge,
            "closed_tip": tip,
            "open_tip": px(d["open_tip"]),
            "width_m": width,
            "swing": d.get("arc_direction", "counterclockwise"),
            "connects": topo.get("connects"),
            "swing_into": topo.get("swing_into"),
            "certainty": topo.get("certainty", "synthetic"),
        })

    furniture = []
    for f in (plan.get("furniture", []) or []):
        x, y = px([f["x"], f["y"]])
        fm = FURN_META.get(f.get("symbol", ""), {"h": 0.7, "color": 0xcabfae, "label": f.get("label", f["id"])})
        furniture.append({
            "id": f["id"], "symbol": f.get("symbol", "generic"),
            "label": f.get("label", fm["label"]),
            "x": x, "y": y,
            "w": round(f["width"] * s, 3),
            "d": round(f["height"] * s, 3),
            "h": fm["h"], "color": fm["color"],
        })

    return {
        "meta": {
            "source": "chemny/visualize-floorplans sample data",
            "project_id": project.get("project_id"),
            "revision": revision,
            "schema_version": project.get("schema_version"),
            "scale_m_per_px": scale,
            "selected_style": project.get("design", {}).get("selected_style"),
            "style_name": next((o["name"] for o in project.get("design", {}).get("style_options", [])
                                if o["id"] == project.get("design", {}).get("selected_style")), None),
            "palette": project.get("design", {}).get("palette"),
            "requirements": project.get("design", {}).get("requirements"),
            "relationships": project.get("floor_plan", {}).get("relationships"),
            "uncertainties": project.get("floor_plan", {}).get("uncertainties"),
        },
        "unit": "m",
        "canvas_m": [round(W * s, 3), round(H * s, 3)],
        "walls": walls,
        "rooms": rooms,
        "doors": doors,
        "furniture": furniture,
        "structural_locks": project.get("structural_locks", []),
    }

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--plan", required=True)
    ap.add_argument("--project", required=True)
    ap.add_argument("--topology", required=True)
    ap.add_argument("--scale", type=float, default=0.01, help="meters per canvas px")
    ap.add_argument("--revision", default="converted-v1")
    ap.add_argument("-o", "--out", required=True)
    a = ap.parse_args()
    def load(p):
        resolved = Path(p).resolve()
        if not resolved.is_relative_to(Path.cwd().resolve()):
            raise SystemExit(f"路径必须位于当前目录内: {p}")
        return json.loads(resolved.read_text(encoding="utf-8"))

    merged = convert(load(a.plan), load(a.project), load(a.topology), a.scale, a.revision)
    out = Path(a.out).resolve()
    if not out.is_relative_to(Path.cwd().resolve()):
        raise SystemExit("--out 必须位于当前目录内（安全限制）")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(merged, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {a.out}: {len(merged['walls'])} walls, {len(merged['rooms'])} rooms, "
          f"{len(merged['doors'])} doors, {len(merged['furniture'])} furniture; "
          f"canvas {merged['canvas_m']} m; rooms area: "
          f"{ {r['id']: r['area_m2'] for r in merged['rooms']} }")

if __name__ == "__main__":
    main()
