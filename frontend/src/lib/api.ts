export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

// Always same origin: Vite dev proxy locally, netlify.toml /api/* proxy in production
// (a cross-origin backend URL would break the SameSite=Lax auth cookie and CORS).

async function request<T>(method: string, url: string, body?: unknown, extraHeaders?: Record<string, string>): Promise<T> {
  const isForm = body instanceof FormData;
  let res: Response;
  try {
    res = await fetch(`/api/v1${url}`, {
      method,
      headers: { ...(isForm || body === undefined ? {} : { "Content-Type": "application/json" }), ...(extraHeaders ?? {}) },
      body: isForm ? (body as FormData) : body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError("Can't reach the VitroStack server. Is the backend running on port 8000?", 0);
  }
  if (res.status === 401 && !url.startsWith("/auth/")) window.dispatchEvent(new Event("vs:unauthorized"));
  if (res.status === 204) return undefined as T;
  if (!(res.headers.get("content-type") ?? "").includes("application/json")) {
    // e.g. a static host (Netlify) answering /api/* with index.html because no backend is wired up
    throw new ApiError("The VitroStack API is not reachable from this site (got a non-JSON response).", res.status || 502);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    let msg = "Something went wrong";
    if (typeof data.detail === "string") msg = data.detail;
    else if (Array.isArray(data.detail)) msg = data.detail.map((d: { loc?: string[]; msg: string }) => `${d.loc?.slice(-1)[0] ?? ""}: ${d.msg}`).join("; ");
    throw new ApiError(msg, res.status);
  }
  return data as T;
}

export const api = {
  get: <T>(url: string) => request<T>("GET", url),
  post: <T>(url: string, body?: unknown) => request<T>("POST", url, body ?? {}),
  patch: <T>(url: string, body: unknown) => request<T>("PATCH", url, body),
  put: <T>(url: string, body: unknown, headers?: Record<string, string>) => request<T>("PUT", url, body, headers),
  del: (url: string) => request<void>("DELETE", url),
  upload: <T>(url: string, file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return request<T>("POST", url, fd);
  },
};

// ---------------------------------------------------------------- types

export type Status = "draft" | "validated" | "optimized" | "quoted";

export interface Panel {
  id?: number;
  tag: string;
  width_mm: number;
  height_mm: number;
  quantity: number;
  floor_level?: string | null;
  notes?: string | null;
  needs_review?: boolean;
}

export interface PlateCheck {
  aspect_ratio: number;
  max_stress_mpa: number;
  allowable_stress_mpa: number;
  stress_utilisation: number;
  max_deflection_mm: number;
  allowable_deflection_mm: number;
  deflection_utilisation: number;
  governing: "stress" | "deflection";
  utilisation: number;
  pass: boolean;
}

export interface WindFactors { Vb: number; k1: number; k2: number; k3: number; k4: number; Kd: number; Ka: number; Kc: number; Cp_net: number }

export interface ProjectWind {
  city: string;
  height_m: number;
  terrain_category: number;
  terrain_label: string;
  zone: string;
  zone_label: string;
  factors: WindFactors;
  Vz_mps: number;
  pz_kpa: number;
  pd_kpa: number;
  design_pressure_kpa: number;
  glass_spec: string;
  glass_label: string;
  panels: (PlateCheck & { tag: string; width_mm: number; height_mm: number; quantity: number })[];
  all_safe: boolean;
  governing_panel: string;
  max_utilisation: number;
  failing_panels: string[];
  min_safe_toughened: string | null;
  min_safe_laminated: string | null;
  recommended_glass_spec: string | null;
}

export interface Silicone {
  sealant_label: string;
  calculated_bite_mm: number;
  bite_mm: number;
  glueline_thickness_mm: number;
  bite_to_thickness_ratio: number;
  structural_sausages_600ml: number;
  structural_cost_inr: number;
  weatherseal_label: string;
  weatherseal_sausages_600ml: number;
  weatherseal_cost_inr: number;
  governed_by_minimum: boolean;
  governing_short_span_mm?: number;
  total_perimeter_m?: number;
  panel_count?: number;
  notes: string[];
}

export interface Placement { uid: string; tag: string; x: number; y: number; w: number; h: number; rotated: boolean }
export interface Sheet {
  index: number;
  source: "jumbo" | "offcut";
  offcut_id: string | null;
  width_mm: number;
  height_mm: number;
  trim_mm: number;
  placements: Placement[];
  remnants: { x: number; y: number; w: number; h: number }[];
  utilisation_pct: number;
}
export interface CuttingTotals {
  jumbo_sheets: number;
  offcuts_used: number;
  panel_count: number;
  panel_area_m2: number;
  consumed_area_m2: number;
  reusable_remnant_area_m2: number;
  scrap_pct: number;
  gross_scrap_pct: number;
  target_scrap_pct: number;
}
export interface Cutting {
  jumbo_size_mm: [number, number];
  edge_trim_mm: number;
  kerf_mm: number;
  groups: (Omit<CuttingTotals, "target_scrap_pct"> & { glass_spec: string; heuristic: string; sheets: Sheet[] })[];
  totals: CuttingTotals;
  remnants_saved?: boolean;
}

export interface BomLine { category: string; item: string; qty: number; unit: string; rate: number; amount: number }
export interface Bom { lines: BomLine[]; direct_cost: number; panel_area_m2: number; perimeter_m: number; panel_count: number }
export interface Quote {
  margin_percent: number;
  direct_cost: number;
  profit: number;
  subtotal: number;
  gst_percent: number;
  gst: number;
  grand_total: number;
  rate_per_sqm: number;
  pdf_url?: string;
  priced_at?: string | null;
}

export interface ProjectSummary {
  id: string;
  name: string;
  client: string | null;
  city: string;
  building_height_m: number;
  terrain: number;
  zone: string;
  glass_spec: string;
  glass_label: string;
  sealant_grade: string;
  glazing_system: string | null;
  status: Status;
  panel_count: number;
  panel_types: number;
  panel_area_m2: number;
  all_safe: boolean | null;
  design_pressure_kpa: number | null;
  scrap_pct: number | null;
  jumbo_sheets: number | null;
  grand_total: number | null;
  created_at: string;
  updated_at: string;
}

export interface Project extends ProjectSummary {
  panels: Panel[];
  wind: ProjectWind | null;
  silicone: Silicone | null;
  cutting: Cutting | null;
  bom: Bom | null;
  quote: Quote | null;
}

export interface GlassOption { key: string; label: string; kind: string; treatment: string; rate_per_sqm: number }
export interface Reference {
  cities: [string, number][];
  glass: GlassOption[];
  terrain: Record<string, string>;
  zones: Record<string, string>;
  jumbo_mm: [number, number];
  floor_to_floor_m: number;
  default_margin_pct: number;
  gst_pct: number;
  prices_updated_at: string | null;
}

export interface ToolStep { tool: string; title: string; args: Record<string, unknown>; ok: boolean; result: any; duration_ms: number }
export interface PendingAction {
  id: string;
  tool: string;
  title: string;
  args: Record<string, any>;
  description: string;
  status?: "approved" | "cancelled" | "superseded";
}
export interface ChatMessage {
  id: number;
  role: "user" | "assistant";
  content: string;
  steps?: ToolStep[];
  pending_action?: PendingAction | null;
  project_id?: string | null;
  suggestions?: string[];
  attachments?: string[];
  engine?: string;
  engine_note?: string;
  created_at: string;
}

export interface Offcut {
  id: number;
  glass_spec: string;
  glass_label: string;
  width_mm: number;
  height_mm: number;
  /** Number of identical pieces stored in this row. */
  quantity: number;
  /** Area of one piece. */
  area_m2: number;
  /** area_m2 × quantity. */
  total_area_m2: number;
  rack: string | null;
  source: string | null;
  status: "available" | "reserved" | "used";
  reserved_for: string | null;
  created_at: string;
  /** Available pieces with the same glass, size and rack. */
  available_count: number;
  /** False when available_count <= 1: shown as Unavailable and skipped by the optimizer. */
  usable: boolean;
}

export interface Alert {
  id: number;
  kind: string;
  title: string;
  body: string;
  status: "open" | "approved" | "dismissed";
  project_id: string | null;
  payload: Record<string, any>;
  created_at: string;
}

export interface SiteEvent { id: number; phone: string; direction: "in" | "out"; text: string; project_id: string | null; created_at: string }
