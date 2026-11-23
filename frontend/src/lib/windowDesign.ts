// Window designer model + geometry. All dimensions are millimetres, origin at the
// top-left of the outer frame, y pointing down (same as SVG).

export type OpenType =
  | "fixed" | "casement_l" | "casement_r" | "top_hung" | "bottom_hung" | "tilt_turn"
  | "slide_l" | "slide_r" | "door_l" | "door_r";
export type Fill = "glass" | "spandrel" | "louvre";
export type Shape = "rect" | "arch" | "segment" | "rake_l" | "rake_r" | "gable";

export interface Leaf { id: string; kind: "leaf"; open: OpenType; fill: Fill }
/** dir "v" = vertical mullions (children side by side); "h" = transoms (children stacked). */
export interface Split { id: string; kind: "split"; dir: "v" | "h"; sizes: number[]; children: Node[] }
export type Node = Leaf | Split;

export interface Design {
  name: string;
  tag: string;
  width_mm: number;
  height_mm: number;
  shape: Shape;
  rise_mm: number;
  frame_mm: number;
  mullion_mm: number;
  sash_mm: number;
  rebate_mm: number;
  quantity: number;
  floor_level: string;
  root: Node;
}

export const MIN_PANE = 150;

export const OPEN_TYPES: { value: OpenType; label: string; short: string }[] = [
  { value: "fixed", label: "Fixed", short: "F" },
  { value: "casement_l", label: "Casement · hinge left", short: "CL" },
  { value: "casement_r", label: "Casement · hinge right", short: "CR" },
  { value: "top_hung", label: "Top-hung", short: "TH" },
  { value: "bottom_hung", label: "Bottom-hung", short: "BH" },
  { value: "tilt_turn", label: "Tilt & turn", short: "TT" },
  { value: "slide_l", label: "Sliding · opens left", short: "SL" },
  { value: "slide_r", label: "Sliding · opens right", short: "SR" },
  { value: "door_l", label: "Door · hinge left", short: "DL" },
  { value: "door_r", label: "Door · hinge right", short: "DR" },
];
export const openLabel = (o: OpenType) => OPEN_TYPES.find((x) => x.value === o)?.label ?? o;

export const SHAPES: { value: Shape; label: string }[] = [
  { value: "rect", label: "Rectangle" },
  { value: "arch", label: "Round arch" },
  { value: "segment", label: "Segmental arch" },
  { value: "gable", label: "Gable" },
  { value: "rake_l", label: "Raked ↙" },
  { value: "rake_r", label: "Raked ↘" },
];

export const uidShort = () => Math.random().toString(36).slice(2, 9);
export const leaf = (open: OpenType = "fixed", fill: Fill = "glass"): Leaf => ({ id: uidShort(), kind: "leaf", open, fill });
export const split = (dir: "v" | "h", children: Node[], sizes?: number[]): Split =>
  ({ id: uidShort(), kind: "split", dir, children, sizes: sizes ?? children.map(() => 1000) });

export const isOpenable = (o: OpenType) => o !== "fixed";

// ---------------------------------------------------------------- shape outline

/** Effective rise of the shaped head (round arch is always half the width). */
export function riseOf(d: Design): number {
  if (d.shape === "rect") return 0;
  if (d.shape === "arch") return d.width_mm / 2;
  return Math.max(0, Math.min(d.rise_mm, d.shape === "segment" ? d.width_mm / 2 : d.height_mm - 300));
}

/** y of the outer outline's top edge at x. */
export function topY(d: Design, x: number): number {
  const W = d.width_mm, r = riseOf(d);
  if (!r) return 0;
  const cx = Math.max(0, Math.min(W, x));
  switch (d.shape) {
    case "arch": {
      const R = W / 2;
      return R - Math.sqrt(Math.max(0, R * R - (cx - R) ** 2));
    }
    case "segment": {
      const R = (W * W / 4 + r * r) / (2 * r);
      return r - (Math.sqrt(Math.max(0, R * R - (cx - W / 2) ** 2)) - (R - r));
    }
    case "gable": return r * Math.abs(cx - W / 2) / (W / 2);
    case "rake_l": return r * (1 - cx / W);
    case "rake_r": return r * (cx / W);
    default: return 0;
  }
}

export function outlinePath(d: Design): string {
  const W = d.width_mm, H = d.height_mm, r = riseOf(d);
  switch (d.shape) {
    case "arch": return `M0 ${H} V${r} A${W / 2} ${W / 2} 0 0 1 ${W} ${r} V${H} Z`;
    case "segment": {
      if (!r) break;
      const R = (W * W / 4 + r * r) / (2 * r);
      return `M0 ${H} V${r} A${R} ${R} 0 0 1 ${W} ${r} V${H} Z`;
    }
    case "gable": return `M0 ${H} V${r} L${W / 2} 0 L${W} ${r} V${H} Z`;
    case "rake_l": return `M0 ${H} V${r} L${W} 0 V${H} Z`;
    case "rake_r": return `M0 ${H} V0 L${W} ${r} V${H} Z`;
  }
  return `M0 0 H${W} V${H} H0 Z`;
}

export function outlinePerimeter(d: Design): number {
  const W = d.width_mm, H = d.height_mm, r = riseOf(d);
  let top = 0;
  const N = 64;
  for (let i = 0; i < N; i++) {
    const x0 = (W * i) / N, x1 = (W * (i + 1)) / N;
    top += Math.hypot(x1 - x0, topY(d, x1) - topY(d, x0));
  }
  return top + W + 2 * H - (r ? topY(d, 0) + topY(d, W) : 0);
}

// ---------------------------------------------------------------- layout

export interface Rect { x: number; y: number; w: number; h: number }
export interface Cell extends Rect { leaf: Leaf; label: string }
export interface Bar extends Rect { splitId: string; index: number; dir: "v" | "h"; lens: number[]; avail: number }
export interface SplitBox extends Rect { split: Split; lens: number[] }

export function layout(d: Design): { cells: Cell[]; bars: Bar[]; splits: SplitBox[] } {
  const cells: Cell[] = [], bars: Bar[] = [], splits: SplitBox[] = [];
  const f = d.frame_mm, m = d.mullion_mm;
  const rec = (n: Node, r: Rect) => {
    if (n.kind === "leaf") { cells.push({ ...r, leaf: n, label: "" }); return; }
    const along = n.dir === "v" ? r.w : r.h;
    const avail = along - m * (n.children.length - 1);
    const sum = n.sizes.reduce((a, b) => a + b, 0) || 1;
    const lens = n.sizes.map((s) => (s / sum) * avail);
    splits.push({ ...r, split: n, lens });
    let pos = n.dir === "v" ? r.x : r.y;
    n.children.forEach((c, i) => {
      const len = lens[i];
      rec(c, n.dir === "v" ? { x: pos, y: r.y, w: len, h: r.h } : { x: r.x, y: pos, w: r.w, h: len });
      pos += len;
      if (i < n.children.length - 1) {
        bars.push({ ...(n.dir === "v" ? { x: pos, y: r.y, w: m, h: r.h } : { x: r.x, y: pos, w: r.w, h: m }),
          splitId: n.id, index: i, dir: n.dir, lens, avail });
        pos += m;
      }
    });
  };
  rec(d.root, { x: f, y: f, w: d.width_mm - 2 * f, h: d.height_mm - 2 * f });
  // Reading order: top-to-bottom, then left-to-right → A, B, C…
  [...cells].sort((a, b) => (Math.abs(a.y - b.y) > 1 ? a.y - b.y : a.x - b.x))
    .forEach((c, i) => { c.label = paneLetter(i); });
  return { cells, bars, splits };
}

export const paneLetter = (i: number) => (i < 26 ? String.fromCharCode(65 + i) : `P${i + 1}`);

// ---------------------------------------------------------------- glass schedule

export interface Pane {
  id: string;
  label: string;
  open: OpenType;
  fill: Fill;
  /** Sight opening between frame / mullion faces. */
  sight: Rect;
  /** Glass (or infill) cut size: bounding rectangle for shaped panes. */
  glass_w: number;
  glass_h: number;
  /** Actual infill area in m² (less than w×h when the pane is shaped). */
  area_m2: number;
  shaped: boolean;
  /** Clear ventilation opening in m² (openable panes only). */
  vent_m2: number;
}

export function panes(d: Design): Pane[] {
  const { cells } = layout(d);
  const f = d.frame_mm;
  return cells.map((c) => {
    // Where the shaped head cuts into this cell, trim the usable region column by column.
    const N = 48;
    let minTop = Infinity, area = 0, xmin = Infinity, xmax = -Infinity, shaped = false;
    for (let i = 0; i <= N; i++) {
      const x = c.x + (c.w * i) / N;
      if (topY(d, x) + f > c.y + 1) shaped = true;
      const top = Math.max(c.y, topY(d, x) + f);
      const hgt = c.y + c.h - top;
      if (hgt > 1) {
        minTop = Math.min(minTop, top);
        xmin = Math.min(xmin, x);
        xmax = Math.max(xmax, x);
        if (i < N) area += hgt * (c.w / N);
      }
    }
    const bw = xmax > xmin ? xmax - xmin : 0, bh = minTop === Infinity ? 0 : c.y + c.h - minTop;
    const open = isOpenable(c.leaf.open);
    // Openable panes sit in a sash; glass is the daylight opening plus the rebate engagement each side.
    const sash = open ? d.sash_mm : 0;
    const gw = Math.max(0, Math.round(bw - 2 * sash + 2 * d.rebate_mm));
    const gh = Math.max(0, Math.round(bh - 2 * sash + 2 * d.rebate_mm));
    const scale = bw * bh > 0 ? area / (bw * bh) : 0;
    return {
      id: c.leaf.id, label: c.label, open: c.leaf.open, fill: c.leaf.fill,
      sight: { x: c.x, y: c.y, w: c.w, h: c.h },
      glass_w: gw, glass_h: gh,
      area_m2: +((gw * gh * (shaped ? scale : 1)) / 1e6).toFixed(3),
      shaped,
      vent_m2: open ? +(((bw - 2 * sash) * (bh - 2 * sash) * (shaped ? scale : 1)) / 1e6).toFixed(3) : 0,
    };
  });
}

export interface Summary {
  panes: number;
  glass_panes: number;
  glass_area_m2: number;
  window_area_m2: number;
  vent_pct: number;
  frame_m: number;
  mullion_m: number;
  sash_m: number;
  width_mm: number;
  height_mm: number;
  shape: Shape;
}

export function summarize(d: Design): Summary {
  const ps = panes(d);
  const { bars } = layout(d);
  const outlineArea = windowArea(d);
  const glass = ps.filter((p) => p.fill === "glass");
  return {
    panes: ps.length,
    glass_panes: glass.length,
    glass_area_m2: +glass.reduce((a, p) => a + p.area_m2, 0).toFixed(2),
    window_area_m2: +(outlineArea / 1e6).toFixed(2),
    vent_pct: outlineArea ? +((ps.reduce((a, p) => a + p.vent_m2, 0) * 1e6 / outlineArea) * 100).toFixed(1) : 0,
    frame_m: +(outlinePerimeter(d) / 1000).toFixed(2),
    mullion_m: +(bars.reduce((a, b) => a + (b.dir === "v" ? b.h : b.w), 0) / 1000).toFixed(2),
    sash_m: +(ps.filter((p) => isOpenable(p.open)).reduce((a, p) => a + 2 * (p.sight.w + p.sight.h), 0) / 1000).toFixed(2),
    width_mm: d.width_mm, height_mm: d.height_mm, shape: d.shape,
  };
}

function windowArea(d: Design): number {
  const N = 96;
  let a = 0;
  for (let i = 0; i < N; i++) a += (d.height_mm - topY(d, (d.width_mm * (i + 0.5)) / N)) * (d.width_mm / N);
  return a;
}

/** Problems that make the design unbuildable; shown inline and block "Add to project". */
export function designIssues(d: Design): string[] {
  const out: string[] = [];
  if (d.width_mm < 300 || d.height_mm < 300) out.push("Window must be at least 300 × 300 mm.");
  if (d.width_mm > 6000 || d.height_mm > 6000) out.push("Window can't exceed 6000 mm in either direction.");
  if (d.frame_mm < 20 || d.frame_mm > 200) out.push("Frame face width should be 20–200 mm.");
  if (d.shape === "arch" && d.height_mm < d.width_mm / 2 + 2 * d.frame_mm + MIN_PANE)
    out.push("A round arch needs height of at least half the width plus the frame.");
  const ps = panes(d);
  const tiny = ps.filter((p) => p.sight.w < MIN_PANE - 1 || p.sight.h < MIN_PANE - 1 || p.glass_w <= 0 || p.glass_h <= 0);
  if (tiny.length) out.push(`Pane${tiny.length > 1 ? "s" : ""} ${tiny.map((p) => p.label).join(", ")} ${tiny.length > 1 ? "are" : "is"} smaller than ${MIN_PANE} mm.`);
  const big = ps.filter((p) => p.fill === "glass" && (Math.max(p.glass_w, p.glass_h) > 3660 || Math.min(p.glass_w, p.glass_h) > 2440));
  if (big.length) out.push(`Glass ${big.map((p) => p.label).join(", ")} won't fit a 3660 × 2440 jumbo sheet.`);
  return out;
}

// ---------------------------------------------------------------- tree edits (immutable)

export function findPath(root: Node, id: string): Node[] | null {
  if (root.id === id) return [root];
  if (root.kind === "split") for (const c of root.children) {
    const p = findPath(c, id);
    if (p) return [root, ...p];
  }
  return null;
}

function mapNode(root: Node, id: string, fn: (n: Node) => Node): Node {
  if (root.id === id) return fn(root);
  if (root.kind === "split") return { ...root, children: root.children.map((c) => mapNode(c, id, fn)) };
  return root;
}

export function updateLeaf(root: Node, id: string, patch: Partial<Pick<Leaf, "open" | "fill">>): Node {
  return mapNode(root, id, (n) => (n.kind === "leaf" ? { ...n, ...patch } : n));
}

/** Split a pane into n equal parts. If the parent already splits the same way, the new
 *  panes join the parent so one dimension chain describes the whole row / column. */
export function splitLeaf(d: Design, id: string, dir: "v" | "h", n: number): { root: Node; newId: string } {
  const path = findPath(d.root, id);
  if (!path) return { root: d.root, newId: id };
  const target = path[path.length - 1] as Leaf;
  const made = Array.from({ length: n }, (_, i) => (i === 0 ? target : { ...target, id: uidShort() }));
  const parent = path[path.length - 2] as Split | undefined;
  const { splits } = layout(d);
  if (parent && parent.dir === dir) {
    const lens = splits.find((s) => s.split.id === parent.id)!.lens;
    const i = parent.children.findIndex((c) => c.id === id);
    const part = lens[i] / n;
    const root = mapNode(d.root, parent.id, (p) => {
      const s = p as Split;
      return { ...s, children: [...s.children.slice(0, i), ...made, ...s.children.slice(i + 1)],
        sizes: [...lens.slice(0, i), ...made.map(() => part), ...lens.slice(i + 1)] };
    });
    return { root, newId: target.id };
  }
  return { root: mapNode(d.root, id, () => split(dir, made)), newId: target.id };
}

export function removeLeaf(root: Node, id: string): Node {
  const path = findPath(root, id);
  if (!path || path.length < 2) return root;
  const parent = path[path.length - 2] as Split;
  const i = parent.children.findIndex((c) => c.id === id);
  const children = parent.children.filter((_, k) => k !== i);
  const sizes = parent.sizes.slice();
  // Give the removed pane's share to its neighbour so the others keep their size.
  const nb = i > 0 ? i - 1 : 1;
  sizes[nb] += sizes[i];
  sizes.splice(i, 1);
  const replacement: Node = children.length === 1 ? children[0] : { ...parent, children, sizes };
  return mapNode(root, parent.id, () => replacement);
}

export function setSizes(root: Node, splitId: string, sizes: number[]): Node {
  return mapNode(root, splitId, (n) => (n.kind === "split" ? { ...n, sizes } : n));
}

export function equalize(root: Node, splitId: string): Node {
  return mapNode(root, splitId, (n) => (n.kind === "split" ? { ...n, sizes: n.sizes.map(() => 1000) } : n));
}

/** Resize child i of a split to `len` mm, taking the difference from its neighbour. */
export function resizeChild(lens: number[], i: number, len: number): number[] | null {
  const nb = i < lens.length - 1 ? i + 1 : i - 1;
  if (nb < 0) return null;
  const total = lens[i] + lens[nb];
  const v = Math.round(len);
  if (v < MIN_PANE || total - v < MIN_PANE) return null;
  const out = lens.slice();
  out[i] = v;
  out[nb] = total - v;
  return out;
}

/** The nearest ancestor split in a direction that contains this pane, with the child index. */
export function ancestorSplit(d: Design, id: string, dir: "v" | "h"): { box: SplitBox; index: number } | null {
  const path = findPath(d.root, id);
  if (!path) return null;
  const { splits } = layout(d);
  for (let k = path.length - 2; k >= 0; k--) {
    const n = path[k];
    if (n.kind === "split" && n.dir === dir) {
      const box = splits.find((s) => s.split.id === n.id)!;
      return { box, index: n.children.findIndex((c) => c.id === path[k + 1].id) };
    }
  }
  return null;
}

// ---------------------------------------------------------------- templates

const base = (over: Partial<Design>): Design => ({
  name: "New window", tag: "W01", width_mm: 1200, height_mm: 1500, shape: "rect", rise_mm: 300,
  frame_mm: 60, mullion_mm: 50, sash_mm: 55, rebate_mm: 12, quantity: 1, floor_level: "",
  root: leaf(), ...over,
});

export const TEMPLATES: { key: string; label: string; make: () => Design }[] = [
  { key: "fixed", label: "Fixed light", make: () => base({ name: "Fixed light" }) },
  { key: "casement2", label: "Double casement", make: () => base({ name: "Double casement", root: split("v", [leaf("casement_l"), leaf("casement_r")]) }) },
  { key: "toplight", label: "Casement + top light", make: () => base({
    name: "Casement with top light", width_mm: 1800, height_mm: 2100,
    root: split("h", [leaf("top_hung"), split("v", [leaf("casement_l"), leaf("fixed"), leaf("casement_r")])], [450, 1530]),
  }) },
  { key: "slider", label: "2-track slider", make: () => base({ name: "Sliding window", width_mm: 2400, height_mm: 1500, root: split("v", [leaf("slide_r"), leaf("slide_l")]) }) },
  { key: "door", label: "French door + fanlight", make: () => base({
    name: "French door", width_mm: 1800, height_mm: 2700,
    root: split("h", [leaf("fixed"), split("v", [leaf("door_l"), leaf("door_r")])], [450, 2130]),
  }) },
  { key: "arch", label: "Arched window", make: () => base({
    name: "Arched window", width_mm: 1200, height_mm: 2100, shape: "arch",
    root: split("h", [leaf("fixed"), split("v", [leaf("casement_l"), leaf("casement_r")])], [550, 1380]),
  }) },
  { key: "gable", label: "Gable window", make: () => base({
    name: "Gable window", width_mm: 2400, height_mm: 2400, shape: "gable", rise_mm: 700,
    root: split("v", [leaf(), leaf(), leaf()]),
  }) },
  { key: "cw", label: "Curtain-wall bay", make: () => base({
    name: "Curtain wall bay", width_mm: 1500, height_mm: 3300, frame_mm: 50, mullion_mm: 50,
    root: split("h", [leaf("fixed"), leaf("top_hung"), leaf("fixed", "spandrel")], [1800, 600, 750]),
  }) },
];

export const blankDesign = () => TEMPLATES[1].make();

/** Normalise anything loaded from storage / the server into a valid Design. */
export function hydrate(raw: Partial<Design> | null | undefined): Design {
  const d = base({});
  if (!raw || typeof raw !== "object" || !raw.root) return blankDesign();
  return { ...d, ...raw, root: raw.root } as Design;
}

/** Approximate glass weight, kg (2.5 kg per m² per mm of glass). */
export function glassKg(areaM2: number, specKey: string): number {
  const t = parseFloat(specKey) || 0;
  return Math.round(areaM2 * t * 2.5);
}
