"""AutoCAD DXF export of a facade elevation (ezdxf). Units are millimetres, drawn at 1:1."""
from __future__ import annotations

import io

import ezdxf
from ezdxf.enums import TextEntityAlignment

from .facade import GLASS, INFILLS, OPERATIONS, SLIDING, TRACKS, Elevation, _gap, _joint_type

LAYERS = {
    "VS-FRAME": 8, "VS-MULLION": 8, "VS-TRANSOM": 8, "VS-BUTT-JOINT": 5, "VS-GLASS": 4,
    "VS-OPERATION": 6, "VS-TRACK": 3, "VS-INFILL": 9, "VS-POLISHED-EDGE": 140, "VS-DIMENSIONS": 2, "VS-TEXT": 7,
}


def export_dxf(e: Elevation, check: dict | None = None) -> bytes:
    doc = ezdxf.new("R2010", setup=True)
    doc.header["$INSUNITS"] = 4  # millimetres
    doc.header["$MEASUREMENT"] = 1
    for name, color in LAYERS.items():
        layer = doc.layers.add(name, color=color)
        if name in ("VS-BUTT-JOINT", "VS-OPERATION"):
            layer.dxf.linetype = "DASHED"
    msp = doc.modelspace()

    W, H = e.width_mm, e.height_mm
    th = max(25.0, min(W, H) / 60)  # text height scales with the drawing
    ltscale = max(5.0, min(W, H) / 150)
    doc.header["$LTSCALE"] = ltscale

    def Y(y: float) -> float:  # model space is y-up; the elevation is y-down
        return H - y

    def rect(x: float, y: float, w: float, h: float, layer: str, **kw):
        msp.add_lwpolyline([(x, Y(y)), (x + w, Y(y)), (x + w, Y(y + h)), (x, Y(y + h))], close=True,
                           dxfattribs={"layer": layer, **kw})

    def line(a, b, layer: str):
        msp.add_line((a[0], Y(a[1])), (b[0], Y(b[1])), dxfattribs={"layer": layer})

    def text(s: str, x: float, y: float, h: float = th, layer: str = "VS-TEXT"):
        msp.add_text(s, height=h, dxfattribs={"layer": layer}).set_placement(
            (x, Y(y)), align=TextEntityAlignment.MIDDLE_CENTER)

    # Outer frame
    rect(0, 0, W, H, "VS-FRAME")
    rect(e.frame_mm, e.frame_mm, W - 2 * e.frame_mm, H - 2 * e.frame_mm, "VS-FRAME")

    results = {(p["bay_index"], p["pane_index"]): p for p in (check or {}).get("panes", [])}

    for i, bay in enumerate(e.bays):
        # Vertical joint on the right of this bay
        if i < len(e.bays) - 1:
            xj = bay.x_mm + bay.width_mm
            if _joint_type(bay.right_joint) == "silicone_butt_joint":
                g = _gap(bay.right_joint)
                line((xj - g / 2, e.frame_mm), (xj - g / 2, H - e.frame_mm), "VS-BUTT-JOINT")
                line((xj + g / 2, e.frame_mm), (xj + g / 2, H - e.frame_mm), "VS-BUTT-JOINT")
                bite = (bay.right_joint or {}).get("required_bite_mm")
                label = f"SSG {g:g} mm" + (f" / bite {bite} mm" if bite else "")
                t = msp.add_text(label, height=th * 0.7, dxfattribs={"layer": "VS-TEXT", "rotation": 90})
                t.set_placement((xj - g / 2 - th * 0.6, Y(H / 2)), align=TextEntityAlignment.MIDDLE_CENTER)
            else:
                rect(xj - e.mullion_mm / 2, e.frame_mm, e.mullion_mm, H - 2 * e.frame_mm, "VS-MULLION")

        for p in bay.panes:
            sx, sy, sw, sh = p.sight
            if p.pane_index > 1:  # transom above this pane
                rect(sx, p.y_mm - e.transom_mm / 2, sw, e.transom_mm, "VS-TRANSOM")
            gx, gy, gw, gh = p.glass
            if p.infill != "glass":
                rect(gx, gy, gw, gh, "VS-INFILL")
                if p.infill == "louvre":  # blades every ~100 mm
                    n = max(2, int(sh // 100))
                    for k in range(1, n):
                        yy = sy + sh * k / n
                        line((sx, yy), (sx + sw, yy), "VS-INFILL")
                else:  # spandrel: cross
                    line((sx, sy), (sx + sw, sy + sh), "VS-INFILL")
                    line((sx + sw, sy), (sx, sy + sh), "VS-INFILL")
                cx, cy = sx + sw / 2, sy + sh / 2
                text(f"{p.mark.split('/')[-1]}  {INFILLS[p.infill].upper()}", cx, cy - th * 1.6)
                text(f"{gw} x {gh}", cx, cy, th * 0.8)
                continue
            rect(gx, gy, gw, gh, "VS-GLASS")
            for side in ("left", "right"):
                if p.edges[side] in ("butt", "overlap") or p.operation in SLIDING:
                    x = gx if side == "left" else gx + gw
                    line((x, gy), (x, gy + gh), "VS-POLISHED-EDGE")

            cx, cy = sx + sw / 2, sy + sh / 2
            op = p.operation
            if op in ("casement", "door", "tilt_turn"):  # side-hung on the left: apex on the hinge side
                line((sx + sw, sy), (sx, cy), "VS-OPERATION")
                line((sx + sw, sy + sh), (sx, cy), "VS-OPERATION")
                if op == "tilt_turn":  # plus bottom-hinged tilt
                    line((sx, sy), (cx, sy + sh), "VS-OPERATION")
                    line((sx + sw, sy), (cx, sy + sh), "VS-OPERATION")
            elif op == "top_hung":
                line((sx, sy + sh), (cx, sy), "VS-OPERATION")
                line((sx + sw, sy + sh), (cx, sy), "VS-OPERATION")
            elif op in SLIDING:
                d = -1 if op == "sliding_left" else 1
                L = min(sw * 0.3, 600)
                tail, head = (cx - d * L / 2, cy + th * 2), (cx + d * L / 2, cy + th * 2)
                msp.add_line((tail[0], Y(tail[1])), (head[0], Y(head[1])), dxfattribs={"layer": "VS-TEXT"})
                a = min(L * 0.25, th * 2)
                for s in (-1, 1):
                    msp.add_line((head[0], Y(head[1])), (head[0] - d * a, Y(head[1] + s * a * 0.6)),
                                 dxfattribs={"layer": "VS-TEXT"})
                n = TRACKS[p.track_system]["tracks"]
                for k in range(n):  # head and sill track lines
                    off = 6 + k * 8
                    line((sx, sy + off), (sx + sw, sy + off), "VS-TRACK")
                    line((sx, sy + sh - off), (sx + sw, sy + sh - off), "VS-TRACK")

            r = results.get((p.bay_index, p.pane_index))
            status = "" if not r else (f"  {r['utilisation'] * 100:.0f}% OK" if r["pass"] else "  FAIL")
            tag = "F" if op == "fixed" else OPERATIONS[op].split(" (")[0]
            text(f"{p.mark.split('/')[-1]}  {tag}", cx, cy - th * 1.6)
            text(f"{gw} x {gh}  {GLASS[p.glass_spec]['short']}{status}", cx, cy, th * 0.8)

    # Dimensions
    dim = {"dimtxt": th, "dimasz": th * 0.8, "dimexo": th * 0.4, "dimexe": th * 0.5, "dimgap": th * 0.3,
           "dimtsz": th * 0.6, "dimclrd": 2, "dimclre": 2}
    off1, off2 = th * 4, th * 8

    def vdim(y1: float, y2: float, x_line: float, x_ref: float):
        msp.add_linear_dim(base=(x_line, Y(y1)), p1=(x_ref, Y(y1)), p2=(x_ref, Y(y2)), angle=90,
                           dimstyle="EZDXF", override=dim, dxfattribs={"layer": "VS-DIMENSIONS"}).render()

    for bay in e.bays:  # bay widths along the top
        msp.add_linear_dim(base=(bay.x_mm, H + off1), p1=(bay.x_mm, H), p2=(bay.x_mm + bay.width_mm, H),
                           dimstyle="EZDXF", override=dim, dxfattribs={"layer": "VS-DIMENSIONS"}).render()
    msp.add_linear_dim(base=(0, -off1), p1=(0, 0), p2=(W, 0), dimstyle="EZDXF", override=dim,
                       dxfattribs={"layer": "VS-DIMENSIONS"}).render()  # overall width along the bottom
    vdim(0, H, -off1, 0)  # overall height on the left
    last = e.bays[-1]
    for p in last.panes:  # pane heights of the last bay on the right
        vdim(p.y_mm, p.y_mm + p.height_mm, W + off1, W)

    # Title
    tx = W / 2
    text(f"{e.elevation_id}  ·  {W} x {H} mm  ·  wind {e.wind_pressure_kpa:g} kPa  ·  qty {e.quantity}",
         tx, H + off2 + th * 2, th * 1.2)
    if check:
        state = "ALL PANES PASS IS 875 (PART 3) SCREENING" if check["pass"] else "SOME PANES FAIL — SEE SCHEDULE"
        text(state, tx, H + off2 + th * 4, th * 0.8)

    buf = io.StringIO()
    doc.write(buf)
    return buf.getvalue().encode("utf-8")
