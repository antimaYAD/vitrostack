import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Arrow, Circle, Group, Layer, Line, Rect, Shape, Stage, Text } from "react-konva";
import type Konva from "konva";
import { Maximize, Minus, Plus } from "lucide-react";
import {
  type Facade, type JointResult, type PaneResult, MIN_BAY, MIN_PANE, glassShort, infillLabel, isSliding, layout, letter, paneKey,
} from "../lib/facade";

export type Tool = "select" | "split_v" | "split_h" | "pan";
export type Selection =
  | { kind: "pane"; bayId: string; paneId: string }
  | { kind: "joint"; bayIndex: number }
  | { kind: "transom"; bayId: string; k: number }
  | null;
export interface ScreenRect { x: number; y: number; w: number; h: number }

interface Props {
  facade: Facade;
  tool: Tool;
  snap: number;
  showGrid?: boolean;
  showDims?: boolean;
  dark?: boolean;
  selection: Selection;
  results?: Map<string, PaneResult>;
  joints?: Map<number, JointResult>;
  onSelect: (s: Selection) => void;
  onSplitBay: (bayId: string, xLocal: number) => void;
  onSplitPane: (bayId: string, paneId: string, yLocal: number) => void;
  onToggleJoint: (bayIndex: number) => void;
  onDragStart: () => void;
  onMoveJoint: (bayIndex: number, xAbs: number) => void;
  onMoveTransom: (bayId: string, k: number, yAbs: number) => void;
  onDragEnd: () => void;
  /** Rendered over the canvas, e.g. a floating inspector anchored to the selection's screen rectangle. */
  overlay?: (rect: ScreenRect | null, size: { w: number; h: number }) => ReactNode;
  className?: string;
}

const FONT = "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif";

function palette(dark: boolean) {
  return dark ? {
    bg: "#0b1220", gridMinor: "rgba(255,255,255,0.035)", gridMajor: "rgba(255,255,255,0.08)",
    alu: ["#7c8592", "#4b5563"], aluStroke: "#94a3b8", glass: "rgba(56,189,248,0.16)", glassStroke: "rgba(125,211,252,0.55)",
    silicone: "#020617", butt: "#60a5fa", fin: "rgba(45,212,191,0.18)", polished: "#2dd4bf", fail: "#fb7185",
    pass: "#34d399", sel: "#60a5fa", dim: "#94a3b8", text: "#e2e8f0", muted: "#94a3b8", sym: "#cbd5e1", track: "#a7f3d0", spandrel: "#334155", louvre: "#1e293b",
  } : {
    bg: "#f8fafc", gridMinor: "rgba(15,23,42,0.045)", gridMajor: "rgba(15,23,42,0.09)",
    alu: ["#e2e6eb", "#a3acb7"], aluStroke: "#64748b", glass: "rgba(186,230,253,0.6)", glassStroke: "rgba(14,165,233,0.45)",
    silicone: "#1e293b", butt: "#2563eb", fin: "rgba(20,184,166,0.16)", polished: "#0d9488", fail: "#e11d48",
    pass: "#059669", sel: "#2563eb", dim: "#475569", text: "#0f172a", muted: "#64748b", sym: "#334155", track: "#059669", spandrel: "#cbd5e1", louvre: "#e2e8f0",
  };
}

interface View { s: number; ox: number; oy: number }

export default function WindowDesignCanvas(props: Props) {
  const { facade: f, tool, snap, showGrid = true, showDims = true, dark = false, selection, results, joints, overlay, className } = props;
  const C = palette(dark);
  const wrapRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [view, setView] = useState<View>({ s: 0.1, ox: 0, oy: 0 });
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const [space, setSpace] = useState(false);
  const fitRef = useRef(0.1);
  const lay = useMemo(() => layout(f), [f]);
  const W = f.width_mm, H = f.height_mm;

  // ------------------------------------------------------------ sizing & fit
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const fit = useCallback(() => {
    if (!size.w || !size.h) return;
    const padX = Math.min(110, size.w * 0.16), padY = Math.min(96, size.h * 0.18);
    const s = Math.max(0.005, Math.min((size.w - 2 * padX) / W, (size.h - 2 * padY) / H));
    fitRef.current = s;
    setView({ s, ox: (size.w - W * s) / 2, oy: (size.h - H * s) / 2 });
  }, [size.w, size.h, W, H]);
  useEffect(fit, [fit]);

  const px = (n: number) => n / view.s; // screen pixels -> world mm
  const toWorld = useCallback((p: { x: number; y: number }) => ({ x: (p.x - view.ox) / view.s, y: (p.y - view.oy) / view.s }), [view]);
  const snapV = (v: number) => Math.round(v / snap) * snap;

  const zoomAt = useCallback((factor: number, at?: { x: number; y: number }) => {
    setView((v) => {
      const s = Math.min(Math.max(v.s * factor, fitRef.current * 0.25), 25);
      const p = at ?? { x: size.w / 2, y: size.h / 2 };
      const wx = (p.x - v.ox) / v.s, wy = (p.y - v.oy) / v.s;
      return { s, ox: p.x - wx * s, oy: p.y - wy * s };
    });
  }, [size.w, size.h]);

  // ------------------------------------------------------------ space-to-pan
  useEffect(() => {
    const typing = (e: KeyboardEvent) => e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
    const down = (e: KeyboardEvent) => { if (e.code === "Space" && !typing(e)) { e.preventDefault(); setSpace(true); } };
    const up = (e: KeyboardEvent) => { if (e.code === "Space") setSpace(false); };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, []);

  // ------------------------------------------------------------ drags (joints, transoms, pan) via window listeners
  type Drag = { kind: "joint"; i: number } | { kind: "transom"; bayId: string; k: number } | { kind: "pan"; ox: number; oy: number };
  const dragRef = useRef<{ d: Drag; sx: number; sy: number; moved: boolean } | null>(null);
  const cb = useRef(props);
  cb.current = props;

  const pointer = (evt: PointerEvent) => {
    const stage = stageRef.current;
    if (!stage) return null;
    stage.setPointersPositions(evt);
    return stage.getPointerPosition();
  };

  const beginDrag = (d: Drag, evt: PointerEvent) => {
    dragRef.current = { d, sx: evt.clientX, sy: evt.clientY, moved: false };
    const move = (e: PointerEvent) => {
      const r = dragRef.current;
      if (!r) return;
      if (!r.moved) {
        if (Math.hypot(e.clientX - r.sx, e.clientY - r.sy) < 3) return;
        r.moved = true;
        if (r.d.kind !== "pan") cb.current.onDragStart();
      }
      if (r.d.kind === "pan") {
        const d0 = r.d;
        setView((v) => ({ ...v, ox: d0.ox + (e.clientX - r.sx), oy: d0.oy + (e.clientY - r.sy) }));
        return;
      }
      const p = pointer(e);
      if (!p) return;
      const w = { x: (p.x - viewRef.current.ox) / viewRef.current.s, y: (p.y - viewRef.current.oy) / viewRef.current.s };
      if (r.d.kind === "joint") cb.current.onMoveJoint(r.d.i, w.x);
      else cb.current.onMoveTransom(r.d.bayId, r.d.k, w.y);
    };
    const up = () => {
      const r = dragRef.current;
      dragRef.current = null;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (!r) return;
      if (r.d.kind === "pan") return;
      if (r.moved) { cb.current.onDragEnd(); return; }
      // A click without movement
      if (r.d.kind === "joint") { cb.current.onToggleJoint(r.d.i); cb.current.onSelect({ kind: "joint", bayIndex: r.d.i }); }
      else cb.current.onSelect({ kind: "transom", bayId: r.d.bayId, k: r.d.k });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const viewRef = useRef(view);
  viewRef.current = view;

  const panning = tool === "pan" || space;

  const onStageDown = (e: Konva.KonvaEventObject<PointerEvent>) => {
    if (panning || e.evt.button === 1) {
      e.evt.preventDefault();
      beginDrag({ kind: "pan", ox: view.ox, oy: view.oy }, e.evt);
    }
  };
  const onStageMove = () => {
    const p = stageRef.current?.getPointerPosition();
    if (!p) return;
    const w = toWorld(p);
    setHover(w);
  };
  const onWheel = (e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const p = stageRef.current?.getPointerPosition();
    if (!p) return;
    zoomAt(e.evt.deltaY < 0 ? 1.12 : 1 / 1.12, p);
  };
  const setCursor = (c: string) => { const el = stageRef.current?.container(); if (el) el.style.cursor = c; };
  const baseCursor = panning ? (dragRef.current?.d.kind === "pan" ? "grabbing" : "grab") : tool === "select" ? "default" : "crosshair";
  useEffect(() => setCursor(baseCursor), [baseCursor]);

  // ------------------------------------------------------------ geometry (sight lines only; glass sizes come from the API)
  const n = lay.length;
  const vDed = (i: number, side: "l" | "r") => {
    const edge = side === "l" ? i === 0 : i === n - 1;
    if (edge) return f.frame_mm;
    const bay = side === "l" ? f.bays[i - 1] : f.bays[i];
    return bay.joint === "silicone_butt_joint" ? f.butt_gap_mm / 2 : f.mullion_mm / 2;
  };
  const sight = (bi: number, k: number) => {
    const b = lay[bi], p = b.panes[k];
    const top = k === 0 ? f.frame_mm : f.transom_mm / 2;
    const bot = k === b.panes.length - 1 ? f.frame_mm : f.transom_mm / 2;
    const x = b.x + vDed(bi, "l"), w = b.w - vDed(bi, "l") - vDed(bi, "r");
    return { x, y: p.y + top, w, h: p.h - top - bot };
  };

  const toScreen = (r: { x: number; y: number; w: number; h: number }): ScreenRect =>
    ({ x: r.x * view.s + view.ox, y: r.y * view.s + view.oy, w: r.w * view.s, h: r.h * view.s });

  let selRect: ScreenRect | null = null;
  if (selection?.kind === "pane") {
    const bi = lay.findIndex((b) => b.bay.id === selection.bayId);
    const k = bi >= 0 ? lay[bi].panes.findIndex((p) => p.pane.id === selection.paneId) : -1;
    if (k >= 0) selRect = toScreen(sight(bi, k));
  } else if (selection?.kind === "joint" && lay[selection.bayIndex + 1]) {
    const x = lay[selection.bayIndex + 1].x;
    selRect = toScreen({ x: x - f.mullion_mm / 2, y: f.frame_mm, w: f.mullion_mm, h: H - 2 * f.frame_mm });
  } else if (selection?.kind === "transom") {
    const bi = lay.findIndex((b) => b.bay.id === selection.bayId);
    const p = bi >= 0 ? lay[bi].panes[selection.k + 1] : undefined;
    if (p) { const s0 = sight(bi, selection.k + 1); selRect = toScreen({ x: s0.x, y: p.y - f.transom_mm / 2, w: s0.w, h: f.transom_mm }); }
  }

  // ------------------------------------------------------------ split preview
  let preview: ReactNode = null;
  if (hover && (tool === "split_v" || tool === "split_h") && !panning) {
    const bi = lay.findIndex((b) => hover.x >= b.x && hover.x < b.x + b.w);
    if (bi >= 0 && hover.y >= 0 && hover.y <= H) {
      const b = lay[bi];
      if (tool === "split_v") {
        const xl = snapV(hover.x - b.x);
        const ok = xl >= MIN_BAY && b.w - xl >= MIN_BAY;
        const x = b.x + xl;
        preview = (
          <Group listening={false}>
            <Line points={[x, 0, x, H]} stroke={ok ? C.sel : C.fail} strokeWidth={px(1.5)} dash={[px(6), px(4)]} />
            <Text x={x + px(6)} y={hover.y - px(22)} text={ok ? `${xl} | ${b.w - xl}` : `Min bay ${MIN_BAY} mm`} fontSize={px(12)} fontFamily={FONT} fill={ok ? C.sel : C.fail} fontStyle="bold" />
          </Group>
        );
      } else {
        const k = b.panes.findIndex((p) => hover.y >= p.y && hover.y < p.y + p.h);
        if (k >= 0) {
          const p = b.panes[k];
          const yl = snapV(hover.y - p.y);
          const ok = yl >= MIN_PANE && p.h - yl >= MIN_PANE;
          const y = p.y + yl;
          preview = (
            <Group listening={false}>
              <Line points={[b.x, y, b.x + b.w, y]} stroke={ok ? C.sel : C.fail} strokeWidth={px(1.5)} dash={[px(6), px(4)]} />
              <Text x={hover.x + px(8)} y={y - px(18)} text={ok ? `${yl} / ${p.h - yl}` : `Min pane ${MIN_PANE} mm`} fontSize={px(12)} fontFamily={FONT} fill={ok ? C.sel : C.fail} fontStyle="bold" />
            </Group>
          );
        }
      }
    }
  }

  // ------------------------------------------------------------ grid (screen space)
  const gridStep = useMemo(() => {
    const steps = [1, 5, 10, 50, 100, 500, 1000, 5000];
    return steps.find((st) => st * view.s >= 9) ?? 5000;
  }, [view.s]);
  const drawGrid = (major: boolean) => (ctx: Konva.Context, shape: Konva.Shape) => {
    const step = major ? gridStep * (String(gridStep).startsWith("5") ? 2 : 5) : gridStep;
    const x0 = Math.floor(-view.ox / view.s / step) * step, x1 = (size.w - view.ox) / view.s;
    const y0 = Math.floor(-view.oy / view.s / step) * step, y1 = (size.h - view.oy) / view.s;
    ctx.beginPath();
    for (let x = x0; x <= x1; x += step) { const sx = Math.round(x * view.s + view.ox) + 0.5; ctx.moveTo(sx, 0); ctx.lineTo(sx, size.h); }
    for (let y = y0; y <= y1; y += step) { const sy = Math.round(y * view.s + view.oy) + 0.5; ctx.moveTo(0, sy); ctx.lineTo(size.w, sy); }
    ctx.strokeShape(shape);
  };

  // ------------------------------------------------------------ dimension helper
  const dimH = (x1: number, x2: number, y: number, objY: number, label: string, key: string) => {
    const t = px(5), gap = px(4), ext = px(5);
    const dir = y < objY ? -1 : 1;
    const wide = (x2 - x1) * view.s > label.length * 6.5 + 8;
    return (
      <Group key={key} listening={false}>
        <Line points={[x1, objY + dir * gap, x1, y + dir * ext]} stroke={C.dim} strokeWidth={px(0.75)} />
        <Line points={[x2, objY + dir * gap, x2, y + dir * ext]} stroke={C.dim} strokeWidth={px(0.75)} />
        <Line points={[x1, y, x2, y]} stroke={C.dim} strokeWidth={px(0.9)} />
        <Line points={[x1 - t, y + t, x1 + t, y - t]} stroke={C.dim} strokeWidth={px(1.4)} />
        <Line points={[x2 - t, y + t, x2 + t, y - t]} stroke={C.dim} strokeWidth={px(1.4)} />
        {wide && <Text x={x1} width={x2 - x1} y={y - px(15)} text={label} align="center" fontSize={px(11)} fontFamily={FONT} fill={C.text} />}
      </Group>
    );
  };
  const dimV = (y1: number, y2: number, x: number, objX: number, label: string, key: string) => {
    const t = px(5), gap = px(4), ext = px(5);
    const dir = x < objX ? -1 : 1;
    const tall = (y2 - y1) * view.s > label.length * 6.5 + 8;
    return (
      <Group key={key} listening={false}>
        <Line points={[objX + dir * gap, y1, x + dir * ext, y1]} stroke={C.dim} strokeWidth={px(0.75)} />
        <Line points={[objX + dir * gap, y2, x + dir * ext, y2]} stroke={C.dim} strokeWidth={px(0.75)} />
        <Line points={[x, y1, x, y2]} stroke={C.dim} strokeWidth={px(0.9)} />
        <Line points={[x - t, y1 + t, x + t, y1 - t]} stroke={C.dim} strokeWidth={px(1.4)} />
        <Line points={[x - t, y2 + t, x + t, y2 - t]} stroke={C.dim} strokeWidth={px(1.4)} />
        {tall && <Text x={x - px(15)} y={y2} width={y2 - y1} text={label} rotation={-90} align="center" fontSize={px(11)} fontFamily={FONT} fill={C.text} />}
      </Group>
    );
  };

  // Right-hand chain: the selected bay's panes, else the bay with the most transoms.
  const refBay = (() => {
    const sel = selection && "bayId" in selection ? lay.find((b) => b.bay.id === selection.bayId) : undefined;
    return sel ?? lay.reduce((a, b) => (b.panes.length > a.panes.length ? b : a), lay[n - 1]);
  })();

  const isSel = (bayId: string, paneId: string) => selection?.kind === "pane" && selection.bayId === bayId && selection.paneId === paneId;

  return (
    <div ref={wrapRef} className={`relative select-none overflow-hidden ${className ?? ""}`} style={{ background: C.bg, touchAction: "none" }}>
      {size.w > 0 && (
        <Stage ref={stageRef} width={size.w} height={size.h} onPointerDown={onStageDown} onPointerMove={onStageMove}
          onPointerLeave={() => setHover(null)} onWheel={onWheel}
          onClick={(e) => { if (e.target === e.target.getStage() && !panning) props.onSelect(null); }}>
          {showGrid && (
            <Layer listening={false}>
              <Shape sceneFunc={drawGrid(false)} stroke={C.gridMinor} strokeWidth={1} />
              <Shape sceneFunc={drawGrid(true)} stroke={C.gridMajor} strokeWidth={1} />
            </Layer>
          )}
          <Layer>
            <Group x={view.ox} y={view.oy} scaleX={view.s} scaleY={view.s}>
              {/* Outer frame: aluminium band, glass is drawn over the sight openings */}
              <Rect x={0} y={0} width={W} height={H} fillLinearGradientStartPoint={{ x: 0, y: 0 }} fillLinearGradientEndPoint={{ x: W, y: H }}
                fillLinearGradientColorStops={[0, C.alu[0], 1, C.alu[1]]} stroke={C.aluStroke} strokeWidth={px(1)} listening={false} />

              {lay.map((b, bi) => b.panes.map((p, k) => {
                const r = sight(bi, k);
                const res = results?.get(paneKey(bi + 1, k + 1));
                const fail = res && !res.pass;
                const sel = isSel(b.bay.id, p.pane.id);
                const op = p.pane.operation;
                const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
                const roomy = r.w * view.s > 80 && r.h * view.s > 70;
                const leftButt = bi > 0 && f.bays[bi - 1].joint === "silicone_butt_joint";
                const rightButt = bi < n - 1 && b.bay.joint === "silicone_butt_joint";
                const tracks = isSliding(op) ? (p.pane.track_system === "3_track_heavy_duty" ? 3 : 2) : 0;
                const infill = p.pane.infill ?? "glass";
                const glass = infill === "glass";
                const dash = { stroke: C.sym, strokeWidth: px(1.2), dash: [px(7), px(5)] };
                return (
                  <Group key={p.pane.id}>
                    <Rect x={r.x} y={r.y} width={r.w} height={r.h} fill={glass ? C.glass : infill === "spandrel" ? C.spandrel : C.louvre} stroke={fail ? C.fail : sel ? C.sel : C.glassStroke}
                      strokeWidth={px(fail ? 3 : sel ? 2.5 : 1)} name="pane"
                      onClick={(e) => {
                        if (panning || e.evt.button !== 0) return;
                        const pt = stageRef.current?.getPointerPosition();
                        const w = pt ? toWorld(pt) : { x: cx, y: cy };
                        if (tool === "split_v") props.onSplitBay(b.bay.id, w.x - b.x);
                        else if (tool === "split_h") props.onSplitPane(b.bay.id, p.pane.id, w.y - p.y);
                        else props.onSelect({ kind: "pane", bayId: b.bay.id, paneId: p.pane.id });
                      }}
                      onTap={() => { if (tool === "select") props.onSelect({ kind: "pane", bayId: b.bay.id, paneId: p.pane.id }); }} />
                    {/* Flat-polished exposed edges: butt joints and frameless sliders */}
                    {/* Non-glass infills */}
                    {infill === "spandrel" && <Line points={[r.x, r.y, r.x + r.w, r.y + r.h, r.x + r.w, r.y, r.x, r.y + r.h]} stroke={C.muted} strokeWidth={px(1)} opacity={0.6} listening={false} />}
                    {infill === "louvre" && <Group listening={false}>{Array.from({ length: Math.max(2, Math.min(60, Math.floor(r.h / 100))) - 1 }).map((_, t, a) => {
                      const yy = r.y + (r.h * (t + 1)) / (a.length + 1);
                      return <Line key={t} points={[r.x, yy, r.x + r.w, yy]} stroke={C.muted} strokeWidth={px(1.4)} />;
                    })}</Group>}
                    {(leftButt || tracks > 0) && <Line points={[r.x, r.y, r.x, r.y + r.h]} stroke={C.polished} strokeWidth={px(2.5)} listening={false} />}
                    {(rightButt || tracks > 0) && <Line points={[r.x + r.w, r.y, r.x + r.w, r.y + r.h]} stroke={C.polished} strokeWidth={px(2.5)} listening={false} />}

                    {/* Operation symbols */}
                    <Group listening={false}>
                      {(op === "casement" || op === "tilt_turn" || op === "door") && <Line points={[r.x + r.w, r.y, r.x, cy, r.x + r.w, r.y + r.h]} {...dash} />}
                      {op === "tilt_turn" && <Line points={[r.x, r.y, cx, r.y + r.h, r.x + r.w, r.y]} {...dash} />}
                      {op === "door" && <Line points={[r.x, r.y + r.h - px(3), r.x + r.w, r.y + r.h - px(3)]} stroke={C.sym} strokeWidth={px(2)} />}
                      {op === "top_hung" && <Line points={[r.x, r.y + r.h, cx, r.y, r.x + r.w, r.y + r.h]} {...dash} />}
                      {tracks > 0 && Array.from({ length: tracks }).flatMap((_, t) => [
                        <Line key={`t${t}`} points={[r.x, r.y + px(4 + t * 3.5), r.x + r.w, r.y + px(4 + t * 3.5)]} stroke={C.track} strokeWidth={px(1.2)} />,
                        <Line key={`b${t}`} points={[r.x, r.y + r.h - px(4 + t * 3.5), r.x + r.w, r.y + r.h - px(4 + t * 3.5)]} stroke={C.track} strokeWidth={px(1.2)} />,
                      ])}
                      {isSliding(op) && (() => {
                        const L = Math.min(r.w * 0.45, px(110)), d = op === "sliding_left" ? -1 : 1;
                        return <Arrow points={[cx - (d * L) / 2, cy + (roomy ? px(26) : 0), cx + (d * L) / 2, cy + (roomy ? px(26) : 0)]} stroke={C.sym} fill={C.sym}
                          strokeWidth={px(2)} pointerLength={px(9)} pointerWidth={px(9)} />;
                      })()}
                      {op === "fixed" && glass && <Text x={r.x} width={r.w} y={cy + (roomy ? px(18) : -px(8))} text="F" align="center" fontSize={px(15)} fontStyle="bold" fontFamily={FONT} fill={C.muted} />}
                    </Group>

                    {/* Labels */}
                    {r.w * view.s > 54 && r.h * view.s > 34 && (
                      <Text x={r.x + px(6)} y={r.y + px(tracks ? 6 + tracks * 3.5 : 6)} text={`B${bi + 1}-${letter(k)}`} fontSize={px(11)} fontStyle="bold" fontFamily={FONT} fill={C.text} listening={false} />
                    )}
                    {roomy && (
                      <Group listening={false}>
                        <Text x={r.x} width={r.w} y={cy - px(22)} align="center" fontFamily={FONT} fontSize={px(11.5)} fill={C.text}
                          text={res ? `${res.glass_width_mm} × ${res.glass_height_mm}` : `${b.w} × ${p.h} mod.`} />
                        <Text x={r.x} width={r.w} y={cy - px(7)} align="center" fontFamily={FONT} fontSize={px(10.5)} fill={C.muted}
                          text={glass ? `${glassShort(p.pane.glass_spec)}${res ? ` · ${Math.round(res.utilisation * 100)}%` : ""}` : infillLabel(infill)} />
                      </Group>
                    )}
                    {fail && (
                      <Group x={r.x + r.w - px(14)} y={r.y + px(14 + tracks * 3.5)} listening={false}>
                        <Circle radius={px(10)} fill={C.fail} />
                        <Text x={-px(10)} y={-px(7)} width={px(20)} text="!" align="center" fontSize={px(14)} fontStyle="bold" fontFamily={FONT} fill="#fff" />
                        {r.w * view.s > 110 && <Text x={-px(78)} y={-px(6)} width={px(62)} align="right" text={res!.plate_pass ? "CHECK" : `FAIL ${Math.round(res!.utilisation * 100)}%`} fontSize={px(10.5)} fontStyle="bold" fontFamily={FONT} fill={C.fail} />}
                      </Group>
                    )}
                  </Group>
                );
              }))}

              {/* Transoms */}
              {lay.map((b, bi) => b.panes.slice(1).map((p, k0) => {
                const s0 = sight(bi, k0 + 1);
                const sel = selection?.kind === "transom" && selection.bayId === b.bay.id && selection.k === k0;
                const y = p.y - f.transom_mm / 2;
                const hit = Math.max(f.transom_mm, px(14));
                return (
                  <Group key={`tr-${p.pane.id}`}>
                    <Rect x={s0.x} y={y} width={s0.w} height={f.transom_mm} fillLinearGradientStartPoint={{ x: 0, y }} fillLinearGradientEndPoint={{ x: 0, y: y + f.transom_mm }}
                      fillLinearGradientColorStops={[0, C.alu[0], 1, C.alu[1]]} stroke={sel ? C.sel : C.aluStroke} strokeWidth={px(sel ? 2.5 : 1)} listening={false} />
                    <Rect x={s0.x} y={p.y - hit / 2} width={s0.w} height={hit} fill="rgba(0,0,0,0.001)"
                      onMouseEnter={() => !panning && setCursor("row-resize")} onMouseLeave={() => setCursor(baseCursor)}
                      onPointerDown={(e) => { if (panning || e.evt.button !== 0) return; e.cancelBubble = true; beginDrag({ kind: "transom", bayId: b.bay.id, k: k0 }, e.evt); }} />
                  </Group>
                );
              }))}

              {/* Vertical joints: mullion or silicone butt joint */}
              {lay.slice(1).map((b, i) => {
                const x = b.x;
                const bay = f.bays[i];
                const butt = bay.joint === "silicone_butt_joint";
                const sel = selection?.kind === "joint" && selection.bayIndex === i;
                const y0 = f.frame_mm, h = H - 2 * f.frame_mm;
                const hitW = Math.max(f.mullion_mm, px(16));
                const jr = joints?.get(i + 1);
                const finW = Math.max(jr?.min_fin_thickness_mm ?? 19, px(4));
                return (
                  <Group key={`j-${bay.id}`}>
                    {butt ? (
                      <Group listening={false}>
                        {bay.backing === "glass_fin" && <Rect x={x - finW / 2} y={y0} width={finW} height={h} fill={C.fin} stroke={C.polished} strokeWidth={px(1)} dash={[px(3), px(3)]} />}
                        <Rect x={x - f.butt_gap_mm / 2} y={y0} width={f.butt_gap_mm} height={h} fill={C.silicone} />
                        <Line points={[x - f.butt_gap_mm / 2 - px(2), y0, x - f.butt_gap_mm / 2 - px(2), y0 + h]} stroke={sel ? C.sel : C.butt} strokeWidth={px(sel ? 2 : 1.3)} dash={[px(6), px(4)]} />
                        <Line points={[x + f.butt_gap_mm / 2 + px(2), y0, x + f.butt_gap_mm / 2 + px(2), y0 + h]} stroke={sel ? C.sel : C.butt} strokeWidth={px(sel ? 2 : 1.3)} dash={[px(6), px(4)]} />
                        {h * view.s > 140 && (
                          <Text x={x - px(18)} y={y0 + h / 2 + px(52)} rotation={-90} width={px(104)} align="center" fontSize={px(10)} fontStyle="bold" fontFamily={FONT} fill={sel ? C.sel : C.butt}
                            text={`SSG ${f.butt_gap_mm} mm${jr?.required_bite_mm ? ` · bite ${jr.required_bite_mm}` : ""}`} />
                        )}
                      </Group>
                    ) : (
                      <Rect x={x - f.mullion_mm / 2} y={y0} width={f.mullion_mm} height={h} fillLinearGradientStartPoint={{ x: x - f.mullion_mm / 2, y: 0 }}
                        fillLinearGradientEndPoint={{ x: x + f.mullion_mm / 2, y: 0 }} fillLinearGradientColorStops={[0, C.alu[1], 0.45, C.alu[0], 1, C.alu[1]]}
                        stroke={sel ? C.sel : C.aluStroke} strokeWidth={px(sel ? 2.5 : 1)} listening={false} />
                    )}
                    <Rect x={x - hitW / 2} y={y0} width={hitW} height={h} fill="rgba(0,0,0,0.001)"
                      onMouseEnter={() => !panning && setCursor("col-resize")} onMouseLeave={() => setCursor(baseCursor)}
                      onPointerDown={(e) => { if (panning || e.evt.button !== 0) return; e.cancelBubble = true; beginDrag({ kind: "joint", i }, e.evt); }} />
                  </Group>
                );
              })}

              {preview}

              {/* Dimension chains */}
              {showDims && (
                <Group listening={false}>
                  {lay.map((b) => dimH(b.x, b.x + b.w, -px(30), 0, String(b.w), `dt-${b.bay.id}`))}
                  {dimH(0, W, H + px(32), H, `${W} mm`, "db")}
                  {dimV(0, H, -px(34), 0, `${H} mm`, "dl")}
                  {refBay && refBay.panes.length > 1 && refBay.panes.map((p) => dimV(p.y, p.y + p.h, W + px(30), W, String(p.h), `dr-${p.pane.id}`))}
                  {refBay && refBay.panes.length <= 1 && dimV(0, H, W + px(30), W, String(H), "dr")}
                </Group>
              )}
            </Group>
          </Layer>
        </Stage>
      )}

      {/* Zoom controls and cursor readout */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between p-2">
        <span className="pointer-events-auto rounded-md bg-white/85 px-2 py-1 font-mono text-[11px] text-slate-600 shadow-sm ring-1 ring-black/5 dark:bg-slate-900/85 dark:text-slate-300">
          {hover && hover.x >= 0 && hover.x <= W && hover.y >= 0 && hover.y <= H ? `x ${Math.round(hover.x)}  y ${Math.round(H - hover.y)} mm` : `${W} × ${H} mm`}
          <span className="ml-2 text-slate-400">grid {gridStep} · snap {snap}</span>
        </span>
        <div className="pointer-events-auto flex overflow-hidden rounded-lg bg-white/90 shadow-sm ring-1 ring-black/5 dark:bg-slate-900/90">
          <button type="button" className="p-1.5 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800" onClick={() => zoomAt(1 / 1.25)} aria-label="Zoom out" title="Zoom out"><Minus className="h-4 w-4" /></button>
          <span className="min-w-[3.25rem] self-center text-center text-[11px] tabular-nums text-slate-500">{Math.round((view.s / fitRef.current) * 100)}%</span>
          <button type="button" className="p-1.5 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800" onClick={() => zoomAt(1.25)} aria-label="Zoom in" title="Zoom in"><Plus className="h-4 w-4" /></button>
          <button type="button" className="border-l border-slate-200 p-1.5 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800" onClick={fit} aria-label="Zoom to fit" title="Zoom to fit (0)"><Maximize className="h-4 w-4" /></button>
        </div>
      </div>
      {overlay?.(selRect, size)}
    </div>
  );
}
