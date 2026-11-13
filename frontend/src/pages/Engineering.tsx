import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ArrowRight, Info, Scissors, ShieldAlert, ShieldCheck, Wind } from "lucide-react";
import { api, type Cutting, type Panel, type PlateCheck, type Silicone } from "../lib/api";
import { cn, inr, num, pct, specLabel, useDebounced } from "../lib/utils";
import { Badge, Button, Card, CardHeader, Field, Input, PageHeader, Segmented, Select, Spinner, UtilBar } from "../components/ui";
import { CityInput, GlassSelect, HeightInput } from "../components/ProjectForm";
import { CuttingSheet, Metric, useTagColors } from "../components/viz";
import PanelEditor, { panelErrors } from "../components/PanelEditor";

type ToolTab = "wind" | "silicone" | "cutting";

interface WindResult {
  city: string; design_pressure_kpa: number; Vz_mps: number; pz_kpa: number; pd_kpa: number;
  factors: { Vb: number; k2: number; Cp_net: number }; glass_label: string; check: PlateCheck; safe: boolean;
  min_safe_toughened: { glass_spec: string; utilisation: number } | null; min_safe_laminated: { glass_spec: string; utilisation: number } | null;
  assumptions: string[];
}

function WindTool({ onSilicone }: { onSilicone: (p: { pressure: number; short: number; perimeter: number }) => void }) {
  const [f, setF] = useState({ city: "Mumbai", h: 42.9 as number | "", w: 2400, ht: 1500, glass: "8mm_toughened", terrain: 3, zone: "typical" });
  const df = useDebounced(f, 350);
  const [r, setR] = useState<WindResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!df.city.trim() || !df.h || !df.w || !df.ht) { setR(null); return; }
    setLoading(true);
    api.post<WindResult>("/engineering/wind", { city: df.city, building_height_m: df.h, window_width_mm: df.w, window_height_mm: df.ht, glass_spec: df.glass, terrain: df.terrain, zone: df.zone })
      .then((x) => { setR(x); setErr(null); }).catch((e) => setErr(e.message)).finally(() => setLoading(false));
  }, [df]);

  return (
    <div className="grid gap-6 lg:grid-cols-5">
      <Card className="lg:col-span-2">
        <CardHeader title="Inputs" subtitle="Results update as you type" icon={<Wind className="h-4 w-4" />} action={loading ? <Spinner /> : null} />
        <div className="space-y-4 p-5">
          <Field label="City" htmlFor="w-city"><CityInput id="w-city" value={f.city} onChange={(v) => setF({ ...f, city: v })} /></Field>
          <Field label="Installation height" htmlFor="w-h"><HeightInput id="w-h" value={f.h} onChange={(v) => setF({ ...f, h: v })} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Pane width" htmlFor="w-w"><Input id="w-w" type="number" value={f.w || ""} onChange={(e) => setF({ ...f, w: Number(e.target.value) })} suffix="mm" /></Field>
            <Field label="Pane height" htmlFor="w-ht"><Input id="w-ht" type="number" value={f.ht || ""} onChange={(e) => setF({ ...f, ht: Number(e.target.value) })} suffix="mm" /></Field>
          </div>
          <Field label="Glass" htmlFor="w-g"><GlassSelect id="w-g" value={f.glass} onChange={(v) => setF({ ...f, glass: v })} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Terrain" htmlFor="w-t"><Select id="w-t" value={f.terrain} onChange={(e) => setF({ ...f, terrain: Number(e.target.value) })}>{[1, 2, 3, 4].map((t) => <option key={t} value={t}>Category {t}</option>)}</Select></Field>
            <Field label="Zone" htmlFor="w-z"><Select id="w-z" value={f.zone} onChange={(e) => setF({ ...f, zone: e.target.value })}><option value="typical">Typical</option><option value="corner">Corner / edge</option></Select></Field>
          </div>
        </div>
      </Card>

      <div className={cn("space-y-4 transition-opacity lg:col-span-3", loading && "opacity-70")}>
        {err && <Card className="border-rose-200 p-5 text-sm text-rose-700 dark:border-rose-900">{err}</Card>}
        {!r && !err && <Card className="p-10 text-center text-sm text-slate-500">Enter a city, height and pane size to see results.</Card>}
        {r && (
          <>
            <Card className={cn("p-5", r.safe ? "border-emerald-200 dark:border-emerald-900" : "border-rose-200 dark:border-rose-900")}>
              <div className="flex items-start gap-4">
                {r.safe ? <ShieldCheck className="h-10 w-10 shrink-0 text-emerald-600" /> : <ShieldAlert className="h-10 w-10 shrink-0 text-rose-600" />}
                <div className="flex-1">
                  <p className={cn("text-lg font-semibold", r.safe ? "text-emerald-700 dark:text-emerald-400" : "text-rose-700 dark:text-rose-400")}>{r.glass_label} {r.safe ? "is safe" : "is NOT safe"}</p>
                  <p className="text-sm text-slate-500">{pct(r.check.utilisation)} utilisation · {r.check.governing} governs</p>
                </div>
                <div className="text-right">
                  <p className="text-[11px] uppercase tracking-wide text-slate-500">Design pressure</p>
                  <p className="text-2xl font-semibold tabular-nums">{r.design_pressure_kpa}<span className="text-sm font-normal text-slate-500"> kPa</span></p>
                </div>
              </div>
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <div><p className="mb-1 text-xs text-slate-500">Stress {r.check.max_stress_mpa} / {r.check.allowable_stress_mpa} MPa</p><UtilBar value={r.check.stress_utilisation} /></div>
                <div><p className="mb-1 text-xs text-slate-500">Deflection {r.check.max_deflection_mm} / {r.check.allowable_deflection_mm} mm</p><UtilBar value={r.check.deflection_utilisation} /></div>
              </div>
            </Card>
            <div className="grid gap-4 sm:grid-cols-2">
              {[["Min. safe toughened", r.min_safe_toughened, "toughened"], ["Min. safe laminated", r.min_safe_laminated, "laminated"]].map(([label, rec, fam]) => {
                const x = rec as WindResult["min_safe_toughened"];
                return (
                  <Card key={label as string} className="flex items-center justify-between gap-3 p-4">
                    <div>
                      <p className="text-xs text-slate-500">{label as string}</p>
                      <p className="font-semibold">{x ? specLabel(x.glass_spec) : "None in catalogue"}</p>
                      {x && <p className="text-xs text-slate-500">{pct(x.utilisation)} utilisation</p>}
                    </div>
                    {x && x.glass_spec !== f.glass && <Button size="sm" variant="secondary" onClick={() => setF({ ...f, glass: x.glass_spec })} aria-label={`Use ${fam}`}>Use</Button>}
                  </Card>
                );
              })}
            </div>
            <Card>
              <div className="grid grid-cols-2 gap-6 p-5 sm:grid-cols-4">
                <Metric label="Vb" value={`${r.factors.Vb} m/s`} sub={r.city} />
                <Metric label="k2" value={r.factors.k2} sub={`Terrain ${f.terrain}`} />
                <Metric label="Vz" value={`${r.Vz_mps} m/s`} sub={`pz ${r.pz_kpa} kPa`} />
                <Metric label="Cp,net" value={r.factors.Cp_net} sub={`pd ${r.pd_kpa} kPa`} />
              </div>
              <div className="flex flex-col gap-3 border-t border-slate-100 px-5 py-3 sm:flex-row sm:items-center dark:border-slate-800">
                <p className="flex flex-1 gap-2 text-xs text-slate-500"><Info className="h-4 w-4 shrink-0" />{r.assumptions[0]} {r.assumptions[3]}</p>
                <Button size="sm" variant="secondary" onClick={() => onSilicone({ pressure: r.design_pressure_kpa, short: Math.min(f.w, f.ht), perimeter: (2 * (f.w + f.ht)) / 1000 })} icon={<ArrowRight className="h-3.5 w-3.5" />}>Size silicone</Button>
              </div>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}

function SiliconeTool({ init }: { init: { pressure: number; short: number; perimeter: number } | null }) {
  const [f, setF] = useState({ p: init?.pressure ?? 1.5, short: init?.short ?? 1500, perim: init?.perimeter ?? 7.8, n: 1, grade: "dowsil_995" });
  useEffect(() => { if (init) setF((x) => ({ ...x, p: init.pressure, short: init.short, perim: Math.round(init.perimeter * 100) / 100 })); }, [init]);
  const df = useDebounced(f, 300);
  const [r, setR] = useState<Silicone | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!df.p || !df.short || !df.perim || !df.n) return;
    api.post<Silicone>("/engineering/silicone", { wind_pressure_kpa: df.p, short_span_mm: df.short, perimeter_m: df.perim, panel_count: df.n, sealant_grade: df.grade })
      .then((x) => { setR(x); setErr(null); }).catch((e) => setErr(e.message));
  }, [df]);
  return (
    <div className="grid gap-6 lg:grid-cols-5">
      <Card className="lg:col-span-2">
        <CardHeader title="Inputs" subtitle="ASTM C1401 trapezoidal load method" />
        <div className="space-y-4 p-5">
          <Field label="Design wind pressure" htmlFor="s-p" hint="Use the IS 875 calculator to get this"><Input id="s-p" type="number" step="0.01" value={f.p || ""} onChange={(e) => setF({ ...f, p: Number(e.target.value) })} suffix="kPa" /></Field>
          <Field label="Short span of pane" htmlFor="s-s"><Input id="s-s" type="number" value={f.short || ""} onChange={(e) => setF({ ...f, short: Number(e.target.value) })} suffix="mm" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Perimeter per panel" htmlFor="s-per"><Input id="s-per" type="number" step="0.1" value={f.perim || ""} onChange={(e) => setF({ ...f, perim: Number(e.target.value) })} suffix="m" /></Field>
            <Field label="Panels" htmlFor="s-n"><Input id="s-n" type="number" min={1} value={f.n || ""} onChange={(e) => setF({ ...f, n: Number(e.target.value) })} /></Field>
          </div>
          <Field label="Structural sealant" htmlFor="s-g"><Select id="s-g" value={f.grade} onChange={(e) => setF({ ...f, grade: e.target.value })}><option value="dowsil_995">DOWSIL 995 (1-part)</option><option value="dowsil_993">DOWSIL 993 (2-part)</option></Select></Field>
        </div>
      </Card>
      <div className="space-y-4 lg:col-span-3">
        {err && <Card className="p-5 text-sm text-rose-600">{err}</Card>}
        {r && (
          <>
            <Card className="p-5">
              <div className="flex flex-wrap items-end gap-8">
                <Metric label="Bite" value={<span className="text-3xl">{r.bite_mm} mm</span>} sub={r.governed_by_minimum ? "6 mm minimum governs" : `Calculated ${r.calculated_bite_mm} mm`} />
                <Metric label="Glueline" value={<span className="text-3xl">{r.glueline_thickness_mm} mm</span>} sub={`Ratio ${r.bite_to_thickness_ratio}:1`} />
                <svg viewBox="0 0 120 70" className="ml-auto h-20 w-36" aria-label="Joint section">
                  <rect x="5" y="10" width="110" height="10" rx="1" className="fill-sky-200 dark:fill-sky-900" />
                  <rect x="5" y="20" width={Math.min(60, r.bite_mm * 2.5)} height={Math.max(8, r.glueline_thickness_mm * 1.6)} className="fill-slate-800 dark:fill-slate-300" />
                  <rect x="5" y={20 + Math.max(8, r.glueline_thickness_mm * 1.6)} width="110" height="12" className="fill-slate-300 dark:fill-slate-600" />
                  <text x="60" y="8" fontSize="6" textAnchor="middle" className="fill-slate-500">glass</text>
                  <text x="60" y="66" fontSize="6" textAnchor="middle" className="fill-slate-500">aluminium frame</text>
                </svg>
              </div>
            </Card>
            <div className="grid gap-4 sm:grid-cols-2">
              <Card className="p-4"><Metric label="Structural sausages (600 ml)" value={r.structural_sausages_600ml} sub={`${r.sealant_label} · ${inr(r.structural_cost_inr)}`} /></Card>
              <Card className="p-4"><Metric label="Weatherseal sausages (600 ml)" value={r.weatherseal_sausages_600ml} sub={`${r.weatherseal_label} · ${inr(r.weatherseal_cost_inr)}`} /></Card>
            </div>
            <Card className="p-4 text-xs text-slate-500"><ul className="list-disc space-y-1 pl-4">{r.notes.map((n) => <li key={n}>{n}</li>)}</ul></Card>
          </>
        )}
      </div>
    </div>
  );
}

function CuttingTool() {
  const [panels, setPanels] = useState<Panel[]>([{ tag: "A", width_mm: 1200, height_mm: 900, quantity: 12 }, { tag: "B", width_mm: 2000, height_mm: 1100, quantity: 4 }]);
  const [glass, setGlass] = useState("12mm_toughened");
  const [offcuts, setOffcuts] = useState(true);
  const [r, setR] = useState<Cutting | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const tags = useMemo(() => panels.map((p) => p.tag), [panels]);
  const colors = useTagColors(tags);
  const invalid = panels.length === 0 || panels.some((p) => panelErrors(p));
  const go = async () => {
    setLoading(true);
    try {
      setR(await api.post<Cutting>("/engineering/cutting", { panels, glass_spec: glass, check_offcuts: offcuts }));
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  };
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="Quick nesting" subtitle="Try a cut list without creating a project. Uses your live offcut inventory." icon={<Scissors className="h-4 w-4" />} />
        <div className="space-y-4 p-5">
          <PanelEditor panels={panels} onChange={setPanels} />
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <Field label="Glass" htmlFor="c-g" className="sm:w-72"><GlassSelect id="c-g" value={glass} onChange={setGlass} /></Field>
            <Field label="Offcuts" htmlFor="c-o"><Segmented value={offcuts ? "y" : "n"} onChange={(v) => setOffcuts(v === "y")} options={[{ value: "y", label: "Use offcuts first" }, { value: "n", label: "New sheets only" }]} /></Field>
            <Button className="sm:ml-auto" onClick={go} loading={loading} disabled={invalid} icon={<Scissors className="h-4 w-4" />}>Optimize</Button>
          </div>
          {err && <p className="text-sm text-rose-600">{err}</p>}
        </div>
      </Card>
      {r && (
        <>
          <Card>
            <div className="grid grid-cols-2 gap-6 p-5 sm:grid-cols-5">
              <Metric label="Jumbo sheets" value={r.totals.jumbo_sheets} />
              <Metric label="Offcuts used" value={r.totals.offcuts_used} />
              <Metric label="Panel area" value={`${num(r.totals.panel_area_m2, 1)} m²`} />
              <Metric label="Remnants" value={`${num(r.totals.reusable_remnant_area_m2, 1)} m²`} />
              <div><p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Net scrap</p><p className={cn("mt-0.5 text-lg font-semibold", r.totals.scrap_pct <= 3 ? "text-emerald-600" : "text-amber-600")}>{r.totals.scrap_pct}%</p><Badge tone={r.totals.scrap_pct <= 3 ? "emerald" : "amber"}>{r.totals.scrap_pct <= 3 ? "On target" : "Above 3%"}</Badge></div>
            </div>
          </Card>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {r.groups.flatMap((g) => g.sheets).map((s) => (
              <Card key={`${s.source}-${s.index}`} className="p-3">
                <div className="mb-2 flex items-center justify-between px-1 text-xs"><span className="font-semibold">Sheet {s.index}</span>{s.source === "offcut" ? <Badge tone="amber">Offcut #{s.offcut_id}</Badge> : <span className="text-slate-500">{s.utilisation_pct}% used</span>}</div>
                <CuttingSheet sheet={s} colors={colors} compact />
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default function Engineering() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tool") as ToolTab) || "wind";
  const [sil, setSil] = useState<{ pressure: number; short: number; perimeter: number } | null>(null);
  return (
    <div>
      <PageHeader title="Engineering tools" subtitle="The same deterministic engines VitroCore calls. Use them directly for quick checks."
        actions={<Segmented value={tab} onChange={(v) => setParams({ tool: v }, { replace: true })} options={[{ value: "wind", label: "IS 875 wind & glass" }, { value: "silicone", label: "Silicone" }, { value: "cutting", label: "Cutting" }]} />} />
      {tab === "wind" && <WindTool onSilicone={(x) => { setSil(x); setParams({ tool: "silicone" }, { replace: true }); }} />}
      {tab === "silicone" && <SiliconeTool init={sil} />}
      {tab === "cutting" && <CuttingTool />}
    </div>
  );
}
