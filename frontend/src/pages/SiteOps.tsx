import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { CheckCheck, CheckCircle2, HardHat, Inbox, Send, ShieldAlert, Siren, X } from "lucide-react";
import { api, type Alert, type SiteEvent } from "../lib/api";
import { cn, timeAgo, useApi } from "../lib/utils";
import { Badge, Button, Card, CardHeader, EmptyState, PageHeader, Segmented, Skeleton } from "../components/ui";
import { useApp } from "../components/Layout";

const PHONE = "+919800000001";
const QUICK = ["BROKEN W1-03", "DONE W1-01 to W1-10", "STATUS", "hi"];

function Phone({ onActivity }: { onActivity: () => void }) {
  const { data, setData, reload } = useApi<SiteEvent[]>(`/whatsapp/events?phone=${encodeURIComponent(PHONE)}`);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" }); }, [data?.length, sending]);
  useEffect(() => { const t = setInterval(() => reload(true), 8000); return () => clearInterval(t); }, [reload]);

  const send = async (msg: string) => {
    if (!msg.trim() || sending) return;
    setText("");
    setSending(true);
    setData((d) => [...(d ?? []), { id: -Date.now(), phone: PHONE, direction: "in", text: msg, project_id: null, created_at: new Date().toISOString() }]);
    try {
      await api.post("/whatsapp/simulate", { phone: PHONE, text: msg });
      await reload(true);
      onActivity();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-[360px] rounded-[2.5rem] border-[10px] border-slate-900 bg-slate-900 shadow-pop dark:border-slate-700">
      <div className="overflow-hidden rounded-[1.8rem] bg-[#efeae2] dark:bg-[#0b141a]">
        <div className="flex items-center gap-3 bg-[#075e54] px-4 py-3 text-white dark:bg-[#202c33]">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white/20"><HardHat className="h-5 w-5" /></div>
          <div className="leading-tight"><p className="text-sm font-semibold">VitroStack Site Bot</p><p className="text-[11px] text-white/70">Foreman · {PHONE}</p></div>
        </div>
        <div ref={scroller} className="h-[420px] space-y-2 overflow-y-auto px-3 py-4 scrollbar-thin">
          {!data && <Skeleton className="h-10 w-2/3" />}
          {data?.length === 0 && <p className="mx-auto w-fit rounded-lg bg-white/80 px-3 py-1.5 text-center text-[11px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">Messages from site appear here. Try a quick reply below.</p>}
          {data?.map((m) => (
            <div key={m.id} className={cn("flex", m.direction === "in" ? "justify-end" : "justify-start")}>
              <div className={cn("max-w-[80%] whitespace-pre-wrap rounded-lg px-3 py-1.5 text-[13px] shadow-sm", m.direction === "in" ? "rounded-tr-none bg-[#d9fdd3] text-slate-900 dark:bg-[#005c4b] dark:text-white" : "rounded-tl-none bg-white text-slate-900 dark:bg-[#202c33] dark:text-slate-100")}>
                {m.text}
                <span className="ml-2 inline-flex items-center gap-0.5 align-bottom text-[10px] text-slate-500 dark:text-slate-400">{new Date(m.created_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}{m.direction === "in" && <CheckCheck className="h-3 w-3 text-sky-500" />}</span>
              </div>
            </div>
          ))}
          {sending && <div className="w-fit rounded-lg bg-white px-3 py-2 text-xs text-slate-500 shadow-sm dark:bg-[#202c33]">typing…</div>}
        </div>
        <div className="flex gap-1.5 overflow-x-auto px-3 pb-2 scrollbar-thin">
          {QUICK.map((q) => <button key={q} onClick={() => send(q)} className="shrink-0 rounded-full bg-white px-3 py-1 text-[11px] font-medium text-[#075e54] shadow-sm hover:bg-slate-50 dark:bg-[#202c33] dark:text-emerald-400">{q}</button>)}
        </div>
        <form onSubmit={(e) => { e.preventDefault(); send(text); }} className="flex items-center gap-2 bg-[#f0f2f5] px-3 py-2 dark:bg-[#202c33]">
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Message as the foreman" aria-label="Foreman message" className="h-9 flex-1 rounded-full bg-white px-4 text-sm outline-none dark:bg-[#2a3942] dark:text-white" />
          <button type="submit" disabled={!text.trim()} className="flex h-9 w-9 items-center justify-center rounded-full bg-[#00a884] text-white disabled:opacity-50" aria-label="Send"><Send className="h-4 w-4" /></button>
        </form>
      </div>
    </div>
  );
}

function AlertCard({ a, onChanged }: { a: Alert; onChanged: () => void }) {
  const [busy, setBusy] = useState<"approve" | "dismiss" | null>(null);
  const act = async (kind: "approve" | "dismiss") => {
    setBusy(kind);
    try {
      await api.post(`/alerts/${a.id}/${kind}`);
      toast.success(kind === "approve" ? "Replacement approved – foreman notified on WhatsApp" : "Alert dismissed");
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const isBreak = a.kind === "breakage";
  return (
    <div className={cn("rounded-xl border p-4 animate-fade-in", a.status === "open" ? (isBreak ? "border-amber-200 bg-amber-50/50 dark:border-amber-900 dark:bg-amber-950/20" : "border-slate-200 dark:border-slate-800") : "border-slate-200 opacity-75 dark:border-slate-800")}>
      <div className="flex items-start gap-3">
        <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", isBreak ? "bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300" : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300")}>
          {isBreak ? <ShieldAlert className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold">{a.title}</p>
            {a.status !== "open" && <Badge tone={a.status === "approved" ? "emerald" : "slate"}>{a.status}</Badge>}
          </div>
          <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-400">{a.body}</p>
          {isBreak && a.payload && (
            <div className="mt-2 flex flex-wrap gap-2 text-xs">
              <Badge tone={a.payload.source === "offcut" ? "emerald" : "slate"}>{a.payload.source === "offcut" ? `Re-cut from offcut #${a.payload.offcut_id}` : "Needs a new jumbo sheet"}</Badge>
              {a.project_id && <Link to={`/projects/${a.project_id}`} className="font-medium text-brand-700 hover:underline dark:text-brand-400">Open project →</Link>}
            </div>
          )}
          <p className="mt-2 text-[11px] text-slate-400">{timeAgo(a.created_at)}</p>
        </div>
      </div>
      {a.status === "open" && (
        <div className="mt-3 flex gap-2 pl-11">
          <Button size="sm" onClick={() => act("approve")} loading={busy === "approve"}>{isBreak ? "Approve re-cut & notify" : "Acknowledge"}</Button>
          <Button size="sm" variant="ghost" onClick={() => act("dismiss")} loading={busy === "dismiss"} icon={<X className="h-3.5 w-3.5" />}>Dismiss</Button>
        </div>
      )}
    </div>
  );
}

export default function SiteOps() {
  const [filter, setFilter] = useState<"open" | "all">("open");
  const { data, loading, reload } = useApi<Alert[]>(filter === "open" ? "/alerts?status=open" : "/alerts");
  const { refreshAlerts } = useApp();
  const changed = () => { reload(true); refreshAlerts(); };
  useEffect(() => { const t = setInterval(() => reload(true), 10000); return () => clearInterval(t); }, [reload]);

  return (
    <div>
      <PageHeader title="Site ops" subtitle="Foremen report over WhatsApp. VitroCore plans the fix and you approve it here." />
      <div className="grid gap-8 lg:grid-cols-[380px_1fr]">
        <div>
          <Phone onActivity={changed} />
          <p className="mx-auto mt-3 max-w-[360px] text-center text-xs text-slate-500">WhatsApp simulator. Set <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">WHATSAPP_TOKEN</code> to connect the real Business API webhook.</p>
        </div>
        <Card>
          <CardHeader title="Approval queue" subtitle="Breakage re-cuts and site updates" icon={<Siren className="h-4 w-4" />}
            action={<Segmented size="sm" value={filter} onChange={setFilter} options={[{ value: "open", label: "Open" }, { value: "all", label: "History" }]} />} />
          <div className="space-y-3 p-4">
            {loading && [0, 1].map((i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
            {data && data.length === 0 && (
              <EmptyState icon={<Inbox className="h-6 w-6" />} title={filter === "open" ? "Nothing to approve" : "No site activity yet"}
                body={<>Try sending <b>BROKEN W1-03</b> from the simulator. VitroCore will find the panel, plan a re-cut from offcuts and ask for your approval here.</>} />
            )}
            {data?.map((a) => <AlertCard key={a.id} a={a} onChanged={changed} />)}
          </div>
        </Card>
      </div>
    </div>
  );
}
