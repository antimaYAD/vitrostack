import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AlertTriangle, ArrowRight, ArrowUp, Bot, Boxes, CheckCircle2, FolderKanban, IndianRupee, Recycle, Scissors, Siren, Sparkles } from "lucide-react";
import type { ProjectSummary } from "../lib/api";
import { useAuth } from "../lib/auth";
import { cn, inr, num, STATUS_META, timeAgo, useApi } from "../lib/utils";
import { Button, Card, CardHeader, EmptyState, ErrorState, SafetyBadge, Skeleton, Stat, StatusBadge } from "../components/ui";

interface Dash {
  kpis: {
    active_projects: number; pipeline_value: number; quoted_projects: number; avg_scrap_pct: number | null;
    offcuts_available: number; offcut_area_m2: number; offcut_reused_area_m2: number; offcut_savings_inr: number;
    open_alerts: number; panels_in_pipeline: number;
  };
  by_status: Record<string, number>;
  recent_projects: ProjectSummary[];
  attention: { project_id: string | null; name: string; kind: string; message: string; alert_id?: number }[];
  recent_tool_calls: { tool: string; ok: boolean; duration_ms: number; created_at: string }[];
}

const TOOL_LABEL: Record<string, string> = {
  calculate_is875_wind_load: "IS 875 wind check", calculate_structural_silicone: "Silicone sizing", create_project: "Project created",
  optimize_2d_glass_cutting: "Cutting optimized", generate_client_quote_pdf: "Quote PDF", parse_window_schedule: "Schedule parsed",
  list_offcut_inventory: "Inventory lookup", list_projects: "Project lookup", update_project_glass_spec: "Glass spec updated",
  send_whatsapp_site_update: "WhatsApp sent", get_project: "Project lookup",
};

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export default function Overview() {
  const { data, error, loading, reload } = useApi<Dash>("/dashboard");
  const [q, setQ] = useState("");
  const nav = useNavigate();
  const { user } = useAuth();

  const ask = (text: string) => text.trim() && nav(`/copilot?q=${encodeURIComponent(text.trim())}`);

  return (
    <div className="space-y-8">
      {/* Hero */}
      <section className="pb-6 pt-2 text-center sm:pt-6">
        <p className="eyebrow">{greeting()}{user ? `, ${user.name.split(" ")[0]}` : ""}</p>
        <h1 className="mx-auto mt-2 max-w-3xl text-[44px] font-semibold leading-[1.05] tracking-tightest text-[#1d1d1f] sm:text-[64px] dark:text-white">
          Facade engineering.<br />
          <span className="bg-gradient-to-r from-[#0071e3] via-[#5e5ce6] to-[#bf5af2] bg-clip-text text-transparent">In one sentence.</span>
        </h1>
        <p className="mx-auto mt-5 max-w-xl text-[19px] leading-snug text-slate-500 dark:text-slate-400">
          Describe a job. VitroCore checks it against IS 875, optimizes the cut and drafts the quote.
        </p>
        <form onSubmit={(e) => { e.preventDefault(); ask(q); }} className="mx-auto mt-9 flex max-w-2xl items-center gap-2 rounded-full bg-white p-1.5 pl-5 shadow-[0_4px_24px_rgba(0,0,0,.08)] ring-1 ring-black/5 transition focus-within:shadow-[0_6px_30px_rgba(0,113,227,.18)] focus-within:ring-brand-600/40 dark:bg-slate-900 dark:ring-white/10">
          <Sparkles className="h-5 w-5 shrink-0 text-brand-600 dark:text-brand-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Quote 45 windows 2400×1500 mm, 12th floor, Mumbai" aria-label="Ask VitroCore"
            className="h-11 min-w-0 flex-1 bg-transparent text-[17px] text-[#1d1d1f] outline-none placeholder:text-slate-400 dark:text-white" />
          <Button type="submit" size="icon" className="h-11 w-11" disabled={!q.trim()} aria-label="Ask"><ArrowUp className="h-5 w-5" /></Button>
        </form>
        <div className="mt-4 flex flex-wrap justify-center gap-x-5 gap-y-2 text-[15px]">
          {["Is 8mm toughened safe at 40 m in Chennai for 2000x1800?", "Show offcut inventory"].map((s) => (
            <button key={s} onClick={() => ask(s)} className="link inline-flex items-center gap-1">{s} <ArrowRight className="h-3.5 w-3.5" /></button>
          ))}
        </div>
      </section>

      {error && <ErrorState message={error} onRetry={() => reload()} />}

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {loading || !data ? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[118px] rounded-xl" />) : (
          <>
            <Stat label="Quoted pipeline" value={inr(data.kpis.pipeline_value, { compact: true })} sub={`${data.kpis.quoted_projects} of ${data.kpis.active_projects} projects quoted`} icon={<IndianRupee className="h-4 w-4" />} />
            <Stat label="Avg. net scrap" value={data.kpis.avg_scrap_pct === null ? "—" : `${data.kpis.avg_scrap_pct}%`}
              sub={data.kpis.avg_scrap_pct === null ? "No cutting plans yet" : data.kpis.avg_scrap_pct <= 3 ? "Within 3% target" : "Above 3% target"}
              tone={data.kpis.avg_scrap_pct === null ? "neutral" : data.kpis.avg_scrap_pct <= 3 ? "good" : "bad"} icon={<Scissors className="h-4 w-4" />} />
            <Stat label="Offcut stock" value={`${num(data.kpis.offcut_area_m2, 1)} m²`} sub={`${data.kpis.offcuts_available} pieces · ${inr(data.kpis.offcut_savings_inr, { compact: true })} saved by reuse`} icon={<Recycle className="h-4 w-4" />} />
            <Stat label="Open site alerts" value={data.kpis.open_alerts} sub={data.kpis.open_alerts ? "Waiting for your approval" : "All clear"} tone={data.kpis.open_alerts ? "bad" : "good"} icon={<Siren className="h-4 w-4" />} />
          </>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Pipeline + recent projects */}
        <Card className="lg:col-span-2">
          <CardHeader title="Project pipeline" subtitle={data ? `${num(data.kpis.panels_in_pipeline)} panels across ${data.kpis.active_projects} projects` : undefined}
            icon={<FolderKanban className="h-4 w-4" />}
            action={<Link to="/projects" className="text-xs font-medium text-brand-700 hover:underline dark:text-brand-400">View all</Link>} />
          {data && data.kpis.active_projects > 0 && (
            <div className="px-5 pt-4">
              <div className="flex h-2.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                {Object.entries(data.by_status).map(([s, n]) => n > 0 && (
                  <div key={s} title={`${STATUS_META[s].label}: ${n}`} style={{ width: `${(n / data.kpis.active_projects) * 100}%` }}
                    className={cn("h-full", s === "draft" && "bg-slate-300 dark:bg-slate-600", s === "validated" && "bg-sky-400", s === "optimized" && "bg-violet-500", s === "quoted" && "bg-emerald-500")} />
                ))}
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                {Object.entries(data.by_status).map(([s, n]) => (
                  <span key={s} className="inline-flex items-center gap-1.5">
                    <span className={cn("h-2 w-2 rounded-full", s === "draft" && "bg-slate-300", s === "validated" && "bg-sky-400", s === "optimized" && "bg-violet-500", s === "quoted" && "bg-emerald-500")} />
                    {STATUS_META[s].label} <span className="font-semibold text-slate-700 dark:text-slate-300">{n}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
          <div className="mt-2">
            {loading && <div className="space-y-3 p-5">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12" />)}</div>}
            {data && data.recent_projects.length === 0 && (
              <EmptyState icon={<FolderKanban className="h-6 w-6" />} title="No projects yet" body="Ask VitroCore to quote a job, or create a project manually."
                action={<Link to="/projects?new=1"><Button>New project</Button></Link>} />
            )}
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {data?.recent_projects.map((p) => (
                <li key={p.id}>
                  <Link to={`/projects/${p.id}`} className="flex items-center gap-4 px-5 py-3.5 transition hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-900 dark:text-white">{p.name}</p>
                      <p className="truncate text-xs text-slate-500">{p.client ?? "No client"} · {p.city} · {p.panel_count} panels · {p.glass_label}</p>
                    </div>
                    <div className="hidden sm:block"><SafetyBadge safe={p.all_safe} /></div>
                    <div className="hidden w-24 text-right text-sm font-medium tabular-nums md:block">{p.grand_total ? inr(p.grand_total, { compact: true }) : <span className="text-slate-400">—</span>}</div>
                    <StatusBadge status={p.status} />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </Card>

        <div className="space-y-6">
          {/* attention */}
          <Card>
            <CardHeader title="Needs attention" icon={<AlertTriangle className="h-4 w-4" />} />
            <div className="p-2">
              {loading && <Skeleton className="m-3 h-16" />}
              {data && data.attention.length === 0 && (
                <div className="flex items-center gap-3 p-3 text-sm text-slate-500"><CheckCircle2 className="h-5 w-5 text-emerald-500" /> Nothing blocked. Nice work.</div>
              )}
              {data?.attention.map((a, i) => (
                <Link key={i} to={a.kind === "unsafe" ? `/projects/${a.project_id}?tab=structural` : "/site"} className="flex gap-3 rounded-lg p-3 transition hover:bg-slate-50 dark:hover:bg-slate-800/40">
                  <span className={cn("mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg", a.kind === "unsafe" ? "bg-rose-50 text-rose-600 dark:bg-rose-950" : "bg-amber-50 text-amber-600 dark:bg-amber-950")}>
                    {a.kind === "unsafe" ? <AlertTriangle className="h-4 w-4" /> : <Siren className="h-4 w-4" />}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-900 dark:text-white">{a.name}</p>
                    <p className="line-clamp-2 text-xs text-slate-500">{a.message}</p>
                  </div>
                  <ArrowRight className="ml-auto mt-1 h-4 w-4 shrink-0 text-slate-300" />
                </Link>
              ))}
            </div>
          </Card>

          {/* agent activity */}
          <Card>
            <CardHeader title="Agent activity" subtitle="Every number comes from a logged tool call" icon={<Bot className="h-4 w-4" />} />
            <ul className="p-2">
              {data && data.recent_tool_calls.length === 0 && <li className="p-3 text-sm text-slate-500">No tool calls yet. Try the copilot.</li>}
              {data?.recent_tool_calls.map((t, i) => (
                <li key={i} className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm">
                  <span className={cn("h-1.5 w-1.5 rounded-full", t.ok ? "bg-emerald-500" : "bg-rose-500")} />
                  <span className="flex-1 truncate text-slate-700 dark:text-slate-300">{TOOL_LABEL[t.tool] ?? t.tool}</span>
                  <span className="text-xs text-slate-400">{timeAgo(t.created_at)}</span>
                </li>
              ))}
            </ul>
          </Card>

          <Link to="/inventory" className="block">
            <Card className="flex items-center gap-3 p-4 transition hover:border-brand-300 dark:hover:border-brand-800">
              <Boxes className="h-5 w-5 text-brand-700 dark:text-brand-400" />
              <div className="flex-1 text-sm"><p className="font-medium">Offcut inventory</p><p className="text-xs text-slate-500">Reused before any new jumbo sheet is opened</p></div>
              <ArrowRight className="h-4 w-4 text-slate-400" />
            </Card>
          </Link>
        </div>
      </div>
    </div>
  );
}
