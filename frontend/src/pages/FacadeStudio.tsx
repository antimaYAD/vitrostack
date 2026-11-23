import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import {
  AlertTriangle, Braces, Columns2, Copy, Download, Equal, FolderOpen, FolderPlus, Grid3x3, Hand, LayoutTemplate, MousePointer2, Redo2,
  Ruler, Rows2, Save, ShieldAlert, ShieldCheck, Trash2, Undo2, Upload, Wind, X,
} from "lucide-react";
import { api, type Panel, type Project, type ProjectSummary } from "../lib/api";
import { cn, num, timeAgo, useApi, useDebounced } from "../lib/utils";
import { Badge, Button, Card, CardHeader, EmptyState, Field, Input, Modal, PageHeader, Segmented, Select, Skeleton, Spinner, UtilBar } from "../components/ui";
import { CityInput, HeightInput } from "../components/ProjectForm";
import { useApp } from "../components/Layout";
import type { Design as WindowDesign } from "../lib/windowDesign";
import WindowDesignCanvas, { type ScreenRect, type Selection, type Tool } from "../components/WindowDesignCanvas";
import {
  type Facade, type FacadeBom, type GlassSpec, type Infill, type JointResult, type Operation, type PaneResult, type WindValidation,
  GLASS_SPECS, INFILLS, OPERATIONS, fromWindowDesign, infillLabel, legacyBlocker, SEALANTS, TEMPLATES, TRACKS, blankFacade, equalizeBays, fromContract, glassShort, hydrateFacade, isSliding,
  layout, letter, moveJoint, moveTransom, opLabel, paneKey, removeJoint, removeTransom, resize, setBayWidth, setJoint, setPaneHeight,
  splitBay, splitPane, toContract, toggleJoint, updatePane,
} from "../lib/facade";

interface FacadeRecord { id: string; name: string; project_id?: string | null; data: Facade; summary: Record<string, unknown> | null; created_by: string | null; updated_at: string }
interface LegacyRecord { id: string; name: string; data: WindowDesign; created_by: string | null; updated_at: string }

const DRAFT_KEY = "vs-facade-draft";

function useIsDark() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));
  useEffect(() => {
    const o = new MutationObserver(() => setDark(document.documentElement.classList.contains("dark")));
    o.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => o.disconnect();
  }, []);
  return dark;
}

function loadDraft(): { facade: Facade; savedId: string | null; savedJson: string | null } | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const x = JSON.parse(raw);
    return { facade: hydrateFacade(x.facade), savedId: x.savedId ?? null, savedJson: x.savedJson ?? null };
  } catch { return null; }
}

export default function FacadeStudio() {
  const [params, setParams] = useSearchParams();
  const dark = useIsDark();
  const draft = useMemo(loadDraft, []);
  const [hist, setHist] = useState(() => ({ past: [] as Facade[], present: draft?.facade ?? blankFacade(), future: [] as Facade[] }));
  const f = hist.present;
  const [savedId, setSavedId] = useState<string | null>(draft?.savedId ?? null);
  const [savedJson, setSavedJson] = useState<string | null>(draft?.savedJson ?? null);
  const [tool, setTool] = useState<Tool>("select");
  const [snap, setSnap] = useState<"1" | "5">("5");
  const [showGrid, setShowGrid] = useState(true);
  const [showDims, setShowDims] = useState(true);
  const [selection, setSelection] = useState<Selection>(null);
  const [modal, setModal] = useState<null | "templates" | "library" | "import" | "project">(null);
  const nav = useNavigate();
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  // Where the inspector goes: floating over a wide canvas, else docked in the side panel (lg) or under the canvas.
  const [wide, setWide] = useState(() => window.innerWidth >= 1024);
  const [canvasW, setCanvasW] = useState(0);
  const canvasCard = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const on = () => setWide(window.innerWidth >= 1024);
    window.addEventListener("resize", on);
    const el = canvasCard.current;
    const ro = el ? new ResizeObserver(() => setCanvasW(el.clientWidth)) : null;
    if (el && ro) ro.observe(el);
    return () => { window.removeEventListener("resize", on); ro?.disconnect(); };
  }, []);
  const floating = canvasW >= 960;

  // ------------------------------------------------------------ history
  const commit = useCallback((next: Facade | null | ((d: Facade) => Facade | null)) => {
    setHist((h) => {
      const n = typeof next === "function" ? next(h.present) : next;
      if (!n || n === h.present) return h;
      return { past: [...h.past.slice(-99), h.present], present: n, future: [] };
    });
  }, []);
  const replace = useCallback((fn: (d: Facade) => Facade) => setHist((h) => ({ ...h, present: fn(h.present) })), []);
  const snapshot = useCallback(() => setHist((h) => ({ past: [...h.past.slice(-99), h.present], present: h.present, future: [] })), []);
  const undo = useCallback(() => setHist((h) => (h.past.length ? { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] } : h)), []);
  const redo = useCallback(() => setHist((h) => (h.future.length ? { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) } : h)), []);

  const json = useMemo(() => JSON.stringify(f), [f]);
  const dirty = json !== savedJson;

  useEffect(() => {
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ facade: f, savedId, savedJson })); } catch { /* storage full or blocked */ }
  }, [f, savedId, savedJson]);

  // Selection must point at something that still exists.
  useEffect(() => {
    if (!selection) return;
    if (selection.kind === "pane" && !f.bays.some((b) => b.id === selection.bayId && b.panes.some((p) => p.id === selection.paneId))) setSelection(null);
    if (selection.kind === "joint" && selection.bayIndex >= f.bays.length - 1) setSelection(null);
    if (selection.kind === "transom" && !f.bays.some((b) => b.id === selection.bayId && selection.k < b.panes.length - 1)) setSelection(null);
  }, [f, selection]);

  // ------------------------------------------------------------ open saved design from ?design=
  useEffect(() => {
    const id = params.get("design");
    if (!id) return;
    api.get<FacadeRecord>(`/designs/${id}`).then((r) => {
      const d = hydrateFacade(r.data);
      setHist({ past: [], present: d, future: [] });
      setSavedId(r.id);
      setSavedJson(JSON.stringify(d));
      setSelection(null);
    }).catch((e) => toast.error((e as Error).message));
    params.delete("design");
    setParams(params, { replace: true });
  }, [params, setParams]);

  // ?project=<id> (from a project's schedule): link the elevation so its site drives the wind pressure.
  useEffect(() => {
    const pid = params.get("project");
    if (!pid) return;
    replace((d) => ({ ...d, project_id: pid }));
    params.delete("project");
    setParams(params, { replace: true });
  }, [params, setParams, replace]);
  const { data: project } = useApi<Project>(f.project_id ? `/projects/${f.project_id}` : null, [f.project_id]);

  // ------------------------------------------------------------ live engineering (debounced)
  const contract = useMemo(() => toContract(f), [f]);
  const debounced = useDebounced(JSON.stringify(contract), 350);
  const [check, setCheck] = useState<WindValidation | null>(null);
  const [bom, setBom] = useState<FacadeBom | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const reqId = useRef(0);
  useEffect(() => {
    const id = ++reqId.current;
    const body = JSON.parse(debounced);
    setBusy(true);
    Promise.all([api.post<WindValidation>("/canvas/validate-wind-load", body), api.post<FacadeBom>("/canvas/extract-bom", body)])
      .then(([c, b]) => { if (id === reqId.current) { setCheck(c); setBom(b); setApiError(null); } })
      .catch((e) => { if (id === reqId.current) setApiError((e as Error).message); })
      .finally(() => { if (id === reqId.current) setBusy(false); });
  }, [debounced]);
  const stale = debounced !== JSON.stringify(contract) || busy;

  const results = useMemo(() => new Map((check?.panes ?? []).map((p) => [paneKey(p.bay_index, p.pane_index), p])), [check]);
  const jointMap = useMemo(() => new Map((check?.joints ?? []).map((j) => [j.after_bay, j])), [check]);
  const exportContract = useMemo(() => toContract(f, check?.joints), [f, check]);

  // ------------------------------------------------------------ actions
  const snapMm = Number(snap);
  const reject = (msg: string) => toast.error(msg, { id: "facade-reject" });
  const onSplitBay = (bayId: string, x: number) => {
    const n = splitBay(f, bayId, x, snapMm);
    if (!n) return reject("Each bay must stay at least 200 mm wide");
    commit(n);
  };
  const onSplitPane = (bayId: string, paneId: string, y: number) => {
    const n = splitPane(f, bayId, paneId, y, snapMm);
    if (!n) return reject("Each pane must stay at least 150 mm high");
    commit(n);
  };

  const save = useCallback(async () => {
    setSaving(true);
    try {
      const summary = { elevation_id: f.elevation_id, width_mm: f.width_mm, height_mm: f.height_mm, bays: f.bays.length,
        panes: f.bays.reduce((a, b) => a + b.panes.length, 0), pass: check?.pass ?? null };
      const body = { name: f.name.trim() || f.elevation_id, data: f, summary, project_id: f.project_id ?? null };
      const r = savedId ? await api.put<FacadeRecord>(`/designs/${savedId}`, body) : await api.post<FacadeRecord>("/designs", body);
      setSavedId(r.id);
      setSavedJson(json);
      toast.success("Elevation saved to library");
    } catch (e) { toast.error((e as Error).message); }
    finally { setSaving(false); }
  }, [f, check, savedId, json]);

  const exportDxf = async () => {
    setExporting(true);
    try {
      const res = await fetch("/api/v1/canvas/export-dxf", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(exportContract) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail ?? "Export failed");
      const blob = await res.blob();
      const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? `${f.elevation_id}.dxf`;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      toast.success(`Downloaded ${name}`);
    } catch (e) { toast.error(typeof (e as Error).message === "string" ? (e as Error).message : "Export failed"); }
    finally { setExporting(false); }
  };

  const newFrom = (d: Facade) => {
    commit(d);
    setSavedId(null);
    setSavedJson(null);
    setSelection(null);
    setModal(null);
  };

  const removeSelected = useCallback(() => {
    if (selection?.kind === "joint") { commit((d) => removeJoint(d, selection.bayIndex)); setSelection(null); }
    else if (selection?.kind === "transom") { commit((d) => removeTransom(d, selection.bayId, selection.k)); setSelection(null); }
  }, [selection, commit]);

  // ------------------------------------------------------------ keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "s") { e.preventDefault(); save(); return; }
      if (typing || modal) return;
      if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
      if (mod && e.key.toLowerCase() === "y") { e.preventDefault(); redo(); return; }
      if (mod) return;
      const k = e.key.toLowerCase();
      if (k === "s") setTool("select");
      else if (k === "v") setTool("split_v");
      else if (k === "h") setTool("split_h");
      else if (k === "p") setTool("pan");
      else if (k === "g") setShowGrid((x) => !x);
      else if (e.key === "Delete" || e.key === "Backspace") removeSelected();
      else if (e.key === "Escape") { setSelection(null); setTool("select"); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save, undo, redo, removeSelected, modal]);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (dirty && savedId) e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, savedId]);

  // ------------------------------------------------------------ inspector
  const inspector = selection ? (
    <Inspector f={f} selection={selection} results={results} joints={jointMap} commit={commit}
      onClose={() => setSelection(null)} onRemove={removeSelected} />
  ) : null;

  const overlay = (rect: ScreenRect | null, size: { w: number; h: number }) => {
    if (!rect || !inspector || !floating) return null;
    // Dock in the top corner away from the selection, so it never covers what is being edited.
    const W = 304;
    const left = rect.x + rect.w / 2 < size.w / 2 ? size.w - W - 10 : 10;
    return <div className="absolute top-2.5 z-10 flex flex-col" style={{ left, width: W, maxHeight: size.h - 56 }}>{inspector}</div>;
  };

  const issues = check?.issues ?? [];
  const failing = check?.summary.failing ?? 0;

  return (
    <div>
      <PageHeader eyebrow="Designer" title={<span className="flex items-center gap-2">{f.name || "Untitled elevation"}{dirty && savedId && <Badge tone="amber">Unsaved</Badge>}</span>}
        subtitle={<>Draw a window or structural-glazing elevation to scale. Glass sizes, IS 875 checks and quantities update as you draw.
          {project && <> Linked to <Link to={`/projects/${project.id}?tab=panels`} className="link">{project.name}</Link>.</>}</>}
        actions={<>
          <Button variant="secondary" icon={<LayoutTemplate className="h-4 w-4" />} onClick={() => setModal("templates")}>New</Button>
          <Button variant="secondary" icon={<FolderOpen className="h-4 w-4" />} onClick={() => setModal("library")}>Library</Button>
          <Button variant="secondary" icon={<Download className="h-4 w-4" />} loading={exporting} onClick={exportDxf}>DXF</Button>
          <Button variant="secondary" icon={<FolderPlus className="h-4 w-4" />} onClick={() => setModal("project")}>Add to project</Button>
          <Button icon={<Save className="h-4 w-4" />} loading={saving} onClick={save}>{savedId ? "Save" : "Save to library"}</Button>
        </>} />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-4">
          <div ref={canvasCard}>
          <Card className="overflow-hidden">
            {/* Toolbar */}
            <div className="flex flex-wrap items-center gap-1 border-b border-slate-100 px-2 py-1.5 dark:border-slate-800">
              <ToolBtn label="Select (S)" active={tool === "select"} onClick={() => setTool("select")}><MousePointer2 className="h-4 w-4" /><span className="hidden xl:inline">Select</span></ToolBtn>
              <ToolBtn label="Add mullion (V)" active={tool === "split_v"} onClick={() => setTool("split_v")}><Columns2 className="h-4 w-4" /><span className="hidden xl:inline">Mullion</span></ToolBtn>
              <ToolBtn label="Add transom (H)" active={tool === "split_h"} onClick={() => setTool("split_h")}><Rows2 className="h-4 w-4" /><span className="hidden xl:inline">Transom</span></ToolBtn>
              <ToolBtn label="Pan (P, or hold Space)" active={tool === "pan"} onClick={() => setTool("pan")}><Hand className="h-4 w-4" /></ToolBtn>
              <Sep />
              <Segmented size="sm" value={snap} onChange={setSnap} options={[{ value: "1", label: "1 mm" }, { value: "5", label: "5 mm" }]} />
              <ToolBtn label="Grid (G)" active={showGrid} onClick={() => setShowGrid((x) => !x)}><Grid3x3 className="h-4 w-4" /></ToolBtn>
              <ToolBtn label="Dimensions" active={showDims} onClick={() => setShowDims((x) => !x)}><Ruler className="h-4 w-4" /></ToolBtn>
              <ToolBtn label="Equal bay widths" onClick={() => commit(equalizeBays)} disabled={f.bays.length < 2}><Equal className="h-4 w-4" /></ToolBtn>
              <Sep />
              <ToolBtn label="Undo (Ctrl+Z)" onClick={undo} disabled={!hist.past.length}><Undo2 className="h-4 w-4" /></ToolBtn>
              <ToolBtn label="Redo (Ctrl+Shift+Z)" onClick={redo} disabled={!hist.future.length}><Redo2 className="h-4 w-4" /></ToolBtn>
              <div className="ml-auto flex items-center gap-2 pr-1 text-xs">
                {stale ? <span className="flex items-center gap-1.5 text-slate-500"><Spinner className="h-3.5 w-3.5" /> Checking</span>
                  : apiError ? <Badge tone="rose">Not checked</Badge>
                  : check && (check.pass ? <Badge tone="emerald" dot>All panes pass</Badge> : <Badge tone="rose" dot>{failing ? `${failing} pane${failing > 1 ? "s" : ""} fail` : "Fix issues"}</Badge>)}
              </div>
            </div>
            <WindowDesignCanvas className="h-[440px] sm:h-[560px]" facade={f} tool={tool} snap={snapMm} showGrid={showGrid} showDims={showDims} dark={dark}
              selection={selection} results={apiError ? undefined : results} joints={jointMap} onSelect={setSelection}
              onSplitBay={onSplitBay} onSplitPane={onSplitPane} onToggleJoint={(i) => commit((d) => toggleJoint(d, i))}
              onDragStart={snapshot} onDragEnd={() => {}}
              onMoveJoint={(i, x) => replace((d) => moveJoint(d, i, x, snapMm))}
              onMoveTransom={(bayId, k, y) => replace((d) => moveTransom(d, bayId, k, y, snapMm))}
              overlay={overlay} />
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-slate-100 px-3 py-2 text-[11px] text-slate-500 dark:border-slate-800">
              <span><b className="font-medium text-slate-700 dark:text-slate-300">Click a divider</b> to switch mullion ⇄ silicone butt joint; drag it to move.</span>
              <Legend color="bg-teal-500" label="Flat-polished edge" />
              <Legend color="bg-slate-800" label="8 mm silicone" dashed />
              <Legend color="bg-rose-500" label="Fails IS 875" />
            </div>
          </Card>
          </div>

          {!floating && !wide && inspector}

          {apiError && (
            <Card className="flex items-start gap-3 border-rose-200 bg-rose-50/60 p-4 text-sm text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-300">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span>{apiError}</span>
            </Card>
          )}
          {!apiError && issues.length > 0 && (
            <Card className="p-4">
              <p className="mb-2 text-sm font-medium">Design issues</p>
              <ul className="space-y-1.5 text-sm">
                {issues.map((x, i) => (
                  <li key={i} className="flex items-start gap-2">
                    {x.level === "error" ? <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />}
                    <span className="text-slate-700 dark:text-slate-300">{x.message}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
            <Mini label="IS 875" value={check ? (check.pass ? "Pass" : "Fail") : "—"} tone={check ? (check.pass ? "good" : "bad") : undefined} sub={check ? `max ${Math.round(check.summary.max_utilisation * 100)}% used` : undefined} />
            <Mini label="Glass" value={bom ? `${num(bom.totals.glass_area_m2, 2)} m²` : "—"} sub={bom ? `${bom.totals.glass_units} units · ${num(bom.totals.glass_weight_kg)} kg` : undefined} />
            <Mini label="Aluminium" value={bom ? `${num(bom.aluminium.total_m, 1)} m` : "—"} sub="frame, mullions, tracks" />
            <Mini label="Silicone" value={bom ? `${bom.silicone.sausages_600ml} × 600 ml` : "—"} sub={bom ? `${num(bom.silicone.butt_joint_m, 1)} m butt joint` : undefined} />
            <Mini label="Polished edge" value={bom ? `${num(bom.polished_edge_m, 1)} m` : "—"} sub="flat-polished" />
            <Mini label="Wind" value={`${f.wind_pressure_kpa} kPa`} sub="design pressure" />
          </div>

          {bom && <BomCard bom={bom} check={check} />}
          <JsonCard contract={exportContract} onImport={() => setModal("import")} />
        </div>

        {/* Side panel */}
        <div className="space-y-4">
          {!floating && wide && inspector}
          <SettingsCard f={f} commit={commit} />
          <WindCard f={f} commit={commit} project={project ?? null} onUnlink={() => commit((d) => ({ ...d, project_id: null }))} />
          {check && <ResultsCard check={check} onPick={(bi, pi) => {
            const b = f.bays[bi - 1]; const p = b?.panes[pi - 1];
            if (b && p) setSelection({ kind: "pane", bayId: b.id, paneId: p.id });
          }} />}
        </div>
      </div>

      <TemplatesModal open={modal === "templates"} onClose={() => setModal(null)} onPick={(t) => newFrom(t)} dirty={dirty} />
      <LibraryModal open={modal === "library"} onClose={() => setModal(null)} currentId={savedId}
        onConvert={(d, name) => { newFrom(d); toast.success(`Opened ${name} as a new elevation`, { description: "Save it to keep the converted copy." }); }}
        onOpen={(r) => { const d = hydrateFacade(r.data); setHist((h) => ({ past: [...h.past, h.present], present: d, future: [] })); setSavedId(r.id); setSavedJson(JSON.stringify(d)); setSelection(null); setModal(null); }}
        onDeleted={(id) => { if (id === savedId) { setSavedId(null); setSavedJson(null); } }} />
      <AddToProjectModal open={modal === "project"} onClose={() => setModal(null)} f={f} bom={bom} check={check} stale={stale || !!apiError}
        onDone={async (pid) => {
          commit((d) => ({ ...d, project_id: pid }));
          setModal(null);
          nav(`/projects/${pid}?tab=panels`);
        }} />
      <ImportModal open={modal === "import"} onClose={() => setModal(null)} base={f} onImport={(d) => { commit(d); setSelection(null); setModal(null); toast.success("Imported parametric JSON"); }} />
    </div>
  );
}

// ---------------------------------------------------------------- inspector

function Inspector({ f, selection, results, joints, commit, onClose, onRemove }: {
  f: Facade; selection: NonNullable<Selection>; results: Map<string, PaneResult>; joints: Map<number, JointResult>;
  commit: (n: Facade | null | ((d: Facade) => Facade | null)) => void; onClose: () => void; onRemove: () => void;
}) {
  const shell = (title: React.ReactNode, body: React.ReactNode) => (
    <Card className="max-h-full overflow-y-auto p-4 shadow-xl ring-1 ring-black/5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-sm font-semibold">{title}</p>
        <button onClick={onClose} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800" aria-label="Close inspector"><X className="h-4 w-4" /></button>
      </div>
      {body}
    </Card>
  );

  if (selection.kind === "joint") {
    const i = selection.bayIndex;
    const bay = f.bays[i];
    if (!bay) return null;
    const jr = joints.get(i + 1);
    const butt = bay.joint === "silicone_butt_joint";
    return shell(`Joint between bays ${i + 1} and ${i + 2}`, (
      <div className="space-y-3 text-sm">
        <Segmented size="sm" value={bay.joint} onChange={(v) => commit((d) => setJoint(d, i, { joint: v }))}
          options={[{ value: "aluminum_mullion", label: "Aluminium mullion" }, { value: "silicone_butt_joint", label: "Butt joint" }]} />
        {butt ? (
          <>
            <Field label="Backing">
              <Segmented size="sm" value={bay.backing} onChange={(v) => commit((d) => setJoint(d, i, { backing: v }))}
                options={[{ value: "none", label: "None" }, { value: "glass_fin", label: "Glass fin" }]} />
            </Field>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
              <dt className="text-slate-500">Silicone gap</dt><dd className="text-right tabular-nums">{f.butt_gap_mm} mm</dd>
              <dt className="text-slate-500">Required bite</dt><dd className="text-right tabular-nums">{jr?.required_bite_mm ? `${jr.required_bite_mm} mm` : "—"}</dd>
              <dt className="text-slate-500">Calculated</dt><dd className="text-right tabular-nums">{jr?.calculated_bite_mm ?? "—"} mm</dd>
              {bay.backing === "glass_fin" && <><dt className="text-slate-500">Min. fin thickness</dt><dd className="text-right tabular-nums">{jr?.min_fin_thickness_mm ?? "—"} mm</dd></>}
            </dl>
            <p className="text-xs text-slate-500">
              B = P × short span ÷ (2 × 138 kPa). Adjacent glass edges are flagged for flat polishing.
              {bay.backing === "none" && " With no fin, both glass edges are unsupported and the panes span top to bottom."}
            </p>
          </>
        ) : <p className="text-xs text-slate-500">{f.mullion_mm} mm aluminium profile. Glass engages 12 mm into each side.</p>}
        <Button size="sm" variant="secondary" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={onRemove}>Remove divider</Button>
      </div>
    ));
  }

  if (selection.kind === "transom") {
    const b = f.bays.find((x) => x.id === selection.bayId);
    const bi = f.bays.findIndex((x) => x.id === selection.bayId);
    if (!b) return null;
    return shell(`Transom in bay ${bi + 1}`, (
      <div className="space-y-3 text-sm">
        <p className="text-xs text-slate-500">{f.transom_mm} mm aluminium transom between panes {letter(selection.k)} and {letter(selection.k + 1)}. Drag it on the canvas to move it.</p>
        <Button size="sm" variant="secondary" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={onRemove}>Remove transom</Button>
      </div>
    ));
  }

  const bi = f.bays.findIndex((x) => x.id === selection.bayId);
  const b = f.bays[bi];
  const k = b ? b.panes.findIndex((p) => p.id === selection.paneId) : -1;
  if (!b || k < 0) return null;
  const p = b.panes[k];
  const r = results.get(paneKey(bi + 1, k + 1));
  const set = (patch: Parameters<typeof updatePane>[2]) => commit((d) => updatePane(d, p.id, patch));
  const glass = (p.infill ?? "glass") === "glass";
  return shell(<span className="flex items-center gap-2">Pane B{bi + 1}-{letter(k)} {r && (r.pass ? <Badge tone="emerald">Pass</Badge> : <Badge tone="rose">Fail</Badge>)}</span>, (
    <div className="space-y-3 text-sm">
      <Field label="Infill">
        <Segmented size="sm" value={p.infill ?? "glass"} onChange={(v: Infill) => set(v === "glass" ? { infill: v } : { infill: v, operation: "fixed" })}
          options={INFILLS.map((x) => ({ value: x.value, label: x.value === "spandrel" ? "Spandrel" : x.label }))} />
      </Field>
      {glass && <Field label="Operation">
        <div className="grid grid-cols-7 gap-1">
          {OPERATIONS.map((o) => (
            <button key={o.value} type="button" title={o.label} aria-label={o.label} aria-pressed={p.operation === o.value} onClick={() => set({ operation: o.value })}
              className={cn("flex h-9 items-center justify-center rounded-lg border text-xs font-semibold transition",
                p.operation === o.value ? "border-brand-600 bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300" : "border-slate-200 text-slate-600 hover:border-slate-300 dark:border-slate-700 dark:text-slate-300")}>
              {o.short}
            </button>
          ))}
        </div>
        <p className="mt-1 text-xs text-slate-500">{opLabel(p.operation)}{p.operation === "door" && k !== b.panes.length - 1 ? " · must be the bottom pane" : ""}</p>
      </Field>}
      {glass && <Field label="Glass" htmlFor="fi-glass">
        <Select id="fi-glass" value={p.glass_spec} onChange={(e) => set({ glass_spec: e.target.value as GlassSpec })}>
          {GLASS_SPECS.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
        </Select>
      </Field>}
      {isSliding(p.operation) && (
        <Field label="Track system">
          <Segmented size="sm" value={p.track_system} onChange={(v) => set({ track_system: v })} options={TRACKS.map((t) => ({ value: t.value, label: t.label }))} />
        </Field>
      )}
      <div className="grid grid-cols-2 gap-2">
        <Field label="Bay width"><NumInput value={b.width_mm} disabled={f.bays.length < 2} onCommit={(v) => { const n = setBayWidth(f, bi, v); if (!n) toast.error("That would make a neighbouring bay narrower than 200 mm"); commit(n); }} /></Field>
        <Field label="Pane height"><NumInput value={p.height_mm} disabled={b.panes.length < 2} onCommit={(v) => { const n = setPaneHeight(f, b.id, k, v); if (!n) toast.error("That would make a neighbouring pane shorter than 150 mm"); commit(n); }} /></Field>
      </div>
      {r && !glass ? (
        <div className="space-y-1 rounded-xl bg-slate-50 p-3 text-xs dark:bg-slate-800/60">
          <div className="flex items-baseline justify-between"><span className="text-slate-500">Panel size</span><span className="font-medium tabular-nums">{r.glass_width_mm} × {r.glass_height_mm} mm</span></div>
          <p className="text-slate-500">{infillLabel(p.infill)}s are fixed, aren't glass-checked and aren't added to projects. They appear in the BOM.</p>
        </div>
      ) : r ? (
        <div className="space-y-2 rounded-xl bg-slate-50 p-3 dark:bg-slate-800/60">
          <div className="flex items-baseline justify-between text-xs">
            <span className="text-slate-500">Net glass</span>
            <span className="font-medium tabular-nums">{r.glass_width_mm} × {r.glass_height_mm} mm</span>
          </div>
          <UtilBar value={r.utilisation} />
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
            <dt className="text-slate-500">Stress</dt><dd className="text-right tabular-nums">{r.max_stress_mpa} / {r.allowable_stress_mpa} MPa</dd>
            <dt className="text-slate-500">Deflection</dt><dd className="text-right tabular-nums">{r.max_deflection_mm} / {r.allowable_deflection_mm} mm</dd>
            <dt className="text-slate-500">Support</dt><dd className="text-right">{r.support.split(" (")[0]}</dd>
            <dt className="text-slate-500">Weight</dt><dd className="text-right tabular-nums">{r.weight_kg} kg</dd>
          </dl>
          {r.warnings.map((w) => <p key={w} className="text-xs text-amber-600 dark:text-amber-400">{w}</p>)}
          {r.hint && <p className="text-xs text-slate-600 dark:text-slate-300">{r.hint}</p>}
          {r.recommended_glass_spec && (
            <Button size="sm" variant="secondary" className="w-full" onClick={() => set({ glass_spec: r.recommended_glass_spec! })}>
              Use {GLASS_SPECS.find((g) => g.value === r.recommended_glass_spec)?.label}
            </Button>
          )}
        </div>
      ) : <Skeleton className="h-24" />}
      <div className="flex gap-2">
        <Button size="sm" variant="secondary" icon={<Columns2 className="h-3.5 w-3.5" />} onClick={() => { const n = splitBay(f, b.id, Math.round(b.width_mm / 2), 1); if (!n) toast.error("Too narrow to split"); commit(n); }}>Split</Button>
        <Button size="sm" variant="secondary" icon={<Rows2 className="h-3.5 w-3.5" />} onClick={() => { const n = splitPane(f, b.id, p.id, Math.round(p.height_mm / 2), 1); if (!n) toast.error("Too short to split"); commit(n); }}>Split</Button>
      </div>
    </div>
  ));
}

// ---------------------------------------------------------------- side panel

function SettingsCard({ f, commit }: { f: Facade; commit: (n: Facade | null | ((d: Facade) => Facade | null)) => void }) {
  const set = (patch: Partial<Facade>) => commit((d) => ({ ...d, ...patch }));
  return (
    <Card className="p-4">
      <p className="mb-3 text-sm font-semibold">Elevation</p>
      <div className="space-y-3">
        <Field label="Name" htmlFor="fs-name"><TextInput id="fs-name" value={f.name} maxLength={120} onCommit={(v) => set({ name: v })} /></Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Elevation ID" htmlFor="fs-id"><TextInput id="fs-id" value={f.elevation_id} maxLength={40} onCommit={(v) => set({ elevation_id: v.trim() || "W-101" })} /></Field>
          <Field label="Quantity"><NumInput value={f.quantity} min={1} max={1000} suffix="nos" onCommit={(v) => set({ quantity: v })} /></Field>
          <Field label="Floor" htmlFor="fs-floor" className="col-span-2"><TextInput id="fs-floor" value={f.floor_level} maxLength={40} placeholder="e.g. 3 or Ground" onCommit={(v) => set({ floor_level: v.trim() })} /></Field>
          <Field label="Overall width"><NumInput value={f.width_mm} min={300} max={30000} onCommit={(v) => { const n = resize(f, v, f.height_mm); if (!n) toast.error("Too narrow for the current bays"); commit(n); }} /></Field>
          <Field label="Overall height"><NumInput value={f.height_mm} min={300} max={12000} onCommit={(v) => { const n = resize(f, f.width_mm, v); if (!n) toast.error("Too short for the current panes"); commit(n); }} /></Field>
        </div>
      </div>
      <p className="mb-3 mt-5 text-sm font-semibold">Profiles &amp; joints</p>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Frame"><NumInput value={f.frame_mm} min={20} max={200} onCommit={(v) => set({ frame_mm: v })} /></Field>
        <Field label="Mullion"><NumInput value={f.mullion_mm} min={20} max={200} onCommit={(v) => set({ mullion_mm: v })} /></Field>
        <Field label="Transom"><NumInput value={f.transom_mm} min={20} max={200} onCommit={(v) => set({ transom_mm: v })} /></Field>
        <Field label="Butt-joint gap"><NumInput value={f.butt_gap_mm} min={4} max={25} onCommit={(v) => set({ butt_gap_mm: v })} /></Field>
        <Field label="Structural sealant" htmlFor="fs-seal" className="col-span-2">
          <Select id="fs-seal" value={f.sealant} onChange={(e) => set({ sealant: e.target.value as Facade["sealant"] })}>
            {SEALANTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </Select>
        </Field>
      </div>
    </Card>
  );
}

function WindCard({ f, commit, project, onUnlink }: { f: Facade; commit: (n: Facade | null | ((d: Facade) => Facade | null)) => void; project: Project | null; onUnlink: () => void }) {
  const { reference } = useApp();
  const [site, setSite] = useState({ city: "Mumbai", h: 30 as number | "", terrain: 3, zone: "typical" });
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!project) return;
    setSite({ city: project.city, h: project.building_height_m, terrain: project.terrain, zone: project.zone });
    setOpen(true);
  }, [project]);
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<string | null>(null);
  const calc = async () => {
    if (!site.city.trim() || !site.h) return toast.error("Enter the city and the height of the glazing");
    setBusy(true);
    try {
      const r = await api.post<WindValidation>("/canvas/validate-wind-load", { ...toContract(f), site: { city: site.city, height_m: site.h, terrain: site.terrain, zone: site.zone } });
      if (!r.wind) throw new Error("No wind result");
      commit((d) => ({ ...d, wind_pressure_kpa: r.wind!.design_pressure_kpa }));
      setLast(`${r.wind.city} at ${site.h} m: Vz ${r.wind.Vz_mps} m/s, pz ${r.wind.pz_kpa} kPa`);
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  };
  return (
    <Card className="p-4">
      <p className="mb-3 flex items-center gap-2 text-sm font-semibold"><Wind className="h-4 w-4 text-slate-400" /> Wind load (IS 875 Part 3)</p>
      <Field label="Design pressure"><NumInput value={f.wind_pressure_kpa} min={0.1} max={10} step={0.01} suffix="kPa" onCommit={(v) => commit((d) => ({ ...d, wind_pressure_kpa: v }))} /></Field>
      {project && (
        <p className="mt-3 flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
          <span className="truncate">Site from <b className="font-medium">{project.name}</b></span>
          <button onClick={onUnlink} className="shrink-0 text-slate-400 hover:text-slate-700" aria-label="Unlink project"><X className="h-3.5 w-3.5" /></button>
        </p>
      )}
      <details className="group mt-3" open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
        <summary className="cursor-pointer text-xs font-medium text-brand-700 dark:text-brand-300">Calculate from the site</summary>
        <div className="mt-3 space-y-3">
          <Field label="City" htmlFor="fw-city"><CityInput id="fw-city" value={site.city} onChange={(v) => setSite({ ...site, city: v })} /></Field>
          <Field label="Height of glazing" htmlFor="fw-h"><HeightInput id="fw-h" value={site.h} onChange={(v) => setSite({ ...site, h: v })} /></Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Terrain" htmlFor="fw-t">
              <Select id="fw-t" value={site.terrain} onChange={(e) => setSite({ ...site, terrain: Number(e.target.value) })}>
                {[1, 2, 3, 4].map((t) => <option key={t} value={t} title={reference?.terrain?.[String(t)]}>Cat. {t}</option>)}
              </Select>
            </Field>
            <Field label="Zone" htmlFor="fw-z">
              <Select id="fw-z" value={site.zone} onChange={(e) => setSite({ ...site, zone: e.target.value })}>
                {Object.entries(reference?.zones ?? { typical: "Typical", corner: "Corner" }).map(([k, v]) => <option key={k} value={k}>{String(v).split(" (")[0]}</option>)}
              </Select>
            </Field>
          </div>
          <Button size="sm" className="w-full" loading={busy} onClick={calc}>Use IS 875 design pressure</Button>
          {last && <p className="text-[11px] text-slate-500">{last}</p>}
        </div>
      </details>
    </Card>
  );
}

function ResultsCard({ check, onPick }: { check: WindValidation; onPick: (bay: number, pane: number) => void }) {
  return (
    <Card className="overflow-hidden">
      <CardHeader title="Pane checks" subtitle={`${check.wind_pressure_kpa} kPa · ${check.summary.panes} panes`}
        icon={check.pass ? <ShieldCheck className="h-4 w-4 text-emerald-600" /> : <ShieldAlert className="h-4 w-4 text-rose-600" />} />
      <ul className="divide-y divide-slate-100 dark:divide-slate-800">
        {check.panes.map((p) => (
          <li key={p.mark}>
            <button onClick={() => onPick(p.bay_index, p.pane_index)} className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800/50">
              <span className="w-12 shrink-0 text-xs font-semibold">B{p.bay_index}-{letter(p.pane_index - 1)}</span>
              <span className="min-w-0 flex-1">{p.infill && p.infill !== "glass" ? <span className="text-xs text-slate-500">{infillLabel(p.infill)} · not checked</span> : <UtilBar value={p.utilisation} />}</span>
              {p.pass ? <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-600" /> : <ShieldAlert className="h-4 w-4 shrink-0 text-rose-600" />}
            </button>
          </li>
        ))}
      </ul>
      <details className="border-t border-slate-100 px-4 py-2 text-[11px] text-slate-500 dark:border-slate-800">
        <summary className="cursor-pointer">Assumptions</summary>
        <ul className="mt-1 list-disc space-y-0.5 pl-4">{check.assumptions.map((a) => <li key={a}>{a}</li>)}</ul>
      </details>
    </Card>
  );
}

// ---------------------------------------------------------------- BOM & JSON

function BomCard({ bom, check }: { bom: FacadeBom; check: WindValidation | null }) {
  const [tab, setTab] = useState<"glass" | "alu" | "silicone" | "cutting">("glass");
  const res = new Map((check?.panes ?? []).map((p) => [p.mark, p]));
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between dark:border-slate-800">
        <div><p className="text-sm font-semibold">Bill of materials</p><p className="text-xs text-slate-500">Net sizes after frame, mullion, sash and silicone deductions{bom.quantity > 1 ? ` · × ${bom.quantity} elevations` : ""}</p></div>
        <div className="overflow-x-auto"><Segmented size="sm" value={tab} onChange={setTab} options={[{ value: "glass", label: "Glass" }, { value: "alu", label: "Aluminium" }, { value: "silicone", label: "Silicone" }, { value: "cutting", label: "Cutting list" }]} /></div>
      </div>
      <div className="overflow-x-auto">
        {tab === "glass" && (
          <table className="table-base">
            <thead><tr><th>Mark</th><th>Type</th><th>Glass</th><th className="text-right">Net size (mm)</th><th className="text-right">Qty</th><th className="text-right">Area</th><th className="text-right">Weight</th><th>Polished</th><th>IS 875</th></tr></thead>
            <tbody>
              {bom.glass.map((g) => { const r = res.get(g.mark); return (
                <tr key={g.mark}>
                  <td className="whitespace-nowrap font-medium">B{g.bay_index}-{letter(g.pane_index - 1)}</td>
                  <td className="whitespace-nowrap text-xs">{opLabel(g.operation as Operation)}</td>
                  <td className="whitespace-nowrap text-xs">{glassShort(g.glass_spec)}</td>
                  <td className="whitespace-nowrap text-right tabular-nums">{g.width_mm} × {g.height_mm}</td>
                  <td className="text-right tabular-nums">{g.quantity}</td>
                  <td className="whitespace-nowrap text-right tabular-nums">{num(g.area_m2, 2)} m²</td>
                  <td className="whitespace-nowrap text-right tabular-nums">{num(g.weight_kg)} kg</td>
                  <td className="whitespace-nowrap text-xs">{g.polished_edges.length ? `${g.polished_edges.join(" + ")} · ${num(g.polished_edge_m, 2)} m` : "—"}</td>
                  <td>{r ? (r.pass ? <Badge tone="emerald">{Math.round(r.utilisation * 100)}%</Badge> : <Badge tone="rose">{r.plate_pass ? "Check" : `${Math.round(r.utilisation * 100)}%`}</Badge>) : "—"}</td>
                </tr>
              ); })}
            </tbody>
            {bom.infill_panels.length > 0 && <tbody className="border-t-2 border-slate-100 dark:border-slate-800">
              {bom.infill_panels.map((x) => (
                <tr key={x.mark} className="text-slate-600 dark:text-slate-400">
                  <td className="whitespace-nowrap font-medium">B{x.bay_index}-{letter(x.pane_index - 1)}</td>
                  <td className="whitespace-nowrap text-xs" colSpan={2}>{x.label}</td>
                  <td className="whitespace-nowrap text-right tabular-nums">{x.width_mm} × {x.height_mm}</td>
                  <td className="text-right tabular-nums">{x.quantity}</td>
                  <td className="whitespace-nowrap text-right tabular-nums">{num(x.area_m2, 2)} m²</td>
                  <td colSpan={3} className="text-xs">not glass</td>
                </tr>
              ))}
            </tbody>}
            <tfoot><tr className="font-medium"><td colSpan={4}>Glass total</td><td className="text-right tabular-nums">{bom.totals.glass_units}</td><td className="whitespace-nowrap text-right tabular-nums">{num(bom.totals.glass_area_m2, 2)} m²</td><td className="whitespace-nowrap text-right tabular-nums">{num(bom.totals.glass_weight_kg)} kg</td><td className="whitespace-nowrap text-xs">{num(bom.polished_edge_m, 2)} m</td><td /></tr></tfoot>
          </table>
        )}
        {tab === "alu" && (
          <table className="table-base">
            <thead><tr><th>Item</th><th className="text-right">Length</th></tr></thead>
            <tbody>
              <tr><td>Outer frame (perimeter)</td><td className="text-right tabular-nums">{num(bom.aluminium.frame_m, 2)} m</td></tr>
              <tr><td>Mullions</td><td className="text-right tabular-nums">{num(bom.aluminium.mullion_m, 2)} m</td></tr>
              <tr><td>Transoms</td><td className="text-right tabular-nums">{num(bom.aluminium.transom_m, 2)} m</td></tr>
              <tr><td>Vent sash</td><td className="text-right tabular-nums">{num(bom.aluminium.sash_m, 2)} m</td></tr>
              {bom.aluminium.tracks.map((t) => <tr key={t.track_system}><td>{t.label} track (head + sill)</td><td className="text-right tabular-nums">{num(t.length_m, 2)} m</td></tr>)}
            </tbody>
            <tfoot><tr className="font-medium"><td>Total</td><td className="text-right tabular-nums">{num(bom.aluminium.total_m, 2)} m</td></tr></tfoot>
          </table>
        )}
        {tab === "silicone" && (
          bom.silicone.lines.length ? (
            <table className="table-base">
              <thead><tr><th>Sealant</th><th className="text-right">Butt joint</th><th className="text-right">Net volume</th><th className="text-right">600 ml sausages</th><th className="text-right">Cost</th></tr></thead>
              <tbody>{bom.silicone.lines.map((l) => (
                <tr key={l.sealant}><td>{l.label}</td><td className="text-right tabular-nums">{num(bom.silicone.butt_joint_m, 2)} m</td><td className="text-right tabular-nums">{num(l.net_ml)} ml</td><td className="text-right tabular-nums">{l.sausages_600ml}</td><td className="text-right tabular-nums">₹{num(l.cost_inr)}</td></tr>
              ))}</tbody>
              <tfoot><tr><td colSpan={5} className="text-xs text-slate-500">Volume = gap × glass thickness × joint length, plus {Math.round((bom.silicone.wastage_factor - 1) * 100)}% wastage.</td></tr></tfoot>
            </table>
          ) : <p className="p-4 text-sm text-slate-500">No silicone butt joints in this elevation. Click a mullion on the canvas to switch it to a butt joint.</p>
        )}
        {tab === "cutting" && (
          <table className="table-base">
            <thead><tr><th>Cut glass</th><th className="text-right">Size (mm)</th><th className="text-right">Pieces</th></tr></thead>
            <tbody>{bom.cutting_list.map((c, i) => <tr key={i}><td>{c.glass_spec.replace(/_/g, " ")}</td><td className="text-right tabular-nums">{c.width_mm} × {c.height_mm}</td><td className="text-right tabular-nums">{c.quantity}</td></tr>)}</tbody>
            <tfoot><tr><td colSpan={3} className="text-xs text-slate-500">DGU units are cut as two 6 mm toughened lites each. This list feeds the cutting optimiser.</td></tr></tfoot>
          </table>
        )}
      </div>
    </Card>
  );
}

function JsonCard({ contract, onImport }: { contract: unknown; onImport: () => void }) {
  const text = useMemo(() => JSON.stringify(contract, null, 2), [contract]);
  const [open, setOpen] = useState(false);
  const download = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    a.download = `${(contract as { elevation_id: string }).elevation_id}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 p-4">
        <button className="flex items-center gap-2 text-left" onClick={() => setOpen((x) => !x)} aria-expanded={open}>
          <Braces className="h-4 w-4 text-slate-400" />
          <span><span className="block text-sm font-semibold">Parametric JSON</span><span className="block text-xs text-slate-500">The data contract sent to the BOM, IS 875 and DXF endpoints</span></span>
        </button>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" icon={<Copy className="h-3.5 w-3.5" />} onClick={() => navigator.clipboard.writeText(text).then(() => toast.success("JSON copied"), () => toast.error("Copy failed"))}>Copy</Button>
          <Button size="sm" variant="secondary" icon={<Download className="h-3.5 w-3.5" />} onClick={download}>.json</Button>
          <Button size="sm" variant="secondary" icon={<Upload className="h-3.5 w-3.5" />} onClick={onImport}>Import</Button>
        </div>
      </div>
      {open && <pre className="max-h-96 overflow-auto border-t border-slate-100 bg-slate-50 p-4 font-mono text-[11px] leading-relaxed text-slate-700 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-300">{text}</pre>}
    </Card>
  );
}

// ---------------------------------------------------------------- modals

function Thumb({ f, dark }: { f: Facade; dark?: boolean }) {
  const lay = layout(f);
  const sw = Math.max(f.width_mm, f.height_mm) / 90;
  return (
    <svg viewBox={`${-sw} ${-sw} ${f.width_mm + 2 * sw} ${f.height_mm + 2 * sw}`} className="h-28 w-full" aria-hidden>
      <rect width={f.width_mm} height={f.height_mm} fill={dark ? "#4b5563" : "#cbd5e1"} />
      {lay.map((b, i) => b.panes.map((p) => (
        <rect key={p.pane.id} x={b.x + (i === 0 ? f.frame_mm : f.mullion_mm / 2)} y={p.y + f.frame_mm / 2} width={Math.max(1, b.w - f.frame_mm - f.mullion_mm / 2)} height={Math.max(1, p.h - f.frame_mm)}
          fill={dark ? "rgba(56,189,248,0.25)" : "#e0f2fe"} stroke={dark ? "#7dd3fc" : "#7dd3fc"} strokeWidth={sw / 3} />
      )))}
      {lay.slice(1).map((b, i) => f.bays[i].joint === "silicone_butt_joint" && <line key={b.bay.id} x1={b.x} x2={b.x} y1={0} y2={f.height_mm} stroke="#2563eb" strokeWidth={sw} strokeDasharray={`${sw * 3} ${sw * 2}`} />)}
    </svg>
  );
}

function TemplatesModal({ open, onClose, onPick, dirty }: { open: boolean; onClose: () => void; onPick: (f: Facade) => void; dirty: boolean }) {
  const dark = useIsDark();
  const items = useMemo(() => TEMPLATES.map((t) => ({ ...t, preview: t.make() })), []);
  return (
    <Modal open={open} onClose={onClose} size="lg" title="New elevation" description={dirty ? "Your current elevation stays in the undo history." : "Start from a typical layout, then edit it on the canvas."}>
      <div className="grid grid-cols-2 gap-3">
        {items.map((t) => (
          <button key={t.name} onClick={() => onPick(t.make())} className="rounded-2xl border border-slate-200 p-3 text-left transition hover:border-brand-600 dark:border-slate-700">
            <div className="rounded-xl bg-slate-50 p-2 dark:bg-slate-800/60"><Thumb f={t.preview} dark={dark} /></div>
            <p className="mt-2 text-sm font-medium">{t.name}</p>
            <p className="text-xs text-slate-500">{t.description}</p>
          </button>
        ))}
      </div>
    </Modal>
  );
}

function LibraryModal({ open, onClose, onOpen, onConvert, onDeleted, currentId }: { open: boolean; onClose: () => void; onOpen: (r: FacadeRecord) => void; onConvert: (f: Facade, name: string) => void; onDeleted: (id: string) => void; currentId: string | null }) {
  const dark = useIsDark();
  const { data, loading, reload, setData } = useApi<FacadeRecord[]>(open ? "/designs?kind=facade" : null, [open]);
  const { data: legacy } = useApi<LegacyRecord[]>(open ? "/designs?kind=window" : null, [open]);
  const [q, setQ] = useState("");
  const legacyRows = (legacy ?? []).filter((r) => !q || `${r.name} ${r.data?.tag ?? ""}`.toLowerCase().includes(q.toLowerCase()));
  const [confirm, setConfirm] = useState<string | null>(null);
  const rows = (data ?? []).filter((r) => !q || `${r.name} ${r.data?.elevation_id ?? ""}`.toLowerCase().includes(q.toLowerCase()));
  const del = async (r: FacadeRecord) => {
    try {
      await api.del(`/designs/${r.id}`);
      setData((data ?? []).filter((x) => x.id !== r.id));
      onDeleted(r.id);
      toast.success(`Deleted ${r.name}`);
    } catch (e) { toast.error((e as Error).message); reload(); }
    setConfirm(null);
  };
  return (
    <Modal open={open} onClose={onClose} size="xl" title="Design library" description="Elevations saved by your team.">
      <Input placeholder="Search by name or elevation ID" value={q} onChange={(e) => setQ(e.target.value)} className="mb-4" />
      {loading && !data ? <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-44" />)}</div>
        : rows.length === 0 ? <EmptyState icon={<FolderOpen className="h-6 w-6" />} title={q ? "No matches" : "No saved elevations yet"} body={q ? "Try another search." : "Save an elevation and it will appear here for everyone in your company."} />
        : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {rows.map((r) => { const d = hydrateFacade(r.data); return (
              <div key={r.id} className={cn("group relative rounded-2xl border p-3 transition hover:border-brand-600", r.id === currentId ? "border-brand-600" : "border-slate-200 dark:border-slate-700")}>
                <button onClick={() => onOpen(r)} className="block w-full text-left">
                  <div className="rounded-xl bg-slate-50 p-2 dark:bg-slate-800/60"><Thumb f={d} dark={dark} /></div>
                  <p className="mt-2 truncate text-sm font-medium">{d.elevation_id} · {r.name}</p>
                  <p className="truncate text-xs text-slate-500">{d.width_mm} × {d.height_mm} · {r.created_by ?? "—"} · {timeAgo(r.updated_at)}</p>
                </button>
                {confirm === r.id ? (
                  <div className="absolute inset-x-2 top-2 flex items-center justify-between gap-2 rounded-xl bg-white/95 p-2 text-xs shadow ring-1 ring-black/5 dark:bg-slate-900/95">
                    <span>Delete?</span>
                    <div className="flex gap-1"><Button size="sm" variant="secondary" onClick={() => setConfirm(null)}>No</Button><Button size="sm" variant="danger" onClick={() => del(r)}>Delete</Button></div>
                  </div>
                ) : (
                  <button onClick={() => setConfirm(r.id)} className="absolute right-4 top-4 rounded-full bg-white/90 p-1.5 text-slate-500 opacity-0 shadow-sm transition hover:text-rose-600 group-hover:opacity-100 focus:opacity-100 dark:bg-slate-900/90" aria-label={`Delete ${r.name}`}><Trash2 className="h-3.5 w-3.5" /></button>
                )}
              </div>
            ); })}
          </div>
        )}
      {legacyRows.length > 0 && (
        <div className="mt-6">
          <p className="text-sm font-medium">Older window designs</p>
          <p className="mb-3 text-xs text-slate-500">Saved in the previous window designer. Rectangular designs open here as a new elevation; the original is kept.</p>
          <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 dark:divide-slate-800 dark:border-slate-700">
            {legacyRows.map((r) => {
              const why = legacyBlocker(r.data);
              const conv = why ? null : fromWindowDesign(r.data);
              return (
                <li key={r.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <span className="min-w-0 flex-1 truncate">{r.data?.tag ? `${r.data.tag} · ` : ""}{r.name}<span className="ml-2 text-xs text-slate-500">{r.data?.width_mm} × {r.data?.height_mm} · {timeAgo(r.updated_at)}</span></span>
                  {conv ? <Button size="sm" variant="secondary" onClick={() => onConvert(conv, r.name)}>Open</Button>
                    : <span className="text-xs text-slate-400" title="Shaped heads and nested splits can't be converted">{why ?? "Can't convert"}</span>}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------- add to project

/** Project glass that a pane's glass corresponds to (projects price one spec; DGU has no equivalent). */
const PROJECT_SPEC: Record<GlassSpec, string | null> = {
  "10mm_toughened": "10mm_toughened", "12mm_toughened": "12mm_toughened",
  "13.52mm_laminated_toughened": "13.52mm_laminated", "24mm_dgu": null,
};

function AddToProjectModal({ open, onClose, f, bom, check, stale, onDone }: {
  open: boolean; onClose: () => void; f: Facade; bom: FacadeBom | null; check: WindValidation | null; stale: boolean; onDone: (pid: string) => Promise<void>;
}) {
  const { data: projects } = useApi<ProjectSummary[]>(open ? "/projects" : null, [open]);
  const [pid, setPid] = useState("");
  const [replaceTagged, setReplaceTagged] = useState(true);
  const [skipOther, setSkipOther] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setPid(f.project_id ?? ""); setSkipOther(false); } }, [open, f.project_id]);
  const { data: target, reload } = useApi<Project>(open && pid ? `/projects/${pid}` : null, [pid, open]);

  const prefix = `${f.elevation_id.trim() || "W-101"}/`;
  const rows = (bom?.glass ?? []).map((g) => {
    const other = !!target && PROJECT_SPEC[g.glass_spec] !== target.glass_spec;
    return { g, other };
  });
  const chosen = rows.filter((r) => !(skipOther && r.other));
  const newPanels: Panel[] = chosen.map(({ g, other }) => ({
    tag: g.mark, width_mm: g.width_mm, height_mm: g.height_mm, quantity: g.quantity, floor_level: f.floor_level || null,
    notes: [f.name, opLabel(g.operation), other ? `designed as ${g.glass_label}` : null].filter(Boolean).join(" · ").slice(0, 200),
    needs_review: other,
  }));
  const otherCount = rows.filter((r) => r.other).length;
  // If every pane uses one glass the project can price, offer to switch the project to it.
  const specs = [...new Set(rows.map((r) => r.g.glass_spec))];
  const switchTo = target && specs.length === 1 && otherCount > 0 ? PROJECT_SPEC[specs[0]] : null;
  const existing = target?.panels.filter((p) => p.tag.startsWith(prefix)).length ?? 0;
  const errors = (check?.issues ?? []).filter((i) => i.level === "error");
  const blocked = stale ? "Wait for the checks to finish." : errors.length ? errors[0].message : !bom?.glass.length ? "This elevation has no glass panes." : null;

  const switchSpec = async () => {
    if (!target || !switchTo) return;
    try {
      await api.patch(`/projects/${target.id}`, { glass_spec: switchTo });
      reload();
      toast.success("Project glass updated");
    } catch (e) { toast.error((e as Error).message); }
  };
  const add = async () => {
    if (!target) return;
    setBusy(true);
    try {
      const keep = target.panels.filter((p) => !(replaceTagged && p.tag.startsWith(prefix))).map(({ id: _id, ...x }) => x);
      await api.patch<Project>(`/projects/${pid}`, { panels: [...keep, ...newPanels] });
      await api.post<Project>(`/projects/${pid}/validate`).catch(() => null);
      toast.success(`Added ${newPanels.length} glass pane${newPanels.length === 1 ? "" : "s"} to ${target.name}`, { description: "IS 875 check re-run on the updated schedule." });
      await onDone(pid);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={open} onClose={onClose} size="lg" title="Add to project" description="Each glass pane becomes a row in the project's window schedule, ready for the IS 875 check, cutting and quoting."
      footer={<>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={add} loading={busy} disabled={!!blocked || !target || !newPanels.length}>Add {newPanels.length} pane{newPanels.length === 1 ? "" : "s"}</Button>
      </>}>
      <div className="space-y-4">
        {blocked && <p className="flex gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"><AlertTriangle className="h-4 w-4 shrink-0" />{blocked}</p>}
        <Field label="Project" htmlFor="atp-p">
          <Select id="atp-p" value={pid} onChange={(e) => setPid(e.target.value)}>
            <option value="" disabled>Choose a project…</option>
            {projects?.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.city}</option>)}
          </Select>
        </Field>
        {target && (
          <>
            <p className="text-sm text-slate-500">The project is priced and cut as <span className="font-medium text-slate-700 dark:text-slate-300">{target.glass_label}</span>.</p>
            {otherCount > 0 && (
              <div className="space-y-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                <p className="flex gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{otherCount} pane{otherCount === 1 ? " uses" : "s use"} a different glass. {skipOther ? "They will be left out." : "They will be added marked for review, with the designed glass in the notes."}</span></p>
                <label className="flex cursor-pointer items-center gap-2 pl-6 text-xs">
                  <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={skipOther} onChange={(e) => setSkipOther(e.target.checked)} />
                  Only add panes that match the project's glass
                </label>
                {switchTo && <button onClick={switchSpec} className="link pl-6 text-xs">Change the project's glass to {GLASS_SPECS.find((g) => g.value === specs[0])?.label} instead</button>}
              </div>
            )}
            {existing > 0 && (
              <label className="flex cursor-pointer items-start gap-2 rounded-xl bg-slate-50 p-3 text-sm dark:bg-slate-800/60">
                <input type="checkbox" className="mt-0.5 h-4 w-4 accent-brand-600" checked={replaceTagged} onChange={(e) => setReplaceTagged(e.target.checked)} />
                <span>Replace the {existing} existing row{existing === 1 ? "" : "s"} tagged <span className="font-mono">{prefix}*</span> (re-adding an edited elevation)</span>
              </label>
            )}
            {(target.cutting || target.quote) && <p className="flex gap-2 text-xs text-amber-700 dark:text-amber-400"><AlertTriangle className="h-3.5 w-3.5 shrink-0" />Changing the schedule clears this project's cutting plan and quote.</p>}
          </>
        )}
        <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
          <table className="table-base">
            <thead><tr><th>Tag</th><th className="text-right">Glass (mm)</th><th className="text-right">Qty</th><th>Glass</th></tr></thead>
            <tbody>{rows.map(({ g, other }) => (
              <tr key={g.mark} className={cn(skipOther && other && "opacity-40")}>
                <td className="whitespace-nowrap font-medium">{g.mark}</td>
                <td className="whitespace-nowrap text-right tabular-nums">{g.width_mm} × {g.height_mm}</td>
                <td className="text-right tabular-nums">{g.quantity}</td>
                <td className="whitespace-nowrap text-xs">{glassShort(g.glass_spec)}{other && <Badge tone="amber" className="ml-2">Review</Badge>}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        {(bom?.infill_panels.length ?? 0) > 0 && <p className="text-xs text-slate-500">Spandrel and louvre panels aren't glass, so they aren't added.</p>}
      </div>
    </Modal>
  );
}

function ImportModal({ open, onClose, base, onImport }: { open: boolean; onClose: () => void; base: Facade; onImport: (f: Facade) => void }) {
  const [text, setText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (open) { setText(""); setErr(null); } }, [open]);
  const go = () => {
    try { onImport(fromContract(JSON.parse(text), base)); }
    catch (e) { setErr(e instanceof SyntaxError ? "That isn't valid JSON" : (e as Error).message); }
  };
  return (
    <Modal open={open} onClose={onClose} size="lg" title="Import parametric JSON" description="Paste an elevation in the VitroStack format (elevation_id, overall sizes, bays)."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={go} disabled={!text.trim()}>Import</Button></>}>
      <textarea value={text} onChange={(e) => { setText(e.target.value); setErr(null); }} rows={14} spellCheck={false} aria-label="Parametric JSON"
        className="w-full rounded-xl border border-slate-200 bg-white p-3 font-mono text-xs dark:border-slate-700 dark:bg-slate-900" placeholder='{ "elevation_id": "W-101", "overall_width_mm": 4800, ... }' />
      {err && <p className="mt-2 text-sm text-rose-600">{err}</p>}
    </Modal>
  );
}

// ---------------------------------------------------------------- small pieces

function ToolBtn({ label, onClick, disabled, active, children }: { label: string; onClick: () => void; disabled?: boolean; active?: boolean; children: React.ReactNode }) {
  return (
    <button type="button" title={label} aria-label={label} onClick={onClick} disabled={disabled} aria-pressed={active}
      className={cn("inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-[13px] transition disabled:opacity-35",
        active ? "bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300" : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800")}>
      {children}
    </button>
  );
}
const Sep = () => <span className="mx-1 h-5 w-px bg-slate-200 dark:bg-slate-700" />;

function Legend({ color, label, dashed }: { color: string; label: string; dashed?: boolean }) {
  return <span className="inline-flex items-center gap-1.5"><span className={cn("h-2.5 w-2.5 rounded-sm", color, dashed && "ring-1 ring-dashed ring-blue-500")} />{label}</span>;
}

function Mini({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: "good" | "bad" }) {
  return (
    <Card className="p-4">
      <p className="text-xs text-slate-500">{label}</p>
      <p className={cn("mt-1 truncate text-lg font-semibold tabular-nums", tone === "good" && "text-emerald-600", tone === "bad" && "text-rose-600")}>{value}</p>
      {sub && <p className="mt-0.5 truncate text-xs text-slate-500">{sub}</p>}
    </Card>
  );
}

/** Number input that commits on Enter / blur, so one edit is one undo step. */
function NumInput({ value, onCommit, min = 0, max = 100000, step = 1, suffix = "mm", disabled }: { value: number; onCommit: (v: number) => void; min?: number; max?: number; step?: number; suffix?: string; disabled?: boolean }) {
  const [s, setS] = useState(String(value));
  useEffect(() => setS(String(value)), [value]);
  const v = Number(s);
  const bad = s.trim() === "" || !Number.isFinite(v) || v < min || v > max;
  const done = () => {
    if (bad) { if (s.trim() !== String(value)) toast.error(`Enter a value from ${min} to ${max} ${suffix}`); setS(String(value)); return; }
    const r = step < 1 ? Math.round(v / step) * step : Math.round(v);
    const rounded = Number(r.toFixed(4));
    if (rounded !== value) onCommit(rounded);
    else setS(String(value));
  };
  return <Input type="number" inputMode="decimal" value={s} min={min} max={max} step={step} suffix={suffix} invalid={bad} disabled={disabled}
    onChange={(e) => setS(e.target.value)} onBlur={done}
    onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") { setS(String(value)); (e.target as HTMLInputElement).blur(); } }} />;
}

function TextInput({ value, onCommit, ...rest }: { value: string; onCommit: (v: string) => void; id?: string; maxLength?: number; placeholder?: string }) {
  const [s, setS] = useState(value);
  useEffect(() => setS(value), [value]);
  return <Input {...rest} value={s} onChange={(e) => setS(e.target.value)} onBlur={() => { if (s !== value) onCommit(s); }}
    onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") { setS(value); (e.target as HTMLInputElement).blur(); } }} />;
}
