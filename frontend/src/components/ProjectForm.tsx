import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { api, type Panel, type Project } from "../lib/api";
import { Button, Field, Input, Modal, Segmented, Select } from "./ui";
import { useApp } from "./Layout";
import PanelEditor, { panelErrors } from "./PanelEditor";

export interface ProjectDraft {
  name: string; client: string; city: string; building_height_m: number | ""; terrain: number; zone: string;
  glass_spec: string; glazing_system: string; panels: Panel[];
}

export const emptyDraft = (): ProjectDraft => ({
  name: "", client: "", city: "", building_height_m: "", terrain: 3, zone: "typical", glass_spec: "12mm_toughened", glazing_system: "",
  panels: [{ tag: "W1", width_mm: 0, height_mm: 0, quantity: 1 }],
});

const SYSTEMS = ["Butt-joint structural glazing", "Unitized curtain wall", "Semi-unitized curtain wall", "Stick curtain wall", "Structural silicone glazing", "Spider / point-fixed glazing", "Sliding windows", "Casement windows"];

export function CityInput({ value, onChange, id }: { value: string; onChange: (v: string) => void; id?: string }) {
  const { reference } = useApp();
  const vb = reference?.cities.find(([c]) => c.toLowerCase() === value.trim().toLowerCase())?.[1];
  return (
    <>
      <Input id={id} list="vs-cities" value={value} onChange={(e) => onChange(e.target.value)} placeholder="Start typing… e.g. Mumbai" suffix={vb ? `${vb} m/s` : undefined} autoComplete="off" />
      <datalist id="vs-cities">{reference?.cities.map(([c, v]) => <option key={c} value={c}>{`Vb ${v} m/s`}</option>)}</datalist>
    </>
  );
}

export function HeightInput({ value, onChange, id }: { value: number | ""; onChange: (v: number | "") => void; id?: string }) {
  const { reference } = useApp();
  const ff = reference?.floor_to_floor_m ?? 3.3;
  const [mode, setMode] = useState<"m" | "floor">("m");
  const [floor, setFloor] = useState<number | "">("");
  return (
    <div className="flex gap-2">
      <div className="flex-1">
        {mode === "m" ? (
          <Input id={id} type="number" min={1} max={500} step="0.1" value={value} onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))} suffix="m" placeholder="42.9" />
        ) : (
          <Input id={id} type="number" min={0} max={150} value={floor} placeholder="12"
            onChange={(e) => { const f = e.target.value === "" ? "" : Number(e.target.value); setFloor(f); onChange(f === "" ? "" : Math.round((f + 1) * ff * 10) / 10); }}
            suffix={floor !== "" ? `≈${value} m` : "floor"} />
        )}
      </div>
      <Segmented size="sm" value={mode} onChange={setMode} options={[{ value: "m", label: "m" }, { value: "floor", label: "Floor" }]} />
    </div>
  );
}

export function GlassSelect({ value, onChange, id }: { value: string; onChange: (v: string) => void; id?: string }) {
  const { reference } = useApp();
  return (
    <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      <optgroup label="Monolithic toughened">
        {reference?.glass.filter((g) => g.kind === "monolithic").map((g) => <option key={g.key} value={g.key}>{g.label} · ₹{g.rate_per_sqm}/m²</option>)}
      </optgroup>
      <optgroup label="Laminated">
        {reference?.glass.filter((g) => g.kind === "laminated").map((g) => <option key={g.key} value={g.key}>{g.label} · ₹{g.rate_per_sqm}/m²</option>)}
      </optgroup>
      {!reference && <option value={value}>{value}</option>}
    </Select>
  );
}

export function NewProjectModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [d, setD] = useState<ProjectDraft>(emptyDraft);
  const [saving, setSaving] = useState(false);
  const [touched, setTouched] = useState(false);
  const nav = useNavigate();
  const set = <K extends keyof ProjectDraft>(k: K, v: ProjectDraft[K]) => setD((x) => ({ ...x, [k]: v }));

  const errs = {
    name: !d.name.trim() ? "Give the project a name" : null,
    city: !d.city.trim() ? "City sets the IS 875 basic wind speed" : null,
    height: d.building_height_m === "" || d.building_height_m <= 0 ? "Installation height is required" : null,
    panels: d.panels.length === 0 ? "Add at least one panel" : d.panels.map(panelErrors).find(Boolean) ?? null,
  };
  const invalid = Object.values(errs).some(Boolean);

  const submit = async (validate: boolean) => {
    setTouched(true);
    if (invalid) return;
    setSaving(true);
    try {
      const p = await api.post<Project>("/projects", { ...d, client: d.client || null, glazing_system: d.glazing_system || null, building_height_m: Number(d.building_height_m) });
      if (validate) await api.post(`/projects/${p.id}/validate`);
      toast.success("Project created", { description: validate ? "IS 875 validation complete" : undefined });
      setD(emptyDraft());
      setTouched(false);
      onClose();
      nav(`/projects/${p.id}${validate ? "?tab=structural" : ""}`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} size="xl" title="New project" description="Site details drive the IS 875 wind load. You can edit everything later."
      footer={<>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant="secondary" loading={saving} onClick={() => submit(false)}>Save as draft</Button>
        <Button loading={saving} onClick={() => submit(true)}>Create & run IS 875 check</Button>
      </>}>
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Project name" htmlFor="np-name" error={touched ? errs.name : null}><Input id="np-name" value={d.name} onChange={(e) => set("name", e.target.value)} placeholder="Skyline Tower – Block B" invalid={touched && !!errs.name} /></Field>
          <Field label="Client" htmlFor="np-client" hint="Optional – appears on the quote"><Input id="np-client" value={d.client} onChange={(e) => set("client", e.target.value)} placeholder="Acme Developers" /></Field>
          <Field label="City" htmlFor="np-city" error={touched ? errs.city : null}><CityInput id="np-city" value={d.city} onChange={(v) => set("city", v)} /></Field>
          <Field label="Installation height" htmlFor="np-h" error={touched ? errs.height : null} hint="Top of the highest glazing, or pick a floor"><HeightInput id="np-h" value={d.building_height_m} onChange={(v) => set("building_height_m", v)} /></Field>
          <Field label="Glass specification" htmlFor="np-glass" hint="We'll flag it if it fails the wind check"><GlassSelect id="np-glass" value={d.glass_spec} onChange={(v) => set("glass_spec", v)} /></Field>
          <Field label="Glazing system" htmlFor="np-sys">
            <Select id="np-sys" value={d.glazing_system} onChange={(e) => set("glazing_system", e.target.value)}>
              <option value="">Not specified</option>
              {SYSTEMS.map((s) => <option key={s}>{s}</option>)}
            </Select>
          </Field>
          <Field label="Terrain category" htmlFor="np-terrain">
            <Select id="np-terrain" value={d.terrain} onChange={(e) => set("terrain", Number(e.target.value))}>
              <option value={1}>1 – Open sea coast / flat open</option>
              <option value={2}>2 – Open with scattered obstructions</option>
              <option value={3}>3 – Suburban / dense low-rise (default)</option>
              <option value={4}>4 – City centre, tall buildings</option>
            </Select>
          </Field>
          <Field label="Facade zone" htmlFor="np-zone" hint="Corner zones see higher suction">
            <Segmented value={d.zone} onChange={(v) => set("zone", v)} options={[{ value: "typical", label: "Typical" }, { value: "corner", label: "Corner / edge" }]} />
          </Field>
        </div>
        <div>
          <p className="mb-1 text-xs font-medium text-slate-700 dark:text-slate-300">Window / panel schedule</p>
          <PanelEditor panels={d.panels} onChange={(p) => set("panels", p)} />
          {touched && errs.panels && <p className="mt-1.5 text-xs text-rose-600">{errs.panels}</p>}
        </div>
      </div>
    </Modal>
  );
}
