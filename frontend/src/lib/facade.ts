/**
 * Facade studio: parametric elevation model.
 *
 * Two shapes live here:
 * - `Facade` is the editor state (stable ids, always explicit panes) that the canvas edits.
 * - `FacadeElevation` is the parametric JSON contract sent to /canvas/* and exported to other tools.
 *
 * Bay widths are module widths (frame edge or joint centreline to joint centreline) and always sum to the
 * overall width; pane heights do the same within a bay. Everything is integer millimetres, y down from the top.
 * Net glass sizes are NOT computed here: the backend engine owns them, so the canvas shows its results.
 */

import { layout as windowLayout, type Design as WindowDesign, type Node as WindowNode, type OpenType } from "./windowDesign";

// ---------------------------------------------------------------- contract (wire format)

export type Operation = "fixed" | "sliding_left" | "sliding_right" | "casement" | "top_hung" | "tilt_turn" | "door";
/** Non-glass infills are fixed panels: no glass check, listed separately in the BOM, not added to projects. */
export type Infill = "glass" | "spandrel" | "louvre";
export type GlassSpec = "10mm_toughened" | "12mm_toughened" | "13.52mm_laminated_toughened" | "24mm_dgu";
export type TrackSystem = "2_track_recessed" | "3_track_heavy_duty";
export type JointType = "aluminum_mullion" | "silicone_butt_joint";
export type Sealant = "Dow_Dowsil_995" | "Dow_Dowsil_993";
export type Backing = "none" | "glass_fin";

export interface AluminumMullionJoint {
  type: "aluminum_mullion";
  profile_mm: number;
}

export interface SiliconeButtJoint {
  type: "silicone_butt_joint";
  gap_mm: number;
  sealant: Sealant;
  backing: Backing;
  /** Filled from the last wind-load validation; null until it has run. */
  required_bite_mm: number | null;
}

export type Joint = AluminumMullionJoint | SiliconeButtJoint;

export interface ContractPane {
  pane_index: number;
  y_mm: number;
  height_mm: number;
  operation: Operation;
  glass_spec: GlassSpec;
  track_system: TrackSystem | null;
  infill?: Infill;
}

/** A bay with one pane carries operation / glass / track itself; a bay split by transoms lists `panes`. */
export interface ContractBay {
  bay_index: number;
  x_mm: number;
  width_mm: number;
  height_mm: number;
  operation?: Operation;
  glass_spec?: GlassSpec;
  track_system?: TrackSystem | null;
  infill?: Infill;
  right_joint: Joint | null;
  panes?: ContractPane[];
}

export interface FacadeElevation {
  elevation_id: string;
  overall_width_mm: number;
  overall_height_mm: number;
  wind_pressure_kpa: number;
  frame_mm: number;
  mullion_mm: number;
  transom_mm: number;
  quantity: number;
  bays: ContractBay[];
}

// ---------------------------------------------------------------- API results

export interface PaneResult {
  bay_index: number; pane_index: number; mark: string; infill: Infill; glass_spec: GlassSpec;
  glass_width_mm: number; glass_height_mm: number; support: string; weight_kg: number;
  max_stress_mpa: number; allowable_stress_mpa: number; max_deflection_mm: number; allowable_deflection_mm: number;
  governing: "stress" | "deflection"; utilisation: number; pass: boolean; plate_pass: boolean;
  warnings: string[]; recommended_glass_spec: GlassSpec | null; hint: string | null;
}
export interface JointResult {
  after_bay: number; type: JointType; gap_mm?: number; backing?: Backing; sealant_label?: string;
  short_span_mm?: number; calculated_bite_mm?: number; required_bite_mm?: number; joint_depth_mm?: number;
  min_fin_thickness_mm?: number; profile_mm?: number;
}
export interface Issue { level: "error" | "warning"; bay_index: number | null; pane_index: number | null; message: string }
export interface WindValidation {
  elevation_id: string; wind_pressure_kpa: number; pass: boolean;
  summary: { panes: number; failing: number; max_utilisation: number };
  panes: PaneResult[]; bays: { bay_index: number; pass: boolean; max_utilisation: number }[];
  joints: JointResult[]; issues: Issue[]; assumptions: string[];
  wind: { city: string; design_pressure_kpa: number; Vz_mps: number; pz_kpa: number } | null;
}
export interface BomGlass {
  mark: string; bay_index: number; pane_index: number; operation: Operation; glass_spec: GlassSpec; glass_label: string;
  width_mm: number; height_mm: number; quantity: number; area_m2: number; weight_kg: number;
  polished_edges: string[]; polished_edge_m: number;
}
export interface FacadeBom {
  elevation_id: string; quantity: number; glass: BomGlass[];
  infill_panels: { mark: string; bay_index: number; pane_index: number; infill: Infill; label: string;
    width_mm: number; height_mm: number; quantity: number; area_m2: number }[];
  glass_by_spec: { glass_spec: GlassSpec; glass_label: string; units: number; area_m2: number }[];
  cutting_list: { glass_spec: string; width_mm: number; height_mm: number; quantity: number }[];
  aluminium: { frame_m: number; mullion_m: number; transom_m: number; sash_m: number; total_m: number;
    tracks: { track_system: TrackSystem; label: string; length_m: number }[] };
  silicone: { butt_joint_m: number; net_ml: number; wastage_factor: number; sausages_600ml: number;
    lines: { sealant: string; label: string; net_ml: number; sausages_600ml: number; cost_inr: number }[] };
  polished_edge_m: number;
  totals: { glass_units: number; glass_area_m2: number; glass_weight_kg: number };
  issues: Issue[];
}

// ---------------------------------------------------------------- catalogue

export const OPERATIONS: { value: Operation; label: string; short: string }[] = [
  { value: "fixed", label: "Fixed", short: "F" },
  { value: "sliding_left", label: "Sliding left", short: "←" },
  { value: "sliding_right", label: "Sliding right", short: "→" },
  { value: "casement", label: "Casement vent", short: "C" },
  { value: "top_hung", label: "Top-hung vent", short: "TH" },
  { value: "tilt_turn", label: "Tilt & turn vent", short: "TT" },
  { value: "door", label: "Door", short: "D" },
];
export const INFILLS: { value: Infill; label: string }[] = [
  { value: "glass", label: "Glass" },
  { value: "spandrel", label: "Spandrel panel" },
  { value: "louvre", label: "Louvre" },
];
export const GLASS_SPECS: { value: GlassSpec; label: string; short: string }[] = [
  { value: "10mm_toughened", label: "10 mm toughened", short: "10T" },
  { value: "12mm_toughened", label: "12 mm toughened", short: "12T" },
  { value: "13.52mm_laminated_toughened", label: "13.52 mm clear laminated toughened", short: "13.52 LT" },
  { value: "24mm_dgu", label: "24 mm DGU (6 + 12 + 6)", short: "24 DGU" },
];
export const TRACKS: { value: TrackSystem; label: string; tracks: number }[] = [
  { value: "2_track_recessed", label: "2-track recessed", tracks: 2 },
  { value: "3_track_heavy_duty", label: "3-track heavy duty", tracks: 3 },
];
export const SEALANTS: { value: Sealant; label: string }[] = [
  { value: "Dow_Dowsil_995", label: "DOWSIL 995 (1-part)" },
  { value: "Dow_Dowsil_993", label: "DOWSIL 993 (2-part)" },
];

export const MIN_BAY = 200;
export const MIN_PANE = 150;
export const isSliding = (o: Operation) => o === "sliding_left" || o === "sliding_right";
export const glassShort = (g: GlassSpec) => GLASS_SPECS.find((x) => x.value === g)?.short ?? g;
export const isVent = (o: Operation) => o === "casement" || o === "top_hung" || o === "tilt_turn" || o === "door";
export const infillLabel = (i: Infill) => INFILLS.find((x) => x.value === i)?.label ?? i;
export const opLabel = (o: Operation) => OPERATIONS.find((x) => x.value === o)?.label ?? o;

// ---------------------------------------------------------------- editor model

export interface Pane {
  id: string;
  height_mm: number;
  operation: Operation;
  glass_spec: GlassSpec;
  track_system: TrackSystem;
  infill: Infill;
}
export interface Bay {
  id: string;
  width_mm: number;
  panes: Pane[];
  /** Joint on the right of this bay; ignored for the last bay. */
  joint: JointType;
  backing: Backing;
}
export interface Facade {
  kind: "facade";
  name: string;
  elevation_id: string;
  width_mm: number;
  height_mm: number;
  wind_pressure_kpa: number;
  frame_mm: number;
  mullion_mm: number;
  transom_mm: number;
  butt_gap_mm: number;
  sealant: Sealant;
  quantity: number;
  /** Floor written on schedule rows when the elevation is added to a project. */
  floor_level: string;
  /** Project this elevation was last added to. */
  project_id?: string | null;
  bays: Bay[];
}

let seq = 0;
export const uid = () => `${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

export function newPane(height_mm: number, from?: Partial<Pane>): Pane {
  return { id: uid(), height_mm, operation: from?.operation ?? "fixed", glass_spec: from?.glass_spec ?? "12mm_toughened",
    track_system: from?.track_system ?? "2_track_recessed", infill: from?.infill ?? "glass" };
}

export function blankFacade(): Facade {
  const H = 3000;
  return {
    kind: "facade", name: "Untitled elevation", elevation_id: "W-101", width_mm: 4800, height_mm: H,
    wind_pressure_kpa: 1.85, frame_mm: 50, mullion_mm: 50, transom_mm: 50, butt_gap_mm: 8, sealant: "Dow_Dowsil_995",
    quantity: 1, floor_level: "",
    bays: [1600, 1600, 1600].map((w) => ({ id: uid(), width_mm: w, panes: [newPane(H, { glass_spec: "12mm_toughened" })],
      joint: "silicone_butt_joint" as JointType, backing: "glass_fin" as Backing })),
  };
}

export const TEMPLATES: { name: string; description: string; make: () => Facade }[] = [
  { name: "Butt-glazed storefront", description: "Three bays, fin-backed silicone butt joints", make: blankFacade },
  {
    name: "Sliding patio", description: "Fixed – sliding – fixed on a 2-track", make: () => {
      const f = blankFacade();
      f.name = "Sliding patio"; f.width_mm = 4500; f.height_mm = 2700;
      f.bays = [1500, 1500, 1500].map((w, i) => ({ id: uid(), width_mm: w, joint: "aluminum_mullion", backing: "none",
        panes: [newPane(2700, { operation: i === 1 ? "sliding_left" : "fixed", glass_spec: "12mm_toughened" })] }));
      return f;
    },
  },
  {
    name: "Curtain wall with vents", description: "Mullions and transoms, top-hung vents above", make: () => {
      const f = blankFacade();
      f.name = "Curtain wall module"; f.width_mm = 3600; f.height_mm = 3600;
      f.bays = [1200, 1200, 1200].map((w) => ({ id: uid(), width_mm: w, joint: "aluminum_mullion", backing: "none",
        panes: [newPane(900, { operation: "top_hung", glass_spec: "24mm_dgu" }), newPane(2700, { glass_spec: "24mm_dgu" })] }));
      return f;
    },
  },
  {
    name: "Single pane", description: "One framed bay to start from scratch", make: () => {
      const f = blankFacade();
      f.name = "Untitled elevation"; f.width_mm = 1800; f.height_mm = 2400;
      f.bays = [{ id: uid(), width_mm: 1800, joint: "aluminum_mullion", backing: "none", panes: [newPane(2400)] }];
      return f;
    },
  },
];

// ---------------------------------------------------------------- layout

export interface PaneBox { pane: Pane; index: number; y: number; h: number }
export interface BayBox { bay: Bay; index: number; x: number; w: number; panes: PaneBox[] }

export function layout(f: Facade): BayBox[] {
  let x = 0;
  return f.bays.map((bay, index) => {
    let y = 0;
    const panes = bay.panes.map((pane, i) => { const b = { pane, index: i, y, h: pane.height_mm }; y += pane.height_mm; return b; });
    const b = { bay, index, x, w: bay.width_mm, panes };
    x += bay.width_mm;
    return b;
  });
}

export const letter = (i: number) => String.fromCharCode(65 + (i % 26)) + (i >= 26 ? String(Math.floor(i / 26)) : "");
export const paneKey = (bayIndex1: number, paneIndex1: number) => `${bayIndex1}-${paneIndex1}`;

// ---------------------------------------------------------------- edits (pure)

const snapTo = (v: number, s: number) => Math.round(v / s) * s;

/** Split a bay with a new mullion `xLocal` mm from its left edge. The new right bay copies the transoms. */
export function splitBay(f: Facade, bayId: string, xLocal: number, snap: number): Facade | null {
  const i = f.bays.findIndex((b) => b.id === bayId);
  if (i < 0) return null;
  const b = f.bays[i];
  const left = snapTo(xLocal, snap);
  if (left < MIN_BAY || b.width_mm - left < MIN_BAY) return null;
  const right: Bay = { ...b, id: uid(), width_mm: b.width_mm - left, panes: b.panes.map((p) => ({ ...p, id: uid() })) };
  const bays = [...f.bays];
  bays.splice(i, 1, { ...b, width_mm: left, joint: "aluminum_mullion", backing: "none" }, right);
  return { ...f, bays };
}

/** Split a pane with a new transom `yLocal` mm from its top edge. */
export function splitPane(f: Facade, bayId: string, paneId: string, yLocal: number, snap: number): Facade | null {
  const bays = f.bays.map((b) => {
    if (b.id !== bayId) return b;
    const k = b.panes.findIndex((p) => p.id === paneId);
    if (k < 0) return b;
    const p = b.panes[k];
    const top = snapTo(yLocal, snap);
    if (top < MIN_PANE || p.height_mm - top < MIN_PANE) return b;
    const panes = [...b.panes];
    panes.splice(k, 1, { ...p, height_mm: top }, { ...newPane(p.height_mm - top, p) });
    return { ...b, panes };
  });
  return bays.some((b, i) => b !== f.bays[i]) ? { ...f, bays } : null;
}

export function toggleJoint(f: Facade, bayIndex: number): Facade {
  return { ...f, bays: f.bays.map((b, i) => i === bayIndex
    ? { ...b, joint: b.joint === "aluminum_mullion" ? "silicone_butt_joint" : "aluminum_mullion" } : b) };
}

export function setJoint(f: Facade, bayIndex: number, patch: Partial<Pick<Bay, "joint" | "backing">>): Facade {
  return { ...f, bays: f.bays.map((b, i) => (i === bayIndex ? { ...b, ...patch } : b)) };
}

/** Remove the joint on the right of bay `bayIndex`, merging it with the next bay (left bay's panes win). */
export function removeJoint(f: Facade, bayIndex: number): Facade {
  const a = f.bays[bayIndex], b = f.bays[bayIndex + 1];
  if (!a || !b) return f;
  const bays = [...f.bays];
  bays.splice(bayIndex, 2, { ...a, width_mm: a.width_mm + b.width_mm, joint: b.joint, backing: b.backing });
  return { ...f, bays };
}

/** Remove the transom below pane `k` of a bay, merging the two panes (upper pane's settings win). */
export function removeTransom(f: Facade, bayId: string, k: number): Facade {
  return { ...f, bays: f.bays.map((b) => {
    if (b.id !== bayId || k < 0 || k >= b.panes.length - 1) return b;
    const panes = [...b.panes];
    panes.splice(k, 2, { ...b.panes[k], height_mm: b.panes[k].height_mm + b.panes[k + 1].height_mm });
    return { ...b, panes };
  }) };
}

/** Move the joint right of bay `bayIndex` to absolute x (mm). */
export function moveJoint(f: Facade, bayIndex: number, xAbs: number, snap: number): Facade {
  const lay = layout(f);
  const a = lay[bayIndex], b = lay[bayIndex + 1];
  if (!a || !b) return f;
  const x = Math.min(Math.max(snapTo(xAbs, snap), a.x + MIN_BAY), b.x + b.w - MIN_BAY);
  const wa = x - a.x, wb = b.x + b.w - x;
  if (wa === a.w) return f;
  return { ...f, bays: f.bays.map((bay, i) => (i === bayIndex ? { ...bay, width_mm: wa } : i === bayIndex + 1 ? { ...bay, width_mm: wb } : bay)) };
}

/** Move the transom below pane `k` of a bay to absolute y (mm). */
export function moveTransom(f: Facade, bayId: string, k: number, yAbs: number, snap: number): Facade {
  return { ...f, bays: f.bays.map((b) => {
    if (b.id !== bayId) return b;
    let top = 0;
    for (let i = 0; i < k; i++) top += b.panes[i].height_mm;
    const bottom = top + b.panes[k].height_mm + b.panes[k + 1].height_mm;
    const y = Math.min(Math.max(snapTo(yAbs, snap), top + MIN_PANE), bottom - MIN_PANE);
    const h1 = y - top;
    if (h1 === b.panes[k].height_mm) return b;
    const panes = b.panes.map((p, i) => (i === k ? { ...p, height_mm: h1 } : i === k + 1 ? { ...p, height_mm: bottom - y } : p));
    return { ...b, panes };
  }) };
}

export function updatePane(f: Facade, paneId: string, patch: Partial<Pane>): Facade {
  return { ...f, bays: f.bays.map((b) => (b.panes.some((p) => p.id === paneId) ? { ...b, panes: b.panes.map((p) => (p.id === paneId ? { ...p, ...patch } : p)) } : b)) };
}

/** Exact width of one bay; the neighbour on the right (or left, for the last bay) absorbs the difference. */
export function setBayWidth(f: Facade, bayIndex: number, w: number): Facade | null {
  const n = f.bays.length;
  if (n < 2) return null;
  const j = bayIndex < n - 1 ? bayIndex + 1 : bayIndex - 1;
  const other = f.bays[j].width_mm - (w - f.bays[bayIndex].width_mm);
  if (w < MIN_BAY || other < MIN_BAY) return null;
  return { ...f, bays: f.bays.map((b, i) => (i === bayIndex ? { ...b, width_mm: w } : i === j ? { ...b, width_mm: other } : b)) };
}

export function setPaneHeight(f: Facade, bayId: string, k: number, h: number): Facade | null {
  const b = f.bays.find((x) => x.id === bayId);
  if (!b || b.panes.length < 2) return null;
  const j = k < b.panes.length - 1 ? k + 1 : k - 1;
  const other = b.panes[j].height_mm - (h - b.panes[k].height_mm);
  if (h < MIN_PANE || other < MIN_PANE) return null;
  return { ...f, bays: f.bays.map((x) => (x.id !== bayId ? x : { ...x, panes: x.panes.map((p, i) => (i === k ? { ...p, height_mm: h } : i === j ? { ...p, height_mm: other } : p)) })) };
}

function distribute(parts: number[], total: number): number[] {
  const sum = parts.reduce((a, b) => a + b, 0);
  const out = parts.map((p) => Math.round((p / sum) * total));
  out[out.length - 1] += total - out.reduce((a, b) => a + b, 0);
  return out;
}

/** Change the overall size, scaling bays and panes in proportion. Null if something would get too small. */
export function resize(f: Facade, W: number, H: number): Facade | null {
  const ws = distribute(f.bays.map((b) => b.width_mm), W);
  if (ws.some((w) => w < MIN_BAY)) return null;
  const bays = f.bays.map((b, i) => {
    const hs = distribute(b.panes.map((p) => p.height_mm), H);
    return { ...b, width_mm: ws[i], panes: b.panes.map((p, k) => ({ ...p, height_mm: hs[k] })) };
  });
  if (bays.some((b) => b.panes.some((p) => p.height_mm < MIN_PANE))) return null;
  return { ...f, width_mm: W, height_mm: H, bays };
}

export function equalizeBays(f: Facade): Facade {
  const ws = distribute(f.bays.map(() => 1), f.width_mm);
  return { ...f, bays: f.bays.map((b, i) => ({ ...b, width_mm: ws[i] })) };
}

// ---------------------------------------------------------------- contract conversion

export function toContract(f: Facade, joints?: JointResult[] | null): FacadeElevation {
  const bites = new Map((joints ?? []).map((j) => [j.after_bay, j.required_bite_mm ?? null]));
  return {
    elevation_id: f.elevation_id.trim() || "W-101",
    overall_width_mm: f.width_mm,
    overall_height_mm: f.height_mm,
    wind_pressure_kpa: f.wind_pressure_kpa,
    frame_mm: f.frame_mm,
    mullion_mm: f.mullion_mm,
    transom_mm: f.transom_mm,
    quantity: f.quantity,
    bays: layout(f).map(({ bay, index, x, w, panes }) => {
      const last = index === f.bays.length - 1;
      const joint: Joint | null = last ? null : bay.joint === "silicone_butt_joint"
        ? { type: "silicone_butt_joint", gap_mm: f.butt_gap_mm, sealant: f.sealant, backing: bay.backing, required_bite_mm: bites.get(index + 1) ?? null }
        : { type: "aluminum_mullion", profile_mm: f.mullion_mm };
      const base = { bay_index: index + 1, x_mm: x, width_mm: w, height_mm: f.height_mm, right_joint: joint };
      if (panes.length === 1) {
        const p = panes[0].pane;
        return { ...base, operation: p.operation, glass_spec: p.glass_spec, track_system: isSliding(p.operation) ? p.track_system : null, infill: p.infill };
      }
      return { ...base, panes: panes.map(({ pane: p, index: k, y, h }) => ({
        pane_index: k + 1, y_mm: y, height_mm: h, operation: p.operation, glass_spec: p.glass_spec,
        track_system: isSliding(p.operation) ? p.track_system : null, infill: p.infill })) };
    }),
  };
}

const OPS = new Set(OPERATIONS.map((o) => o.value));
const GLS = new Set(GLASS_SPECS.map((o) => o.value));
const INF = new Set(INFILLS.map((o) => o.value));

/** Build editor state from pasted / imported parametric JSON. Throws with a readable message. */
export function fromContract(raw: unknown, base: Facade): Facade {
  const c = raw as FacadeElevation;
  if (!c || typeof c !== "object" || !Array.isArray(c.bays) || !c.bays.length) throw new Error("JSON needs a non-empty \"bays\" array");
  const W = Math.round(Number(c.overall_width_mm)), H = Math.round(Number(c.overall_height_mm));
  if (!(W >= 300 && H >= 300)) throw new Error("overall_width_mm and overall_height_mm must be at least 300");
  const sorted = [...c.bays].sort((a, b) => a.bay_index - b.bay_index);
  const pick = <T,>(v: unknown, ok: Set<string>, d: T) => (typeof v === "string" && ok.has(v) ? (v as T) : d);
  const bays: Bay[] = sorted.map((b) => {
    const rp = b.panes?.length ? [...b.panes].sort((a, z) => a.pane_index - z.pane_index)
      : [{ pane_index: 1, y_mm: 0, height_mm: H, operation: b.operation ?? "fixed", glass_spec: b.glass_spec ?? "12mm_toughened", track_system: b.track_system ?? null, infill: b.infill }];
    return {
      id: uid(), width_mm: Math.round(Number(b.width_mm)),
      joint: b.right_joint?.type === "silicone_butt_joint" ? "silicone_butt_joint" : "aluminum_mullion",
      backing: (b.right_joint as SiliconeButtJoint | null)?.backing === "glass_fin" ? "glass_fin" : "none",
      panes: rp.map((p) => newPane(Math.round(Number(p.height_mm)), {
        operation: pick<Operation>(p.operation, OPS, "fixed"), glass_spec: pick<GlassSpec>(p.glass_spec, GLS, "12mm_toughened"),
        track_system: p.track_system === "3_track_heavy_duty" ? "3_track_heavy_duty" : "2_track_recessed",
        infill: pick<Infill>(p.infill, INF, "glass") })),
    };
  });
  const sw = bays.reduce((a, b) => a + b.width_mm, 0);
  if (Math.abs(sw - W) > 1) throw new Error(`Bay widths add up to ${sw} mm, not ${W} mm`);
  bays.forEach((b, i) => {
    const sh = b.panes.reduce((a, p) => a + p.height_mm, 0);
    if (Math.abs(sh - H) > 1) throw new Error(`Pane heights in bay ${i + 1} add up to ${sh} mm, not ${H} mm`);
  });
  const butt = sorted.find((b) => b.right_joint?.type === "silicone_butt_joint")?.right_joint as SiliconeButtJoint | undefined;
  return {
    ...base, elevation_id: String(c.elevation_id ?? base.elevation_id).slice(0, 40), width_mm: W, height_mm: H,
    wind_pressure_kpa: Number(c.wind_pressure_kpa) > 0 ? Number(c.wind_pressure_kpa) : base.wind_pressure_kpa,
    frame_mm: Number(c.frame_mm) || base.frame_mm, mullion_mm: Number(c.mullion_mm) || base.mullion_mm,
    transom_mm: Number(c.transom_mm) || base.transom_mm, quantity: Number(c.quantity) || 1,
    butt_gap_mm: butt?.gap_mm ?? base.butt_gap_mm, sealant: butt?.sealant === "Dow_Dowsil_993" ? "Dow_Dowsil_993" : base.sealant,
    bays,
  };
}

/** Defensive load of saved / drafted editor state. */
export function hydrateFacade(x: unknown): Facade {
  const f = x as Facade;
  if (!f || f.kind !== "facade" || !Array.isArray(f.bays) || !f.bays.length) return blankFacade();
  return { ...blankFacade(), ...f, floor_level: f.floor_level ?? "", bays: f.bays.map((b) => ({ ...b, id: b.id || uid(), backing: b.backing ?? "none", panes: b.panes.map((p) => ({ ...newPane(p.height_mm, p), id: p.id || uid() })) })) };
}

// ---------------------------------------------------------------- legacy window designs

const LEGACY_OPS: Record<OpenType, Operation> = {
  fixed: "fixed", casement_l: "casement", casement_r: "casement", top_hung: "top_hung", bottom_hung: "top_hung",
  tilt_turn: "tilt_turn", slide_l: "sliding_left", slide_r: "sliding_right", door_l: "door", door_r: "door",
};

/** Why a saved window-designer design can't become an elevation, or null when it can. */
export function legacyBlocker(d: WindowDesign): string | null {
  if (!d?.root) return "No layout";
  if (d.shape && d.shape !== "rect") return "Shaped head";
  const r = d.root;
  if (r.kind === "leaf") return null;
  const flatH = (n: WindowNode) => n.kind === "leaf" || (n.dir === "h" && n.children.every((c) => c.kind === "leaf"));
  if (r.dir === "v" ? r.children.every(flatH) : r.children.every((c) => c.kind === "leaf")) return null;
  return "Nested layout";
}

/**
 * Convert a rectangular window-designer design (mullions, each bay optionally split by transoms) into an
 * elevation. Sizes become module sizes measured to the bar centrelines. Returns null if it can't convert.
 */
export function fromWindowDesign(d: WindowDesign): Facade | null {
  if (legacyBlocker(d)) return null;
  const W = Math.round(d.width_mm), H = Math.round(d.height_mm), m = d.mullion_mm;
  const { cells } = windowLayout(d);
  const cols = new Map<number, typeof cells>();
  for (const c of cells) {
    const k = Math.round(c.x);
    cols.set(k, [...(cols.get(k) ?? []), c]);
  }
  // Module boundaries: the frame edges and the bar centrelines (the next cell's start minus half a bar).
  const modules = (starts: number[], total: number) => {
    const cuts = [0, ...starts.slice(1).map((v) => Math.round(v - m / 2)), total];
    return cuts.slice(1).map((c, i) => c - cuts[i]);
  };
  const xs = [...cols.keys()].sort((a, b) => a - b);
  const widths = modules(xs, W);
  const bays: Bay[] = xs.map((x, i) => {
    const col = [...cols.get(x)!].sort((a, b) => a.y - b.y);
    const hs = modules(col.map((c) => c.y), H);
    return { id: uid(), width_mm: widths[i], joint: "aluminum_mullion" as JointType, backing: "none" as Backing,
      panes: col.map((c, k) => newPane(hs[k], {
        operation: c.leaf.fill === "glass" ? LEGACY_OPS[c.leaf.open] ?? "fixed" : "fixed", infill: c.leaf.fill })) };
  });
  if (bays.some((b) => b.width_mm < MIN_BAY || b.panes.some((p) => p.height_mm < MIN_PANE))) return null;
  return { ...blankFacade(), name: d.name || "Converted window", elevation_id: (d.tag || "W01").slice(0, 40),
    width_mm: W, height_mm: H, frame_mm: d.frame_mm, mullion_mm: m, transom_mm: m, quantity: d.quantity || 1,
    floor_level: d.floor_level ?? "", bays };
}
