import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import {
  AlertTriangle, ArrowRight, Boxes, Calculator, CheckCircle2, ChevronLeft, Download, FileText, Info, Maximize2, MoreHorizontal, PenTool,
  Printer, RefreshCw, Save, Scissors, ShieldAlert, ShieldCheck, Trash2, Wind,
} from "lucide-react";
import { api, type Bom, type Panel, type Project, type Quote, type Sheet } from "../lib/api";
import { cn, inr, num, pct, specLabel, useApi, useDebounced } from "../lib/utils";
import { Badge, Button, Card, CardHeader, EmptyState, ErrorState, Field, Input, Modal, Select, Skeleton, StatusBadge, UtilBar } from "../components/ui";
import { BomTable, CuttingSheet, Metric, StatusStepper, useTagColors } from "../components/viz";
import PanelEditor, { panelErrors } from "../components/PanelEditor";
import { CityInput, GlassSelect, HeightInput } from "../components/ProjectForm";
import { useApp } from "../components/Layout";
import { useAuth } from "../lib/auth";

type Tab = "overview" | "panels" | "structural" | "cutting" | "quote";

export default function ProjectDetail() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") as Tab) || "overview";
  const setTab = (t: Tab) => setParams(t === "overview" ? {} : { tab: t }, { replace: true });
  const { data: p, setData, error, loading, reload } = useApi<Project>(`/projects/${id}`);
  const [busy, setBusy] = useState<string | null>(null);
  const [quoteOpen, setQuoteOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const nav = useNavigate();
  const { isAdmin } = useAuth();

  const run = async (key: string, fn: () => Promise<Project>, success: string, goto?: Tab) => {
    setBusy(key);
    try {
      const r = await fn();
      setData(r);
      toast.success(success);
      if (goto) setTab(goto);
      return r;
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const validate = () => run("validate", () => api.post<Project>(`/projects/${id}/validate`), "IS 875 validation complete", "structural");
  const applyRec = () => run("apply", () => api.post<Project>(`/projects/${id}/apply-recommendation`), "Switched to the recommended glass and re-validated", "structural");
  const optimize = (check_offcuts = true) => run("optimize", () => api.post<Project>(`/projects/${id}/optimize`, { check_offcuts }), "Cutting plan optimized", "cutting");

  if (error) return <ErrorState message={error} onRetry={() => reload()} />;
  if (loading || !p) return (
    <div className="space-y-4"><Skeleton className="h-8 w-64" /><Skeleton className="h-20 rounded-xl" /><Skeleton className="h-96 rounded-xl" /></div>
  );

  const unsafe = p.wind ? !p.wind.all_safe : false;

  // contextual primary action
  let next: { label: string; icon: JSX.Element; onClick: () => void; key: string; variant?: "primary" | "danger" } | null = null;
  if (!p.wind) next = { label: "Run IS 875 check", icon: <Wind className="h-4 w-4" />, onClick: validate, key: "validate" };
  else if (unsafe && p.wind.recommended_glass_spec) next = { label: `Apply ${specLabel(p.wind.recommended_glass_spec)}`, icon: <ShieldCheck className="h-4 w-4" />, onClick: applyRec, key: "apply" };
  else if (!p.cutting) next = { label: "Optimize cutting", icon: <Scissors className="h-4 w-4" />, onClick: () => optimize(true), key: "optimize" };
  else if (!p.quote) next = { label: "Generate quote", icon: <FileText className="h-4 w-4" />, onClick: () => setQuoteOpen(true), key: "quote" };

  const TABS: { value: Tab; label: string }[] = [
    { value: "overview", label: "Overview" }, { value: "panels", label: `Panels (${p.panel_types})` },
    { value: "structural", label: "Structural" }, { value: "cutting", label: "Cutting" }, { value: "quote", label: "Quote" },
  ];

  return (
    <div>
      <Link to="/projects" className="mb-3 inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"><ChevronLeft className="h-3.5 w-3.5" /> Projects</Link>
      <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-[32px] font-semibold leading-tight tracking-tightest sm:text-[40px]">{p.name}</h1>
            <StatusBadge status={p.status} />
            {unsafe && <Badge tone="rose">Unsafe glass</Badge>}
          </div>
          <p className="mt-1.5 text-[17px] text-slate-500">{[p.client, `${p.city} · ${p.building_height_m} m`, p.glass_label, p.glazing_system].filter(Boolean).join(" · ")}</p>
        </div>
        <div className="flex items-center gap-2">
          {p.quote && <a href={`/api/v1/projects/${p.id}/quote.pdf`} target="_blank" rel="noreferrer"><Button variant={next ? "secondary" : "primary"} icon={<Download className="h-4 w-4" />}>Quote PDF</Button></a>}
          {next && <Button onClick={next.onClick} loading={busy === next.key} icon={next.icon}>{next.label}</Button>}
          <div className="relative">
            <Button variant="secondary" size="icon" onClick={() => setMenu((m) => !m)} aria-label="More actions" aria-expanded={menu}><MoreHorizontal className="h-4 w-4" /></Button>
            {menu && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setMenu(false)} />
                <div className="absolute right-0 z-20 mt-1 w-52 rounded-lg border border-slate-200 bg-white p-1 shadow-pop dark:border-slate-700 dark:bg-slate-900">
                  <button onClick={() => { setMenu(false); validate(); }} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-slate-100 dark:hover:bg-slate-800"><RefreshCw className="h-4 w-4" /> Re-run IS 875 check</button>
                  <button onClick={() => { setMenu(false); nav(`/copilot?q=${encodeURIComponent(`Show project ${p.name}`)}`); }} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-slate-100 dark:hover:bg-slate-800"><Calculator className="h-4 w-4" /> Discuss in copilot</button>
                  {isAdmin && <button onClick={() => { setMenu(false); setConfirmDelete(true); }} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40"><Trash2 className="h-4 w-4" /> Delete project</button>}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <Card className="mb-5 px-5 py-4"><StatusStepper status={p.status} unsafe={unsafe} /></Card>

      <div className="mb-5 overflow-x-auto border-b border-slate-200 dark:border-slate-800">
        <nav className="-mb-px flex gap-6" role="tablist">
          {TABS.map((t) => (
            <button key={t.value} role="tab" aria-selected={tab === t.value} onClick={() => setTab(t.value)}
              className={cn("whitespace-nowrap border-b-2 px-1 pb-3 text-sm font-medium transition", tab === t.value ? "border-brand-600 text-brand-700 dark:text-brand-400" : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700 dark:hover:text-slate-300")}>
              {t.label}
              {t.value === "structural" && unsafe && <span className="ml-1.5 inline-block h-2 w-2 rounded-full bg-rose-500" />}
            </button>
          ))}
        </nav>
      </div>

      <div className="animate-fade-in" key={tab}>
        {tab === "overview" && <OverviewTab p={p} onSaved={setData} onGo={setTab} />}
        {tab === "panels" && <PanelsTab p={p} onSaved={setData} />}
        {tab === "structural" && <StructuralTab p={p} busy={busy} onValidate={validate} onApply={applyRec} onOptimize={() => optimize(true)} />}
        {tab === "cutting" && <CuttingTab p={p} busy={busy} onOptimize={optimize} onValidate={validate} onSaved={reload} onQuote={() => setQuoteOpen(true)} />}
        {tab === "quote" && <QuoteTab p={p} onQuote={() => setQuoteOpen(true)} onGo={setTab} />}
      </div>

      <QuoteModal open={quoteOpen} onClose={() => setQuoteOpen(false)} p={p} onDone={(r) => { setData(r); setTab("quote"); }} />
      <Modal open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Delete this project?" description="This removes the schedule, checks, cutting plan and quote. Reserved offcuts go back to inventory."
        footer={<>
          <Button variant="secondary" onClick={() => setConfirmDelete(false)}>Keep project</Button>
          <Button variant="danger" onClick={async () => { await api.del(`/projects/${p.id}`); toast.success("Project deleted"); nav("/projects"); }}>Delete project</Button>
        </>}>
        <p className="text-sm text-slate-600 dark:text-slate-400">“{p.name}” will be permanently deleted. This can't be undone.</p>
      </Modal>
    </div>
  );
}

// ---------------------------------------------------------------- Overview

function OverviewTab({ p, onSaved, onGo }: { p: Project; onSaved: (p: Project) => void; onGo: (t: Tab) => void }) {
  const [d, setD] = useState({ name: p.name, client: p.client ?? "", city: p.city, building_height_m: p.building_height_m as number | "", glass_spec: p.glass_spec, terrain: p.terrain, zone: p.zone });
  const [saving, setSaving] = useState(false);
  const dirty = d.name !== p.name || d.client !== (p.client ?? "") || d.city !== p.city || d.building_height_m !== p.building_height_m || d.glass_spec !== p.glass_spec || d.terrain !== p.terrain || d.zone !== p.zone;
  const engChanged = d.city !== p.city || d.building_height_m !== p.building_height_m || d.glass_spec !== p.glass_spec || d.terrain !== p.terrain || d.zone !== p.zone;
  const save = async () => {
    if (!d.name.trim() || !d.city.trim() || !d.building_height_m) return toast.error("Name, city and height are required");
    setSaving(true);
    try {
      let r = await api.patch<Project>(`/projects/${p.id}`, { ...d, client: d.client || null });
      if (engChanged) r = await api.post<Project>(`/projects/${p.id}/validate`);
      onSaved(r);
      toast.success("Project updated", { description: engChanged ? "Inputs changed – IS 875 check re-run; cutting & quote reset." : undefined });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const cards = [
    { title: "Wind load", icon: <Wind className="h-4 w-4" />, tab: "structural" as Tab, value: p.wind ? `${p.wind.design_pressure_kpa} kPa` : "Not checked", sub: p.wind ? `Vb ${p.wind.factors.Vb} m/s · k2 ${p.wind.factors.k2}` : "Run the IS 875 check" },
    { title: "Glass", icon: p.wind?.all_safe === false ? <ShieldAlert className="h-4 w-4 text-rose-500" /> : <ShieldCheck className="h-4 w-4" />, tab: "structural" as Tab, value: p.wind ? pct(p.wind.max_utilisation) : "—", sub: p.wind ? `${p.wind.all_safe ? "Passes" : "Fails"} · governed by ${p.wind.governing_panel}` : p.glass_label, bad: p.wind?.all_safe === false },
    { title: "Silicone", icon: <Info className="h-4 w-4" />, tab: "structural" as Tab, value: p.silicone ? `${p.silicone.bite_mm} × ${p.silicone.glueline_thickness_mm} mm` : "—", sub: p.silicone ? `${p.silicone.structural_sausages_600ml} sausages DOWSIL 995` : "After a passing check" },
    { title: "Cutting", icon: <Scissors className="h-4 w-4" />, tab: "cutting" as Tab, value: p.cutting ? `${p.cutting.totals.jumbo_sheets} sheets` : "—", sub: p.cutting ? `${p.cutting.totals.scrap_pct}% net scrap · ${p.cutting.totals.offcuts_used} offcuts reused` : "Not optimized" },
    { title: "Quote", icon: <FileText className="h-4 w-4" />, tab: "quote" as Tab, value: p.quote ? inr(p.quote.grand_total, { compact: true }) : "—", sub: p.quote ? `${p.quote.margin_percent}% margin · ${inr(p.quote.rate_per_sqm)}/m²` : "Not generated" },
  ];

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="grid gap-4 sm:grid-cols-2 lg:col-span-2 lg:grid-cols-3 lg:content-start">
        {cards.map((c) => (
          <button key={c.title} onClick={() => onGo(c.tab)} className="text-left">
            <Card className={cn("h-full p-4 transition hover:border-brand-300 dark:hover:border-brand-800", c.bad && "border-rose-200 dark:border-rose-900")}>
              <div className="flex items-center justify-between text-xs font-medium uppercase tracking-wide text-slate-500"><span>{c.title}</span><span className="text-slate-400">{c.icon}</span></div>
              <p className={cn("mt-2 text-xl font-semibold tabular-nums", c.bad && "text-rose-600")}>{c.value}</p>
              <p className="mt-0.5 text-xs text-slate-500">{c.sub}</p>
            </Card>
          </button>
        ))}
        <Card className="p-4">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Schedule</div>
          <p className="mt-2 text-xl font-semibold tabular-nums">{num(p.panel_count)} panels</p>
          <p className="mt-0.5 text-xs text-slate-500">{p.panel_types} types · {num(p.panel_area_m2, 1)} m²</p>
        </Card>
      </div>

      <Card>
        <CardHeader title="Project settings" subtitle="Changing site or glass inputs re-runs the safety check" />
        <div className="space-y-4 p-5">
          <Field label="Name" htmlFor="ps-name"><Input id="ps-name" value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} /></Field>
          <Field label="Client" htmlFor="ps-client"><Input id="ps-client" value={d.client} onChange={(e) => setD({ ...d, client: e.target.value })} /></Field>
          <Field label="City" htmlFor="ps-city"><CityInput id="ps-city" value={d.city} onChange={(v) => setD({ ...d, city: v })} /></Field>
          <Field label="Installation height" htmlFor="ps-h"><HeightInput id="ps-h" value={d.building_height_m} onChange={(v) => setD({ ...d, building_height_m: v })} /></Field>
          <Field label="Glass" htmlFor="ps-g"><GlassSelect id="ps-g" value={d.glass_spec} onChange={(v) => setD({ ...d, glass_spec: v })} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Terrain" htmlFor="ps-t"><Select id="ps-t" value={d.terrain} onChange={(e) => setD({ ...d, terrain: Number(e.target.value) })}>{[1, 2, 3, 4].map((t) => <option key={t} value={t}>Category {t}</option>)}</Select></Field>
            <Field label="Zone" htmlFor="ps-z"><Select id="ps-z" value={d.zone} onChange={(e) => setD({ ...d, zone: e.target.value })}><option value="typical">Typical</option><option value="corner">Corner / edge</option></Select></Field>
          </div>
          {engChanged && p.wind && <p className="flex gap-2 rounded-lg bg-amber-50 p-2.5 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"><AlertTriangle className="h-4 w-4 shrink-0" /> Saving will re-run IS 875 and clear the cutting plan & quote.</p>}
          <div className="flex justify-end gap-2">
            {dirty && <Button variant="ghost" onClick={() => setD({ name: p.name, client: p.client ?? "", city: p.city, building_height_m: p.building_height_m, glass_spec: p.glass_spec, terrain: p.terrain, zone: p.zone })}>Discard</Button>}
            <Button disabled={!dirty} loading={saving} onClick={save} icon={<Save className="h-4 w-4" />}>Save changes</Button>
          </div>
        </div>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- Panels

function PanelsTab({ p, onSaved }: { p: Project; onSaved: (p: Project) => void }) {
  const [panels, setPanels] = useState<Panel[]>(p.panels);
  const [saving, setSaving] = useState(false);
  useEffect(() => setPanels(p.panels), [p.panels]);
  const dirty = JSON.stringify(panels.map(({ id: _id, ...x }) => x)) !== JSON.stringify(p.panels.map(({ id: _id, ...x }) => x));
  const err = panels.length === 0 ? "Add at least one panel" : panels.map(panelErrors).find(Boolean);
  const save = async () => {
    if (err) return toast.error(err);
    setSaving(true);
    try {
      await api.patch<Project>(`/projects/${p.id}`, { panels });
      const r = await api.post<Project>(`/projects/${p.id}/validate`);
      onSaved(r);
      toast.success("Schedule saved", { description: "IS 875 check re-run on the new schedule." });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Card>
      <CardHeader title="Window schedule" subtitle="Edit inline or import a CSV / Excel file. Units are normalised to mm; unclear rows are highlighted."
        action={<div className="flex gap-2">
          {!dirty && <Link to={`/designer?project=${p.id}`}><Button variant="secondary" size="sm" icon={<PenTool className="h-3.5 w-3.5" />}>Design an elevation</Button></Link>}
          {dirty && <Button variant="ghost" size="sm" onClick={() => setPanels(p.panels)}>Discard</Button>}
          <Button size="sm" disabled={!dirty} loading={saving} onClick={save} icon={<Save className="h-3.5 w-3.5" />}>Save & re-check</Button>
        </div>} />
      <div className="p-5">
        {dirty && p.cutting && <p className="mb-3 flex gap-2 rounded-lg bg-amber-50 p-2.5 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"><AlertTriangle className="h-4 w-4 shrink-0" /> Saving changes clears the current cutting plan and quote.</p>}
        <PanelEditor panels={panels} onChange={setPanels} />
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------- Structural

function StructuralTab({ p, busy, onValidate, onApply, onOptimize }: { p: Project; busy: string | null; onValidate: () => void; onApply: () => void; onOptimize: () => void }) {
  const w = p.wind;
  if (!w) return (
    <Card><EmptyState icon={<Wind className="h-6 w-6" />} title="Not checked yet" body="Run the IS 875 (Part 3) check to compute design wind pressure and validate every pane."
      action={<Button onClick={onValidate} loading={busy === "validate"} icon={<Wind className="h-4 w-4" />}>Run IS 875 check</Button>} /></Card>
  );
  const chain = [
    { k: "Vb", v: `${w.factors.Vb} m/s`, d: `Basic wind speed · ${w.city}` },
    { k: "× k1·k2·k3·k4", v: `${w.factors.k1} · ${w.factors.k2} · ${w.factors.k3} · ${w.factors.k4}`, d: `k2 at ${w.height_m} m, terrain cat. ${w.terrain_category}` },
    { k: "Vz", v: `${w.Vz_mps} m/s`, d: "Design wind speed" },
    { k: "pz = 0.6 Vz²", v: `${w.pz_kpa} kPa`, d: "Design wind pressure" },
    { k: "pd", v: `${w.pd_kpa} kPa`, d: `Kd ${w.factors.Kd} · Ka ${w.factors.Ka} · Kc ${w.factors.Kc}` },
    { k: "× Cp,net", v: `${w.design_pressure_kpa} kPa`, d: `${w.factors.Cp_net} – ${w.zone} zone`, strong: true },
  ];
  return (
    <div className="space-y-6">
      {!w.all_safe ? (
        <div className="flex flex-col gap-4 rounded-xl border border-rose-200 bg-rose-50 p-5 sm:flex-row sm:items-center dark:border-rose-900 dark:bg-rose-950/30">
          <ShieldAlert className="h-8 w-8 shrink-0 text-rose-600" />
          <div className="flex-1">
            <p className="font-semibold text-rose-900 dark:text-rose-200">{w.glass_label} is not safe for {w.failing_panels.join(", ")}</p>
            <p className="mt-0.5 text-sm text-rose-800/80 dark:text-rose-300/80">
              Peak utilisation {pct(w.max_utilisation)}. Minimum safe: <b>{specLabel(w.min_safe_toughened)}</b>{w.min_safe_laminated && <> or <b>{specLabel(w.min_safe_laminated)}</b></>}. Cutting is blocked until this is fixed.
            </p>
          </div>
          {w.recommended_glass_spec && <Button variant="danger" onClick={onApply} loading={busy === "apply"}>Apply {specLabel(w.recommended_glass_spec)}</Button>}
        </div>
      ) : (
        <div className="flex flex-col gap-4 rounded-xl border border-emerald-200 bg-emerald-50 p-5 sm:flex-row sm:items-center dark:border-emerald-900 dark:bg-emerald-950/30">
          <ShieldCheck className="h-8 w-8 shrink-0 text-emerald-600" />
          <div className="flex-1">
            <p className="font-semibold text-emerald-900 dark:text-emerald-200">{w.glass_label} passes for {p.panel_types === 1 ? "the panel type" : `all ${p.panel_types} panel types`}</p>
            <p className="mt-0.5 text-sm text-emerald-800/80 dark:text-emerald-300/80">Governing pane {w.governing_panel} at {pct(w.max_utilisation)} utilisation. Screening check – final design needs facade-engineer sign-off.</p>
          </div>
          {!p.cutting && <Button onClick={onOptimize} loading={busy === "optimize"} icon={<Scissors className="h-4 w-4" />}>Optimize cutting</Button>}
        </div>
      )}

      <Card>
        <CardHeader title="IS 875 (Part 3) design pressure" subtitle={`${w.terrain_label} · ${w.zone_label}`} icon={<Wind className="h-4 w-4" />} />
        <div className="grid gap-px overflow-hidden bg-slate-100 sm:grid-cols-3 lg:grid-cols-6 dark:bg-slate-800">
          {chain.map((c, i) => (
            <div key={i} className={cn("bg-white p-4 dark:bg-slate-900", c.strong && "bg-brand-50 dark:bg-brand-950/40")}>
              <p className="font-mono text-[11px] text-slate-500">{c.k}</p>
              <p className={cn("mt-1 text-base font-semibold tabular-nums", c.strong && "text-brand-800 dark:text-brand-300")}>{c.v}</p>
              <p className="mt-0.5 text-[11px] text-slate-500">{c.d}</p>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <CardHeader title="Pane checks" subtitle={`${w.glass_label} · four-edge supported · linear plate theory (conservative)`} />
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead><tr><th>Panel</th><th>Size (mm)</th><th className="min-w-[160px]">Stress</th><th className="min-w-[160px]">Deflection</th><th>Governs</th><th>Result</th></tr></thead>
            <tbody>
              {w.panels.map((r) => (
                <tr key={r.tag}>
                  <td className="font-medium">{r.tag}<span className="block text-xs font-normal text-slate-500">× {r.quantity}</span></td>
                  <td className="whitespace-nowrap tabular-nums">{r.width_mm} × {r.height_mm}</td>
                  <td><UtilBar value={r.stress_utilisation} /><p className="mt-0.5 text-[11px] text-slate-500">{r.max_stress_mpa} / {r.allowable_stress_mpa} MPa</p></td>
                  <td><UtilBar value={r.deflection_utilisation} /><p className="mt-0.5 text-[11px] text-slate-500">{r.max_deflection_mm} / {r.allowable_deflection_mm} mm</p></td>
                  <td className="capitalize">{r.governing}</td>
                  <td>{r.pass ? <Badge tone="emerald">Pass</Badge> : <Badge tone="rose">Fail</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {p.silicone && (
        <Card>
          <CardHeader title="Structural silicone" subtitle={p.silicone.sealant_label} />
          <div className="grid grid-cols-2 gap-6 p-5 sm:grid-cols-4">
            <Metric label="Bite" value={`${p.silicone.bite_mm} mm`} sub={p.silicone.governed_by_minimum ? "Governed by 6 mm minimum" : `Calc. ${p.silicone.calculated_bite_mm} mm`} />
            <Metric label="Glueline" value={`${p.silicone.glueline_thickness_mm} mm`} sub={`Bite:thickness ${p.silicone.bite_to_thickness_ratio}:1`} />
            <Metric label="Structural (995)" value={`${p.silicone.structural_sausages_600ml} pcs`} sub={`600 ml · ${inr(p.silicone.structural_cost_inr)}`} />
            <Metric label="Weatherseal (795)" value={`${p.silicone.weatherseal_sausages_600ml} pcs`} sub={inr(p.silicone.weatherseal_cost_inr)} />
          </div>
          <p className="border-t border-slate-100 px-5 py-3 text-xs text-slate-500 dark:border-slate-800">{p.silicone.notes.join(" ")}</p>
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Cutting

function CuttingTab({ p, busy, onOptimize, onValidate, onSaved, onQuote }: { p: Project; busy: string | null; onOptimize: (offcuts: boolean) => void; onValidate: () => void; onSaved: () => void; onQuote: () => void }) {
  const c = p.cutting;
  const { isAdmin } = useAuth();
  const [highlight, setHighlight] = useState<string | null>(null);
  const [zoom, setZoom] = useState<Sheet | null>(null);
  const [savingRem, setSavingRem] = useState(false);
  const tags = useMemo(() => p.panels.map((x) => x.tag), [p.panels]);
  const colors = useTagColors(tags);

  if (!c) {
    const blocked = !p.wind ? "Run the IS 875 check first." : !p.wind.all_safe ? "The glass spec fails IS 875 – fix it on the Structural tab first." : null;
    return (
      <Card><EmptyState icon={<Scissors className="h-6 w-6" />} title="No cutting plan yet"
        body={blocked ?? `Pack ${p.panel_count} panels onto ${p.cutting ? "" : "3660 × 2440 mm"} jumbo sheets. Matching factory offcuts are used first.`}
        action={blocked ? <Button variant="secondary" onClick={onValidate} loading={busy === "validate"}>{!p.wind ? "Run IS 875 check" : "Re-check"}</Button>
          : <Button onClick={() => onOptimize(true)} loading={busy === "optimize"} icon={<Scissors className="h-4 w-4" />}>Optimize cutting</Button>} /></Card>
    );
  }
  const t = c.totals;
  const sheets = c.groups.flatMap((g) => g.sheets);
  const remnantCount = sheets.reduce((a, s) => a + s.remnants.length, 0);
  const saveRemnants = async () => {
    setSavingRem(true);
    try {
      const r = await api.post<{ added: number }>(`/projects/${p.id}/remnants`);
      toast.success(`${r.added} remnants added to offcut inventory`);
      onSaved();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSavingRem(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <div className="grid grid-cols-2 gap-6 p-5 sm:grid-cols-3 lg:grid-cols-6">
          <Metric label="Jumbo sheets" value={t.jumbo_sheets} sub={`${c.jumbo_size_mm[0]} × ${c.jumbo_size_mm[1]} mm`} />
          <Metric label="Offcuts reused" value={t.offcuts_used} sub="Before new sheets" />
          <Metric label="Panel area" value={`${num(t.panel_area_m2, 1)} m²`} sub={`${t.panel_count} panels`} />
          <Metric label="Glass consumed" value={`${num(t.consumed_area_m2, 1)} m²`} sub={`Gross waste ${t.gross_scrap_pct}%`} />
          <Metric label="Reusable remnants" value={`${num(t.reusable_remnant_area_m2, 1)} m²`} sub={`${remnantCount} pieces ≥ 300 mm`} />
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Net scrap</p>
            <p className={cn("mt-0.5 text-lg font-semibold tabular-nums", t.scrap_pct <= t.target_scrap_pct ? "text-emerald-600" : "text-amber-600")}>{t.scrap_pct}%</p>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"><div className={cn("h-full rounded-full", t.scrap_pct <= 3 ? "bg-emerald-500" : "bg-amber-500")} style={{ width: `${Math.min(100, (t.scrap_pct / 10) * 100)}%` }} /></div>
            <p className="mt-0.5 text-[11px] text-slate-500">Target &lt; {t.target_scrap_pct}%</p>
          </div>
        </div>
        <div className="flex flex-col gap-3 border-t border-slate-100 px-5 py-3 sm:flex-row sm:items-center dark:border-slate-800">
          <div className="flex flex-1 flex-wrap items-center gap-1.5">
            <span className="mr-1 text-xs text-slate-500">Highlight:</span>
            {[...new Set(tags)].map((tg) => (
              <button key={tg} onClick={() => setHighlight(highlight === tg ? null : tg)} className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 transition", highlight === tg ? "ring-2" : "ring-slate-200 dark:ring-slate-700", highlight && highlight !== tg && "opacity-50")} style={{ color: colors[tg], ...(highlight === tg ? { boxShadow: `0 0 0 2px ${colors[tg]}` } : {}) }}>
                <span className="h-2 w-2 rounded-sm" style={{ background: colors[tg] }} />{tg}
              </button>
            ))}
            <span className="ml-2 inline-flex items-center gap-1.5 text-xs text-slate-500"><span className="h-2.5 w-2.5 rounded-sm border border-dashed border-emerald-500 bg-emerald-500/20" /> reusable remnant</span>
            <span className="inline-flex items-center gap-1.5 text-xs text-slate-500"><span className="h-2.5 w-2.5 rounded-sm border border-dashed border-amber-400 bg-amber-50" /> offcut</span>
          </div>
          <div className="no-print flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" icon={<RefreshCw className="h-3.5 w-3.5" />} loading={busy === "optimize"} onClick={() => onOptimize(true)}>Re-optimize</Button>
            {remnantCount > 0 && isAdmin && <Button variant="secondary" size="sm" icon={<Boxes className="h-3.5 w-3.5" />} loading={savingRem} disabled={c.remnants_saved} onClick={saveRemnants}>{c.remnants_saved ? "Remnants saved" : "Save remnants"}</Button>}
            <Button variant="secondary" size="sm" icon={<Printer className="h-3.5 w-3.5" />} onClick={() => window.print()}>Print</Button>
            {!p.quote && <Button size="sm" icon={<FileText className="h-3.5 w-3.5" />} onClick={onQuote}>Generate quote</Button>}
          </div>
        </div>
      </Card>

      {c.groups.map((g) => (
        <div key={g.glass_spec}>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold">{specLabel(g.glass_spec)} <span className="font-normal text-slate-500">· {g.sheets.length} sheets in {patterns(g.sheets).length} cutting pattern{patterns(g.sheets).length > 1 ? "s" : ""} · best heuristic: {g.heuristic.replace("_", " ")}</span></h3>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {patterns(g.sheets).map(({ sheet: s, indices }, pi) => (
              <Card key={s.index} className="group overflow-hidden">
                <div className="flex items-center justify-between px-4 pt-3 text-xs">
                  <span className="flex items-center gap-2 font-semibold">
                    {indices.length > 1 ? <>Pattern {String.fromCharCode(65 + (pi % 26))} <Badge tone="brand">× {indices.length} sheets</Badge></> : <>Sheet {s.index}</>}
                  </span>
                  <div className="flex items-center gap-2">
                    {s.source === "offcut" ? <Badge tone="amber">Offcut #{s.offcut_id}</Badge> : <Badge tone="slate">Jumbo</Badge>}
                    <span className="tabular-nums text-slate-500">{s.utilisation_pct}% used</span>
                    <button onClick={() => setZoom(s)} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800" aria-label={`Enlarge sheet ${s.index}`}><Maximize2 className="h-3.5 w-3.5" /></button>
                  </div>
                </div>
                <div className="p-3"><CuttingSheet sheet={s} colors={colors} compact highlight={highlight} /></div>
                <p className="border-t border-slate-100 px-4 py-2 text-[11px] text-slate-500 dark:border-slate-800">{indices.length > 1 && <>{rangeLabel(indices)} · </>}{s.placements.length} panels{indices.length > 1 ? " each" : ""} · {s.width_mm}×{s.height_mm} mm{s.remnants.length ? ` · ${s.remnants.length} reusable remnant${s.remnants.length > 1 ? "s" : ""}` : ""}</p>
              </Card>
            ))}
          </div>
        </div>
      ))}
      <p className="text-xs text-slate-500">Guillotine layouts (score-and-snap cuttable) · {c.edge_trim_mm} mm edge trim · {c.kerf_mm} mm cutting allowance · rotation allowed. Hover a panel in the enlarged view for its ID and coordinates.</p>

      <Modal open={!!zoom} onClose={() => setZoom(null)} size="xl" title={zoom ? `Sheet ${zoom.index} · ${zoom.source === "offcut" ? `Offcut #${zoom.offcut_id}` : "Jumbo"}` : ""} description={zoom ? `${zoom.width_mm} × ${zoom.height_mm} mm · ${zoom.placements.length} panels · ${zoom.utilisation_pct}% utilised` : ""}>
        {zoom && (
          <div className="space-y-4">
            <CuttingSheet sheet={zoom} colors={colors} highlight={highlight} />
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead><tr><th>Panel ID</th><th>Size</th><th>Position (x, y)</th><th>Rotated</th></tr></thead>
                <tbody>{zoom.placements.map((pl) => <tr key={pl.uid}><td className="font-medium" style={{ color: colors[pl.tag] }}>{pl.uid}</td><td className="tabular-nums">{pl.w} × {pl.h}</td><td className="tabular-nums">{pl.x}, {pl.y}</td><td>{pl.rotated ? "Yes" : "No"}</td></tr>)}</tbody>
              </table>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

/** Identical layouts are cut the same way on the table – group them so the factory sees patterns, not 20 copies. */
function patterns(sheets: Sheet[]) {
  const out: { sheet: Sheet; indices: number[]; key: string }[] = [];
  for (const s of sheets) {
    const layout = JSON.stringify(s.placements.map((p) => [p.tag, p.x, p.y, p.w, p.h]));
    const key = s.source === "offcut" ? `offcut-${s.offcut_id}-${layout}` : layout;
    const hit = out.find((o) => o.key === key);
    if (hit) hit.indices.push(s.index);
    else out.push({ sheet: s, indices: [s.index], key });
  }
  return out;
}

function rangeLabel(ix: number[]) {
  const contiguous = ix.every((v, i) => i === 0 || v === ix[i - 1] + 1);
  return contiguous ? `Sheets ${ix[0]}–${ix[ix.length - 1]}` : `Sheets ${ix.join(", ")}`;
}

// ---------------------------------------------------------------- Quote

function QuoteTab({ p, onQuote, onGo }: { p: Project; onQuote: () => void; onGo: (t: Tab) => void }) {
  const { reference } = useApp();
  if (!p.cutting) return (
    <Card><EmptyState icon={<FileText className="h-6 w-6" />} title="Quote needs a cutting plan" body="Glass is costed on the jumbo sheets actually consumed, so optimize the cutting first."
      action={<Button variant="secondary" onClick={() => onGo("cutting")} icon={<ArrowRight className="h-4 w-4" />}>Go to cutting</Button>} /></Card>
  );
  if (!p.quote || !p.bom) return (
    <Card><EmptyState icon={<FileText className="h-6 w-6" />} title="Ready to quote" body="Pick a margin and preview the BOM before the client PDF is generated."
      action={<Button onClick={onQuote} icon={<FileText className="h-4 w-4" />}>Generate quote</Button>} /></Card>
  );
  const q = p.quote;
  const stale = !!reference?.prices_updated_at && (!q.priced_at || new Date(q.priced_at) < new Date(reference.prices_updated_at));
  return (
    <div className="space-y-6">
    {stale && (
      <div className="flex flex-col gap-3 rounded-[22px] bg-[#fff4e5] p-5 sm:flex-row sm:items-center dark:bg-[#ff9f0a]/10">
        <AlertTriangle className="h-6 w-6 shrink-0 text-[#b25000] dark:text-[#ffb340]" />
        <p className="flex-1 text-sm text-[#7a3700] dark:text-[#ffcf85]"><b>Prices changed since this quote.</b> The PDF still uses the old rates. Re-quote to apply the current price list.</p>
        <Button onClick={onQuote}>Re-quote</Button>
      </div>
    )}
    <div className="grid gap-6 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader title="Bill of materials" subtitle={`${p.bom.panel_count} panels · ${num(p.bom.panel_area_m2, 1)} m² · ${num(p.bom.perimeter_m, 1)} m perimeter`} />
        <BomTable bom={p.bom} />
      </Card>
      <div className="space-y-4">
        <Card className="p-5">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Grand total</p>
          <p className="mt-1 text-3xl font-semibold tracking-tight tabular-nums">{inr(q.grand_total)}</p>
          <p className="text-xs text-slate-500">incl. {q.gst_percent}% GST · {inr(q.rate_per_sqm)}/m² ex-GST</p>
          <dl className="mt-5 space-y-2 text-sm">
            {[["Direct cost", inr(q.direct_cost)], [`Margin (${q.margin_percent}%)`, inr(q.profit)], ["Subtotal", inr(q.subtotal)], [`GST ${q.gst_percent}%`, inr(q.gst)]].map(([k, v]) => (
              <div key={k} className="flex justify-between"><dt className="text-slate-500">{k}</dt><dd className="font-medium tabular-nums">{v}</dd></div>
            ))}
          </dl>
          <div className="mt-5 flex flex-col gap-2">
            <a href={`/api/v1/projects/${p.id}/quote.pdf`} target="_blank" rel="noreferrer"><Button className="w-full" icon={<Download className="h-4 w-4" />}>Download PDF</Button></a>
            <Button variant="secondary" onClick={onQuote}>Re-quote with another margin</Button>
          </div>
        </Card>
        <Card className="flex gap-3 p-4 text-xs text-slate-500">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
          Glass is priced on {p.cutting.totals.jumbo_sheets} jumbo sheets actually consumed (scrap is a real cost); reused offcuts are free.
        </Card>
      </div>
    </div>
    </div>
  );
}

function QuoteModal({ open, onClose, p, onDone }: { open: boolean; onClose: () => void; p: Project; onDone: (p: Project) => void }) {
  const { reference } = useApp();
  const [margin, setMargin] = useState(p.quote?.margin_percent ?? reference?.default_margin_pct ?? 18);
  const dm = useDebounced(margin, 200);
  const [preview, setPreview] = useState<{ bom: Bom; quote: Quote } | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!open || !p.cutting) return;
    api.get<{ bom: Bom; quote: Quote }>(`/projects/${p.id}/quote-preview?margin_percent=${dm}`).then(setPreview).catch(() => setPreview(null));
  }, [open, dm, p.id, p.cutting]);
  const generate = async () => {
    setSaving(true);
    try {
      const r = await api.post<Project>(`/projects/${p.id}/quote`, { margin_percent: margin });
      onDone(r);
      onClose();
      toast.success("Quotation PDF generated", { action: { label: "Download", onClick: () => window.open(`/api/v1/projects/${p.id}/quote.pdf`, "_blank") } });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal open={open} onClose={onClose} size="lg" title="Generate client quotation" description="Review the numbers – the PDF is client-facing."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={saving} onClick={generate} icon={<FileText className="h-4 w-4" />}>Approve & generate PDF</Button></>}>
      <div className="space-y-5">
        <div>
          <div className="flex items-center justify-between text-sm">
            <label htmlFor="qm" className="font-medium">Margin on selling price</label>
            <div className="flex items-center gap-2">
              <Input type="number" min={0} max={60} step={0.5} value={margin} onChange={(e) => setMargin(Math.max(0, Math.min(60, Number(e.target.value))))} className="w-20 text-right" aria-label="Margin percent" />
              <span className="text-slate-500">%</span>
            </div>
          </div>
          <input id="qm" type="range" min={5} max={40} step={0.5} value={margin} onChange={(e) => setMargin(Number(e.target.value))} className="mt-3 w-full accent-brand-700" />
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[["Direct cost", preview?.quote.direct_cost], ["Profit", preview?.quote.profit], ["GST", preview?.quote.gst], ["Grand total", preview?.quote.grand_total]].map(([k, v]) => (
            <div key={k as string} className={cn("rounded-lg bg-slate-50 p-3 dark:bg-slate-800/50", k === "Grand total" && "bg-brand-50 dark:bg-brand-950/40")}>
              <p className="text-[11px] text-slate-500">{k}</p>
              <p className={cn("text-sm font-semibold tabular-nums", k === "Profit" && "text-emerald-600")}>{inr(v as number | undefined)}</p>
            </div>
          ))}
        </div>
        {preview && (
          <details className="rounded-lg border border-slate-200 dark:border-slate-700">
            <summary className="cursor-pointer px-4 py-2.5 text-sm font-medium">BOM preview ({preview.bom.lines.length} lines)</summary>
            <div className="max-h-72 overflow-y-auto border-t border-slate-100 dark:border-slate-800"><BomTable bom={preview.bom} /></div>
          </details>
        )}
      </div>
    </Modal>
  );
}
