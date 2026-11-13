import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import { toast } from "sonner";
import {
  AlertTriangle, ArrowUp, Bot, Check, CheckCircle2, ChevronDown, ChevronRight, Download, FileSpreadsheet, FolderOpen,
  Loader2, MessageSquarePlus, Paperclip, PanelLeftClose, PanelLeftOpen, ShieldCheck, Sparkles, Trash2, Upload, Wind, X, XCircle,
} from "lucide-react";
import { api, type ChatMessage, type PendingAction, type Quote, type ToolStep } from "../lib/api";
import { cn, inr, pct, specLabel, timeAgo, useDebounced } from "../lib/utils";
import { Badge, Button, Spinner } from "../components/ui";
import { useApp } from "../components/Layout";

interface SessionRow { id: string; title: string; project_id: string | null; updated_at: string }
interface UploadInfo { file_id: string; filename: string; preview: { rows?: unknown[]; needs_review_count?: number; error?: string } }

const EXAMPLES = [
  { icon: <Sparkles className="h-4 w-4" />, title: "Full quote from a message", text: "Quote 45 butt-joint windows of 2400x1500mm for a 12th-floor project in Mumbai with 6mm toughened" },
  { icon: <Wind className="h-4 w-4" />, title: "Safety check", text: "Is 10mm toughened safe for 1800x2100 at 60 m in Chennai?" },
  { icon: <ShieldCheck className="h-4 w-4" />, title: "Silicone sizing", text: "Size structural silicone for 30 panels 1500x2700mm, 8th floor, Bengaluru" },
  { icon: <FolderOpen className="h-4 w-4" />, title: "Pipeline status", text: "Show my projects" },
];

const THINKING = ["Reading your request…", "Running IS 875 wind-load engine…", "Checking glass stress & deflection…", "Sizing structural silicone…", "Optimizing jumbo-sheet cutting…", "Preparing the BOM…"];

// ---------------------------------------------------------------- tool step rendering

function stepSummary(s: ToolStep): { text: string; tone: "good" | "bad" | "neutral" } {
  if (!s.ok) return { text: s.result?.error ?? "Failed", tone: "bad" };
  const r = s.result;
  switch (s.tool) {
    case "calculate_is875_wind_load":
      return { text: `${r.window_width_mm}×${r.window_height_mm} · ${specLabel(r.glass_spec)} · ${r.design_pressure_kpa} kPa · ${pct(r.check.utilisation)} util`, tone: r.safe ? "good" : "bad" };
    case "calculate_structural_silicone":
      return { text: `${r.bite_mm} mm bite × ${r.glueline_thickness_mm} mm · ${r.structural_sausages_600ml} sausages`, tone: "neutral" };
    case "create_project":
      return { text: `${r.project.name} · ${r.project.panel_count} panels · ${r.wind.all_safe ? "validated" : "fails IS 875"}`, tone: r.wind.all_safe ? "good" : "bad" };
    case "update_project_glass_spec":
      return { text: `${specLabel(r.project.glass_spec)} · ${pct(r.wind.max_utilisation)} util`, tone: r.wind.all_safe ? "good" : "bad" };
    case "optimize_2d_glass_cutting":
      return { text: `${r.jumbo_sheets} jumbo sheets${r.offcuts_used ? ` + ${r.offcuts_used} offcuts` : ""} · ${r.scrap_pct}% net scrap`, tone: r.scrap_pct <= 3 ? "good" : "neutral" };
    case "generate_client_quote_pdf":
      return { text: `${inr(r.grand_total)} incl. GST · ${r.margin_percent}% margin`, tone: "good" };
    case "parse_window_schedule":
      return { text: `${r.rows.length} rows${r.needs_review_count ? ` · ${r.needs_review_count} need review` : ""}`, tone: r.needs_review_count ? "neutral" : "good" };
    case "list_offcut_inventory":
      return { text: `${r.count} offcuts · ${r.area_m2} m²`, tone: "neutral" };
    case "list_projects":
      return { text: `${r.projects.length} projects`, tone: "neutral" };
    case "send_whatsapp_site_update":
      return { text: `${r.delivered} → ${r.recipient_phone}`, tone: "good" };
    default:
      return { text: "Done", tone: "neutral" };
  }
}

function StepDetail({ s }: { s: ToolStep }) {
  const r = s.result;
  if (!s.ok) return <p className="text-rose-600">{r.error}</p>;
  if (s.tool === "calculate_is875_wind_load") {
    return (
      <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 sm:grid-cols-4">
        {[
          ["Vb", `${r.factors.Vb} m/s`], ["k2", r.factors.k2], ["Vz", `${r.Vz_mps} m/s`], ["Cp,net", r.factors.Cp_net],
          ["Stress", `${r.check.max_stress_mpa} / ${r.check.allowable_stress_mpa} MPa`], ["Deflection", `${r.check.max_deflection_mm} / ${r.check.allowable_deflection_mm} mm`],
          ["Governs", r.check.governing], ["Result", r.safe ? "PASS" : `FAIL → ${specLabel(r.recommended_glass_spec)}`],
        ].map(([k, v]) => (
          <div key={k as string}><span className="text-slate-400">{k}</span> <span className="font-medium text-slate-700 dark:text-slate-300">{v as string}</span></div>
        ))}
      </div>
    );
  }
  return (
    <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] text-slate-500 scrollbar-thin">
      {JSON.stringify(s.args, null, 1)}
    </pre>
  );
}

function ToolTimeline({ steps }: { steps: ToolStep[] }) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);
  const failed = steps.some((s) => !s.ok);
  const total = steps.reduce((a, s) => a + s.duration_ms, 0);
  return (
    <div className="mt-3 overflow-hidden rounded-xl border border-slate-200 bg-slate-50/60 dark:border-slate-800 dark:bg-slate-900/60">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left text-xs font-medium text-slate-600 hover:bg-slate-100/60 dark:text-slate-400 dark:hover:bg-slate-800/60" aria-expanded={open}>
        {failed ? <AlertTriangle className="h-4 w-4 text-amber-500" /> : <CheckCircle2 className="h-4 w-4 text-emerald-500" />}
        <span className="flex-1">Ran {steps.length} deterministic engineering tool{steps.length > 1 ? "s" : ""} · {total} ms</span>
        <span className="hidden text-slate-400 sm:inline">Zero LLM math</span>
        <ChevronDown className={cn("h-4 w-4 text-slate-400 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <ol className="border-t border-slate-200 px-3.5 py-2 dark:border-slate-800">
          {steps.map((s, i) => {
            const sum = stepSummary(s);
            return (
              <li key={i} className="relative py-1.5 pl-6">
                {i < steps.length - 1 && <span className="absolute left-[7px] top-6 h-[calc(100%-12px)] w-px bg-slate-200 dark:bg-slate-700" />}
                <span className={cn("absolute left-0 top-2.5 h-[15px] w-[15px] rounded-full ring-4 ring-slate-50 dark:ring-slate-900", sum.tone === "bad" ? "bg-rose-500" : sum.tone === "good" ? "bg-emerald-500" : "bg-slate-400")} />
                <button onClick={() => setExpanded(expanded === i ? null : i)} className="flex w-full items-center gap-2 text-left text-xs">
                  <span className="font-medium text-slate-800 dark:text-slate-200">{s.title}</span>
                  <code className="hidden rounded bg-slate-200/60 px-1 font-mono text-[10px] text-slate-500 md:inline dark:bg-slate-800">{s.tool}</code>
                  <span className="ml-auto text-slate-400">{s.duration_ms} ms</span>
                  <ChevronRight className={cn("h-3.5 w-3.5 text-slate-400 transition-transform", expanded === i && "rotate-90")} />
                </button>
                <p className={cn("mt-0.5 text-xs", sum.tone === "bad" ? "text-rose-600" : "text-slate-500 dark:text-slate-400")}>{sum.text}</p>
                {expanded === i && <div className="mt-2 rounded-lg bg-white p-2.5 text-xs ring-1 ring-slate-200 dark:bg-slate-950 dark:ring-slate-800"><StepDetail s={s} /></div>}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- approval card (human in the loop)

function ApprovalCard({ action, onResolve, busy }: { action: PendingAction; onResolve: (approve: boolean, overrides?: Record<string, unknown>) => void; busy: boolean }) {
  const isQuote = action.tool === "generate_client_quote_pdf";
  const [margin, setMargin] = useState<number>(Number(action.args.margin_percent ?? 18));
  const dm = useDebounced(margin, 200);
  const [preview, setPreview] = useState<Quote | null>(null);
  const [loading, setLoading] = useState(false);
  const resolved = action.status;

  useEffect(() => setMargin(Number(action.args.margin_percent ?? 18)), [action.args.margin_percent]);
  useEffect(() => {
    if (!isQuote || resolved || !action.args.project_id) return;
    setLoading(true);
    api.get<{ quote: Quote }>(`/projects/${action.args.project_id}/quote-preview?margin_percent=${dm}`)
      .then((r) => setPreview(r.quote)).catch(() => setPreview(null)).finally(() => setLoading(false));
  }, [dm, isQuote, resolved, action.args.project_id]);

  if (resolved) {
    return (
      <div className={cn("mt-3 flex items-center gap-2 rounded-xl border px-4 py-3 text-sm",
        resolved === "approved" ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300" : "border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-800 dark:bg-slate-900")}>
        {resolved === "approved" ? <Check className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
        {action.title} – {resolved === "approved" ? "approved" : resolved === "superseded" ? "replaced by a newer version" : "cancelled"}
      </div>
    );
  }
  return (
    <div className="mt-3 overflow-hidden rounded-xl border-2 border-brand-200 bg-white shadow-card animate-fade-in dark:border-brand-900 dark:bg-slate-900">
      <div className="flex items-center gap-2 bg-brand-50 px-4 py-2.5 dark:bg-brand-950/50">
        <ShieldCheck className="h-4 w-4 text-brand-700 dark:text-brand-400" />
        <p className="text-sm font-semibold text-brand-900 dark:text-brand-200">Approval needed · {action.title}</p>
      </div>
      <div className="space-y-4 p-4">
        <p className="text-sm text-slate-600 dark:text-slate-400">{action.description}</p>
        {isQuote && (
          <>
            <div>
              <div className="flex items-center justify-between text-xs">
                <label htmlFor={`m-${action.id}`} className="font-medium text-slate-700 dark:text-slate-300">Margin on selling price</label>
                <span className="rounded-md bg-slate-100 px-2 py-0.5 font-semibold tabular-nums text-slate-900 dark:bg-slate-800 dark:text-white">{margin}%</span>
              </div>
              <input id={`m-${action.id}`} type="range" min={5} max={40} step={0.5} value={margin} onChange={(e) => setMargin(Number(e.target.value))} className="mt-2 w-full accent-brand-700" />
              <div className="flex justify-between text-[10px] text-slate-400"><span>5%</span><span>Typical 15–22%</span><span>40%</span></div>
            </div>
            <div className={cn("grid grid-cols-3 gap-3 rounded-lg bg-slate-50 p-3 transition-opacity dark:bg-slate-800/50", loading && "opacity-60")}>
              <div><p className="text-[11px] text-slate-500">Direct cost</p><p className="text-sm font-semibold tabular-nums">{inr(preview?.direct_cost, { compact: true })}</p></div>
              <div><p className="text-[11px] text-slate-500">Profit</p><p className="text-sm font-semibold tabular-nums text-emerald-600">{inr(preview?.profit, { compact: true })}</p></div>
              <div><p className="text-[11px] text-slate-500">Grand total (GST)</p><p className="text-sm font-semibold tabular-nums">{inr(preview?.grand_total, { compact: true })}</p></div>
            </div>
          </>
        )}
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => onResolve(true, isQuote ? { margin_percent: margin } : undefined)} loading={busy} icon={<Check className="h-4 w-4" />}>
            {isQuote ? "Approve & generate PDF" : "Approve & send"}
          </Button>
          <Button variant="secondary" onClick={() => onResolve(false)} disabled={busy}>Cancel</Button>
          {action.args.project_id && <Link to={`/projects/${action.args.project_id}?tab=quote`} className="ml-auto self-center text-xs font-medium text-brand-700 hover:underline dark:text-brand-400">Review BOM first →</Link>}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- message

function Message({ m, isLast, onSuggest, onResolve, resolving }: {
  m: ChatMessage; isLast: boolean; onSuggest: (s: string) => void; onResolve: (a: PendingAction, approve: boolean, o?: Record<string, unknown>) => void; resolving: string | null;
}) {
  if (m.role === "user") {
    return (
      <div className="flex justify-end animate-fade-in">
        <div className="max-w-[85%] space-y-2">
          {m.attachments?.map((a) => (
            <div key={a} className="ml-auto flex w-fit items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-900">
              <FileSpreadsheet className="h-4 w-4 text-emerald-600" /> {a}
            </div>
          ))}
          {m.content && <div className="rounded-[20px] rounded-br-[6px] bg-brand-600 px-4 py-2.5 text-[15px] text-white whitespace-pre-wrap">{m.content}</div>}
        </div>
      </div>
    );
  }
  const quoteStep = m.steps?.find((s) => s.tool === "generate_client_quote_pdf" && s.ok);
  return (
    <div className="flex gap-3 animate-fade-in">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-brand-500 to-brand-800 text-white shadow-sm"><Bot className="h-4 w-4" /></div>
      <div className="min-w-0 flex-1 pt-0.5">
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <span className="font-semibold text-slate-700 dark:text-slate-300">VitroCore</span>
          <span>{timeAgo(m.created_at)}</span>
        </div>
        {m.engine_note && <p className="mt-1 text-xs text-amber-600">{m.engine_note}</p>}
        <div className="prose-chat mt-1"><ReactMarkdown>{m.content}</ReactMarkdown></div>
        {m.steps && m.steps.length > 0 && <ToolTimeline steps={m.steps} />}
        {m.pending_action && <ApprovalCard action={m.pending_action} busy={resolving === m.pending_action.id} onResolve={(a, o) => onResolve(m.pending_action!, a, o)} />}
        {(quoteStep || (m.project_id && m.steps?.some((s) => s.tool === "optimize_2d_glass_cutting" && s.ok))) && (
          <div className="mt-3 flex flex-wrap gap-2">
            {quoteStep && (
              <a href={`/api/v1/projects/${quoteStep.result.project_id}/quote.pdf`} target="_blank" rel="noreferrer">
                <Button size="sm" icon={<Download className="h-3.5 w-3.5" />}>Download quote PDF</Button>
              </a>
            )}
            {m.project_id && (
              <Link to={`/projects/${m.project_id}?tab=${quoteStep ? "quote" : "cutting"}`}>
                <Button size="sm" variant="secondary" icon={<FolderOpen className="h-3.5 w-3.5" />}>{quoteStep ? "Open project" : "View cutting layouts"}</Button>
              </Link>
            )}
          </div>
        )}
        {isLast && m.suggestions && m.suggestions.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {m.suggestions.map((s) => (
              <button key={s} onClick={() => onSuggest(s)} className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 transition hover:border-brand-300 hover:bg-brand-50 hover:text-brand-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-brand-800 dark:hover:bg-brand-950/50">
                {s}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Thinking() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((x) => Math.min(x + 1, THINKING.length - 1)), 700);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="flex gap-3 animate-fade-in" aria-live="polite">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-brand-500 to-brand-800 text-white"><Bot className="h-4 w-4" /></div>
      <div className="flex items-center gap-2 pt-1.5 text-sm text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin text-brand-600" /> {THINKING[i]}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- page

export default function Copilot() {
  const { sessionId } = useParams();
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const { health, refreshAlerts } = useApp();
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loadingSession, setLoadingSession] = useState(false);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [resolving, setResolving] = useState<string | null>(null);
  const [upload, setUpload] = useState<UploadInfo | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [showHistory, setShowHistory] = useState(() => window.innerWidth >= 1280);
  const scroller = useRef<HTMLDivElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const autoSent = useRef(false);
  const justCreated = useRef<string | null>(null);

  const loadSessions = useCallback(() => api.get<SessionRow[]>("/agent/sessions").then(setSessions).catch(() => {}), []);
  useEffect(() => { loadSessions(); }, [loadSessions]);

  useEffect(() => {
    if (!sessionId) { setMessages([]); return; }
    if (justCreated.current === sessionId) return; // messages already in state
    setLoadingSession(true);
    api.get<{ messages: ChatMessage[] }>(`/agent/sessions/${sessionId}`)
      .then((r) => setMessages(r.messages))
      .catch((e) => { toast.error(e.message); nav("/copilot", { replace: true }); })
      .finally(() => setLoadingSession(false));
  }, [sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, sending]);

  useEffect(() => {
    const el = textarea.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
  }, [input]);

  const send = useCallback(async (text: string, att?: UploadInfo | null) => {
    const message = text.trim();
    if ((!message && !att) || sending) return;
    const optimistic: ChatMessage = { id: -Date.now(), role: "user", content: message, attachments: att ? [att.filename] : undefined, created_at: new Date().toISOString() };
    setMessages((m) => [...m, optimistic]);
    setInput("");
    setUpload(null);
    setSending(true);
    try {
      const r = await api.post<{ session_id: string; message: ChatMessage }>("/agent/chat", { message, session_id: sessionId, attachments: att ? [att.file_id] : [] });
      setMessages((m) => [...m, r.message]);
      if (r.session_id !== sessionId) {
        justCreated.current = r.session_id;
        nav(`/copilot/${r.session_id}`, { replace: true });
      }
      loadSessions();
    } catch (e) {
      setMessages((m) => m.filter((x) => x.id !== optimistic.id));
      setInput(message);
      toast.error((e as Error).message);
    } finally {
      setSending(false);
      textarea.current?.focus();
    }
  }, [sending, sessionId, nav, loadSessions]);

  // ?q= from the command palette or dashboard
  useEffect(() => {
    const q = params.get("q");
    if (q && !autoSent.current) {
      autoSent.current = true;
      setParams({}, { replace: true });
      send(q);
    }
  }, [params, setParams, send]);

  const resolve = async (a: PendingAction, approve: boolean, overrides?: Record<string, unknown>) => {
    if (!sessionId) return;
    setResolving(a.id);
    try {
      const r = await api.post<{ message: ChatMessage }>(`/agent/sessions/${sessionId}/actions/${a.id}`, { approve, overrides });
      setMessages((ms) => [...ms.map((m) => m.pending_action?.id === a.id ? { ...m, pending_action: { ...a, status: approve ? "approved" as const : "cancelled" as const } } : m), r.message]);
      if (approve) toast.success(a.tool === "generate_client_quote_pdf" ? "Quotation PDF generated" : "Action completed");
      refreshAlerts();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setResolving(null);
    }
  };

  const handleFile = async (file: File) => {
    if (!/\.(csv|xlsx|xlsm|txt)$/i.test(file.name)) {
      toast.error("Upload a CSV or Excel (.xlsx) window schedule");
      return;
    }
    setUploading(true);
    try {
      const r = await api.upload<UploadInfo>("/uploads", file);
      if (r.preview.error) toast.warning(r.preview.error);
      setUpload(r);
      textarea.current?.focus();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const deleteSession = async (id: string) => {
    await api.del(`/agent/sessions/${id}`).catch(() => {});
    setSessions((s) => s.filter((x) => x.id !== id));
    if (id === sessionId) nav("/copilot");
    toast.success("Conversation deleted");
  };

  const empty = !sessionId && messages.length === 0;
  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");

  return (
    <div className="flex h-[calc(100dvh-3rem)]">
      {/* history */}
      {showHistory && (
        <aside className="hidden w-64 shrink-0 flex-col border-r border-slate-200 bg-white md:flex dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between p-3">
            <Button size="sm" className="flex-1" icon={<MessageSquarePlus className="h-4 w-4" />} onClick={() => { setMessages([]); nav("/copilot"); }}>New conversation</Button>
            <button onClick={() => setShowHistory(false)} className="ml-2 rounded-md p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Hide history"><PanelLeftClose className="h-4 w-4" /></button>
          </div>
          <div className="flex-1 overflow-y-auto px-2 pb-3 scrollbar-thin">
            <p className="px-2 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-slate-400">Recent</p>
            {sessions.length === 0 && <p className="px-2 py-3 text-xs text-slate-400">Your conversations will appear here.</p>}
            {sessions.map((s) => (
              <div key={s.id} className={cn("group flex items-center rounded-lg", s.id === sessionId ? "bg-brand-50 dark:bg-brand-950/50" : "hover:bg-slate-100 dark:hover:bg-slate-800/60")}>
                <Link to={`/copilot/${s.id}`} className="min-w-0 flex-1 px-2.5 py-2">
                  <p className={cn("truncate text-sm", s.id === sessionId ? "font-medium text-brand-900 dark:text-brand-200" : "text-slate-700 dark:text-slate-300")}>{s.title}</p>
                  <p className="text-[11px] text-slate-400">{timeAgo(s.updated_at)}</p>
                </Link>
                <button onClick={() => deleteSession(s.id)} className="mr-1 rounded p-1 text-slate-400 opacity-0 hover:text-rose-600 group-hover:opacity-100 focus:opacity-100" aria-label="Delete conversation"><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            ))}
          </div>
        </aside>
      )}

      {/* chat */}
      <section
        className="relative flex min-w-0 flex-1 flex-col"
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={(e) => { if (e.currentTarget === e.target) setDragging(false); }}
        onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files?.[0]; if (f) handleFile(f); }}
      >
        <div className="flex h-14 shrink-0 items-center gap-2 border-b border-slate-200 bg-white/80 px-4 backdrop-blur dark:border-slate-800 dark:bg-slate-900/80">
          {!showHistory && (
            <button onClick={() => setShowHistory(true)} className="hidden rounded-md p-1.5 text-slate-400 hover:bg-slate-100 md:block dark:hover:bg-slate-800" aria-label="Show history"><PanelLeftOpen className="h-4 w-4" /></button>
          )}
          <Sparkles className="h-4 w-4 text-brand-600" />
          <h1 className="truncate text-sm font-semibold">{sessions.find((s) => s.id === sessionId)?.title ?? "VitroCore Copilot"}</h1>
          <div className="ml-auto flex items-center gap-2">
            {health && <Badge tone="brand" className="hidden sm:inline-flex">{health.agent_engine.startsWith("gemini") ? health.agent_engine : "Offline planner"}</Badge>}
            <button onClick={() => { setMessages([]); nav("/copilot"); }} className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 md:hidden dark:hover:bg-slate-800" aria-label="New conversation"><MessageSquarePlus className="h-4 w-4" /></button>
          </div>
        </div>

        <div ref={scroller} className="flex-1 overflow-y-auto scrollbar-thin">
          {empty ? (
            <div className="mx-auto flex max-w-3xl flex-col items-center px-4 pb-8 pt-10 sm:pt-16">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 to-brand-800 text-white shadow-pop"><Bot className="h-7 w-7" /></div>
              <h2 className="mt-5 text-center text-2xl font-semibold tracking-tight">What are we glazing today?</h2>
              <p className="mt-2 max-w-lg text-center text-sm text-slate-500 dark:text-slate-400">
                Describe a job in plain language or drop a window schedule. I'll run IS 875 checks, size silicone, optimize cutting and draft the quote. All numbers come from deterministic engines.
              </p>
              <div className="mt-8 grid w-full gap-3 sm:grid-cols-2">
                {EXAMPLES.map((e) => (
                  <button key={e.title} onClick={() => send(e.text)} className="group rounded-xl border border-slate-200 bg-white p-4 text-left shadow-card transition hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-pop dark:border-slate-800 dark:bg-slate-900 dark:hover:border-brand-800">
                    <div className="flex items-center gap-2 text-xs font-semibold text-brand-700 dark:text-brand-400">{e.icon}{e.title}</div>
                    <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-400">{e.text}</p>
                  </button>
                ))}
              </div>
              <button onClick={() => fileInput.current?.click()} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-200 p-4 text-sm text-slate-500 transition hover:border-brand-300 hover:text-brand-700 dark:border-slate-800">
                <Upload className="h-4 w-4" /> Drop or choose a CSV / Excel window schedule
              </button>
            </div>
          ) : (
            <div className="mx-auto max-w-3xl space-y-6 px-4 py-6">
              {loadingSession && <div className="flex justify-center py-10"><Spinner className="h-6 w-6" /></div>}
              {messages.map((m) => (
                <Message key={m.id} m={m} isLast={m === lastAssistant && !sending} onSuggest={(s) => send(s)} onResolve={resolve} resolving={resolving} />
              ))}
              {sending && <Thinking />}
            </div>
          )}
        </div>

        {/* composer */}
        <div className="shrink-0 border-t border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
          <div className="mx-auto max-w-3xl">
            {(upload || uploading) && (
              <div className="mb-2 flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-800/60">
                {uploading ? <Spinner /> : <FileSpreadsheet className="h-4 w-4 text-emerald-600" />}
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{uploading ? "Uploading…" : upload?.filename}</p>
                  {upload && !upload.preview.error && <p className="text-slate-500">{upload.preview.rows?.length ?? 0} rows detected{upload.preview.needs_review_count ? ` · ${upload.preview.needs_review_count} need review` : ""}. Add city & height, then send.</p>}
                  {upload?.preview.error && <p className="text-amber-600">{upload.preview.error}</p>}
                </div>
                {upload && <button onClick={() => setUpload(null)} className="rounded p-1 text-slate-400 hover:text-slate-700" aria-label="Remove attachment"><X className="h-4 w-4" /></button>}
              </div>
            )}
            <form onSubmit={(e) => { e.preventDefault(); send(input, upload); }} className="flex items-end gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm focus-within:border-brand-400 focus-within:ring-4 focus-within:ring-brand-100 dark:border-slate-700 dark:bg-slate-950 dark:focus-within:ring-brand-950">
              <button type="button" onClick={() => fileInput.current?.click()} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800" aria-label="Attach window schedule" title="Attach CSV / Excel schedule">
                <Paperclip className="h-5 w-5" />
              </button>
              <textarea
                ref={textarea}
                rows={1}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input, upload); } }}
                placeholder={upload ? "e.g. Mumbai, 12th floor, 12mm toughened, 20% margin" : "Describe the job: city, height/floor, window sizes & quantities…"}
                className="max-h-[200px] flex-1 resize-none bg-transparent py-2 text-sm text-slate-900 outline-none placeholder:text-slate-400 dark:text-white"
                aria-label="Message VitroCore"
              />
              <Button type="submit" size="icon" disabled={(!input.trim() && !upload) || sending} aria-label="Send" className="rounded-xl">
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
              </Button>
            </form>
            <p className="mt-1.5 text-center text-[11px] text-slate-400">Enter to send · Shift+Enter for new line · Quotes & WhatsApp messages always need your approval</p>
            <input ref={fileInput} type="file" accept=".csv,.xlsx,.xlsm,.txt" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }} />
          </div>
        </div>

        {dragging && (
          <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-brand-50/90 backdrop-blur-sm dark:bg-brand-950/80">
            <div className="rounded-2xl border-2 border-dashed border-brand-400 px-10 py-8 text-center">
              <Upload className="mx-auto h-8 w-8 text-brand-600" />
              <p className="mt-2 font-semibold text-brand-900 dark:text-brand-200">Drop the window schedule</p>
              <p className="text-sm text-brand-700 dark:text-brand-400">CSV or Excel · units auto-normalised to mm</p>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
