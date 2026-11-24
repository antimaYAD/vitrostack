import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { FolderKanban, LayoutGrid, List, Plus, Search, Sparkles } from "lucide-react";
import type { ProjectSummary } from "../lib/api";
import { inr, num, STATUS_META, timeAgo, useApi } from "../lib/utils";
import { Button, Card, EmptyState, ErrorState, Input, PageHeader, SafetyBadge, Segmented, Skeleton, StatusBadge } from "../components/ui";
import { NewProjectModal } from "../components/ProjectForm";
import { useAuth } from "../lib/auth";

export default function Projects() {
  const { canEdit } = useAuth();
  const { data, error, loading, reload } = useApi<ProjectSummary[]>("/projects");
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<string>("all");
  const [view, setView] = useState<"table" | "grid">(() => (window.innerWidth < 768 ? "grid" : "table"));
  const newOpen = params.get("new") === "1";
  const nav = useNavigate();

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: data?.length ?? 0 };
    data?.forEach((p) => (c[p.status] = (c[p.status] ?? 0) + 1));
    return c;
  }, [data]);

  const rows = useMemo(() => {
    const ql = q.toLowerCase().trim();
    return (data ?? []).filter((p) => (status === "all" || p.status === status) && (!ql || `${p.name} ${p.client ?? ""} ${p.city}`.toLowerCase().includes(ql)));
  }, [data, q, status]);

  return (
    <div>
      <PageHeader title="Projects" subtitle="Every project moves through Schedule → IS 875 check → Cutting plan → Quote."
        actions={canEdit ? <>
          <Link to="/copilot"><Button variant="secondary" icon={<Sparkles className="h-4 w-4" />}>Create with copilot</Button></Link>
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => setParams({ new: "1" })}>New project</Button>
        </> : undefined} />

      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="overflow-x-auto">
          <Segmented value={status} onChange={setStatus} options={[
            { value: "all", label: "All", count: counts.all },
            ...Object.entries(STATUS_META).map(([k, v]) => ({ value: k, label: v.label, count: counts[k] ?? 0 })),
          ]} />
        </div>
        <div className="flex items-center gap-2">
          <div className="relative flex-1 md:w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, client, city" className="pl-9" aria-label="Search projects" />
          </div>
          <Segmented size="sm" value={view} onChange={setView} options={[{ value: "table", label: <List className="h-4 w-4" aria-label="Table view" /> }, { value: "grid", label: <LayoutGrid className="h-4 w-4" aria-label="Card view" /> }]} />
        </div>
      </div>

      {error && <ErrorState message={error} onRetry={() => reload()} />}
      {loading && <div className="space-y-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-16 rounded-xl" />)}</div>}

      {data && rows.length === 0 && (
        <Card>
          {data.length === 0 ? (
            <EmptyState icon={<FolderKanban className="h-6 w-6" />} title="No projects yet" body="Create one from a window schedule, or describe the job to VitroCore."
              action={canEdit ? <Button icon={<Plus className="h-4 w-4" />} onClick={() => setParams({ new: "1" })}>New project</Button> : undefined} />
          ) : (
            <EmptyState icon={<Search className="h-6 w-6" />} title="No matching projects" body="Try a different search or status filter."
              action={<Button variant="secondary" onClick={() => { setQ(""); setStatus("all"); }}>Clear filters</Button>} />
          )}
        </Card>
      )}

      {rows.length > 0 && view === "table" && (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr><th>Project</th><th>Location</th><th>Glass</th><th className="text-right">Panels</th><th>Safety</th><th className="text-right">Scrap</th><th className="text-right">Quote</th><th>Status</th><th className="text-right">Updated</th></tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id} onClick={() => nav(`/projects/${p.id}`)} className="group cursor-pointer transition hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td><Link to={`/projects/${p.id}`} className="block font-medium text-slate-900 group-hover:text-brand-700 dark:text-white dark:group-hover:text-brand-400">{p.name}<span className="block text-xs font-normal text-slate-500">{p.client ?? "—"}</span></Link></td>
                    <td className="whitespace-nowrap">{p.city}<span className="block text-xs text-slate-500">{p.building_height_m} m</span></td>
                    <td className="whitespace-nowrap">{p.glass_label}</td>
                    <td className="text-right tabular-nums">{num(p.panel_count)}<span className="block text-xs text-slate-500">{num(p.panel_area_m2, 1)} m²</span></td>
                    <td><SafetyBadge safe={p.all_safe} /></td>
                    <td className="text-right tabular-nums">{p.scrap_pct === null ? <span className="text-slate-400">—</span> : <span className={p.scrap_pct <= 3 ? "text-emerald-600" : "text-amber-600"}>{p.scrap_pct}%</span>}</td>
                    <td className="text-right font-medium tabular-nums">{p.grand_total ? inr(p.grand_total, { compact: true }) : <span className="text-slate-400">—</span>}</td>
                    <td><StatusBadge status={p.status} /></td>
                    <td className="whitespace-nowrap text-right text-xs text-slate-500">{timeAgo(p.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {rows.length > 0 && view === "grid" && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((p) => (
            <Link key={p.id} to={`/projects/${p.id}`}>
              <Card className="h-full p-5 transition hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-pop dark:hover:border-brand-800">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-slate-900 dark:text-white">{p.name}</p>
                    <p className="truncate text-xs text-slate-500">{p.client ?? "No client"} · {p.city} · {p.building_height_m} m</p>
                  </div>
                  <StatusBadge status={p.status} />
                </div>
                <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
                  <div><p className="text-slate-500">Panels</p><p className="font-semibold tabular-nums">{p.panel_count}</p></div>
                  <div><p className="text-slate-500">Scrap</p><p className="font-semibold tabular-nums">{p.scrap_pct ?? "—"}{p.scrap_pct !== null && "%"}</p></div>
                  <div><p className="text-slate-500">Quote</p><p className="font-semibold tabular-nums">{p.grand_total ? inr(p.grand_total, { compact: true }) : "—"}</p></div>
                </div>
                <div className="mt-4 flex items-center justify-between">
                  <span className="truncate text-xs text-slate-500">{p.glass_label}</span>
                  <SafetyBadge safe={p.all_safe} />
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}

      <NewProjectModal open={newOpen && canEdit} onClose={() => setParams({})} />
    </div>
  );
}
