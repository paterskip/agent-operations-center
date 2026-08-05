"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ActivityEvent, DashboardSnapshot, DecisionRecord, IdeaRecord, TaskCard } from "@/lib/types";
import { STATUSES } from "@/lib/types";
import SearchModal from "./search-modal";

const roleIcon: Record<string, string> = { pm: "◆", coder: "⌘", "coder-parallel": "⌘", designer: "✦", tester: "✓", reviewer: "◇" };
const statusLabel: Record<string, string> = { triage: "Triage", todo: "Todo", scheduled: "Scheduled", ready: "Ready", running: "In progress", blocked: "Blocked", review: "Review", done: "Done" };
const statusHelp: Record<string, string> = {
  triage: "Pomysł czeka na analizę PM.",
  todo: "Zadanie w backlogu — nikt jeszcze go nie podjął.",
  scheduled: "Zaplanowane, czeka na wolny slot agenta.",
  ready: "Gotowe — agent może je podjąć natychmiast.",
  running: "Agent aktywnie pracuje nad tym zadaniem.",
  blocked: "Zadanie zablokowane — czeka na decyzję CEO lub zależność.",
  review: "Gotowe do przeglądu. PM lub reviewer musi zweryfikować.",
  done: "Zakończone pomyślnie.",
};

function relativeTime(timestamp: number | null) {
  if (!timestamp) return "brak aktywności";
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp * 1000) / 1000));
  if (seconds < 60) return `${seconds}s temu`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min temu`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} godz. temu`;
  return new Intl.DateTimeFormat("pl-PL", { dateStyle: "medium", timeStyle: "short" }).format(new Date(timestamp * 1000));
}

const eventLabels: Record<string, string> = { created: "utworzono zadanie", claimed: "rozpoczęto pracę", heartbeat: "wysłano heartbeat", completed: "zakończono zadanie", blocked: "zadanie zablokowane", comment: "dodano komentarz", status: "zmieniono status", unblocked: "odblokowano zadanie", resumed: "wznowiono pracę" };

function eventSummary(event: ActivityEvent) { return eventLabels[event.kind] || event.kind.replaceAll("_", " "); }

type ViewMode = "overview" | "board";
type ToastItem = { id: number; text: string; kind: "info" | "success" | "warning" };

let toastId = 0;

export default function Dashboard() {
  const [view, setView] = useState<ViewMode>("overview");
  const [data, setData] = useState<DashboardSnapshot | null>(null);
  const [board, setBoard] = useState("");
  const [selectedTask, setSelectedTask] = useState<TaskCard | null>(null);
  const [agentFilter, setAgentFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [live, setLive] = useState(false);
  const [ideas, setIdeas] = useState<IdeaRecord[]>([]);
  const [ideaMessage, setIdeaMessage] = useState("");
  const [submittingIdea, setSubmittingIdea] = useState(false);
  const [decisions, setDecisions] = useState<DecisionRecord[]>([]);
  const [decisionComment, setDecisionComment] = useState("");
  const [decisionMessage, setDecisionMessage] = useState("");
  const [decisionBusy, setDecisionBusy] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  function addToast(text: string, kind: ToastItem["kind"] = "info") {
    const id = ++toastId;
    setToasts((prev) => [...prev.slice(-4), { id, text, kind }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000);
  }

  const scrollTo = useCallback((id: string) => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const load = useCallback(async (slug?: string) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const res = await fetch(`/api/snapshot${slug ? `?board=${encodeURIComponent(slug)}` : ""}`, { cache: "no-store", signal: controller.signal });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(res.status === 401 ? "Sesja wygasła — odśwież stronę i zaloguj się ponownie." : `Błąd API (${res.status}): ${body}`);
      }
      const snap = await res.json() as DashboardSnapshot;
      setData(snap); setBoard(snap.selectedBoard); setError("");
      setSelectedTask((c) => c ? snap.tasks.find((t) => t.id === c.id) || null : null);
    } catch (e) {
      const msg = e instanceof DOMException && e.name === "AbortError" ? "Przekroczono czas połączenia — spróbuj ponownie." : e instanceof Error ? e.message : "Nie udało się pobrać danych";
      setError(msg);
    }
    finally { clearTimeout(timer); setLoading(false); }
  }, []);

  const loadIdeas = useCallback(async () => {
    try { const r = await fetch("/api/ideas", { cache: "no-store" }); if (r.ok) setIdeas(((await r.json()) as { ideas: IdeaRecord[] }).ideas); } catch {}
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const slug = params.get("board") || undefined;
    const t = setTimeout(() => { void load(slug); void loadIdeas(); }, 0);
    return () => clearTimeout(t);
  }, [load, loadIdeas]);

  useEffect(() => {
    if (view !== "board") return;
    const es = new EventSource("/api/events");
    es.addEventListener("ready", () => setLive(true));
    es.addEventListener("change", () => { load(board); loadIdeas(); });
    es.addEventListener("source-error", () => setLive(false));
    es.onerror = () => setLive(false);
    return () => { setLive(false); es.close(); };
  }, [view, board, load, loadIdeas]);

  /* SSE toast integration */
  useEffect(() => {
    if (view !== "board") return;
    const es = new EventSource("/api/events");
    es.addEventListener("change", () => {
      if (!data) return;
      const latest = data.activity[0];
      if (latest) addToast(`${latest.assignee || "System"} — ${eventSummary(latest)}: ${latest.taskTitle}`, latest.kind === "completed" ? "success" : latest.kind === "blocked" ? "warning" : "info");
    });
    return () => es.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.activity?.[0]?.id]);

  /* Keyboard shortcuts */
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") { e.preventDefault(); setSearchOpen(true); return; }
      if ((e.metaKey || e.ctrlKey) && e.key === "b") { e.preventDefault(); setView((v) => v === "board" ? "overview" : "board"); return; }
      if (e.key === "Escape") { if (selectedTask) setSelectedTask(null); return; }
      if (e.key === "?" && !e.ctrlKey && !e.metaKey && document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "TEXTAREA") { setSearchOpen(true); return; }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selectedTask]);

  async function submitIdea(elm: HTMLFormElement, mode: "draft" | "analysis") {
    setSubmittingIdea(true); setIdeaMessage("");
    const fd = new FormData(elm);
    const p = { title: fd.get("title"), description: fd.get("description"), project: fd.get("project"), priority: Number(fd.get("priority")), mode };
    try {
      const r = await fetch("/api/ideas", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(p) });
      const j = await r.json() as { error?: string };
      if (!r.ok) throw new Error(j.error || "Błąd");
      setIdeaMessage(mode === "draft" ? "Szkic zapisany." : "Pomysł wysłany do PM.");
      elm.reset(); await loadIdeas();
      addToast(`Pomysł${mode === "draft" ? " (szkic)" : ""} zapisany dla ${p.project}`, "success");
    } catch (e) { setIdeaMessage(e instanceof Error ? e.message : "Błąd"); }
    finally { setSubmittingIdea(false); }
  }

  const selectBoard = useCallback((slug: string) => {
    const u = new URL(window.location.href);
    u.searchParams.set("board", slug);
    window.history.replaceState({}, "", u.toString());
    setView("board");
    setLoading(true); void load(slug);
  }, [load]);

  const loadDecisions = useCallback(async (slug: string, taskId: string) => {
    try {
      const r = await fetch(`/api/decisions?board=${encodeURIComponent(slug)}&taskId=${encodeURIComponent(taskId)}`, { cache: "no-store" });
      if (r.ok) setDecisions(((await r.json()) as { decisions: DecisionRecord[] }).decisions);
    } catch {}
  }, []);

  const tid = selectedTask?.id;
  useEffect(() => {
    if (!tid) return;
    const t = setTimeout(() => void loadDecisions(board, tid), 0);
    return () => clearTimeout(t);
  }, [board, tid, loadDecisions]);

  async function submitDecision(action: "approve" | "reject" | "hold") {
    if (!selectedTask) return;
    if (["reject", "hold"].includes(action) && decisionComment.trim().length < 5) { setDecisionMessage("Podaj powód — minimum 5 znaków."); return; }
    const labels = { approve: "zaakceptować i odblokować", reject: "odrzucić", hold: "zablokować" };
    const bn = data?.boards.find((b) => b.slug === board)?.name || board;
    if (!confirm(`Czy na pewno chcesz ${labels[action]} zadanie ${selectedTask.id} na boardzie ${bn}?`)) return;
    setDecisionBusy(true); setDecisionMessage("");
    try {
      const r = await fetch("/api/decisions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ board, taskId: selectedTask.id, action, comment: decisionComment }) });
      const j = await r.json() as { id?: string; error?: string };
      if (!r.ok) throw new Error(j.error || "Błąd");
      setDecisionMessage("Decyzja zapisana. Hermes aktualizuje kartę…");
      for (let i = 0; i < 6; i++) {
        await new Promise((resolve) => setTimeout(resolve, 1200));
        const h = await fetch(`/api/decisions?board=${encodeURIComponent(board)}&taskId=${encodeURIComponent(selectedTask.id)}`, { cache: "no-store" });
        const rows = ((await h.json()) as { decisions: DecisionRecord[] }).decisions;
        setDecisions(rows);
        const cur = rows.find((d) => d.id === j.id);
        if (cur?.status === "failed") throw new Error(cur.lastError || "Broker odrzucił");
        if (cur?.status === "done") { setDecisionMessage(`Gotowe: ${cur.fromStatus} → ${cur.resultStatus}.`); setDecisionComment(""); await load(board); addToast(`Decyzja wykonana: ${selectedTask.id} ${cur.fromStatus}→${cur.resultStatus}`, "success"); break; }
        if (i === 5) { setDecisionMessage("Decyzja w toku — sprawdź historię za chwilę."); addToast("Decyzja nadal przetwarzana przez brokera", "info"); }
      }
    } catch (e) { setDecisionMessage(e instanceof Error ? e.message : "Błąd"); }
    finally { setDecisionBusy(false); }
  }

  function toggleCol(status: string) { setCollapsed((prev) => { const n = new Set(prev); if (n.has(status)) n.delete(status); else n.add(status); return n; }); }

  const tasksPerAgent = useMemo(() => {
    if (!data) return new Map<string, { total: number; running: number; blocked: number }>();
    const m = new Map<string, { total: number; running: number; blocked: number }>();
    for (const t of data.tasks) {
      if (!t.assignee) continue;
      const e = m.get(t.assignee) || { total: 0, running: 0, blocked: 0 };
      e.total++;
      if (t.status === "running") e.running++;
      if (t.status === "blocked") e.blocked++;
      m.set(t.assignee, e);
    }
    return m;
  }, [data]);

  const visibleTasks = useMemo(() => data?.tasks.filter((t) => agentFilter === "all" || t.assignee === agentFilter) || [], [data, agentFilter]);
  const active = data?.agents.filter((a) => a.status === "working").length || 0;
  const blockedCount = data?.boards.reduce((s, b) => s + (b.counts.blocked || 0), 0) || 0;
  const pendingDecisions = data?.tasks.filter((t) => ["blocked", "scheduled"].includes(t.status)).length || 0;

  const isMobile = typeof window !== "undefined" && window.innerWidth < 768;

  if (loading) return <main className="center-state"><div className="loader" /><p>Łączenie z centrum operacyjnym…</p></main>;
  if (error || !data) return <main className="center-state"><div className="error-mark">!</div><h1>Brak danych</h1><p>{error}</p><button onClick={() => load(board)}>Spróbuj ponownie</button></main>;

  return <div className="app-shell">
    <SearchModal open={searchOpen} onClose={() => setSearchOpen(false)} data={data} board={board} onSelectBoard={selectBoard} onSelectTask={setSelectedTask} />

    {/* Toasts */}
    <div className="toast-container" aria-live="polite">
      {toasts.map((toast) => <div key={toast.id} className={`toast ${toast.kind}`}>{toast.text}</div>)}
    </div>

    <aside className="sidebar">
      <div className="brand"><span className="brand-mark">A</span><div><strong>Agent Ops</strong><small>Mission Control</small></div></div>
      <nav aria-label="Główna nawigacja">
        <button className={`nav-item ${view === "overview" ? "active" : ""}`} onClick={() => setView("overview")}><span>◎</span> Overview <kbd>⌃B</kbd></button>
        <button className={`nav-item ${view === "board" ? "active" : ""}`} onClick={() => { setView("board"); scrollTo("board"); }}><span>⌁</span> Board</button>
        <button className="nav-item" onClick={() => { scrollTo("inbox"); }}><span>＋</span> CEO Inbox</button>
        <button className="nav-item" onClick={() => { scrollTo("agents"); }}><span>◎</span> Agents</button>
        <button className="nav-item" onClick={() => setSearchOpen(true)}><span>⌕</span> Search <kbd>⌘K</kbd></button>
      </nav>
      <div className="sidebar-foot">
        <div className="sidebar-activity">
          {data.activity.slice(0, 3).map((ev) => <div key={`${ev.board}-${ev.id}`} className="sidebar-event" onClick={() => { if (ev.board !== board) selectBoard(ev.board); setTimeout(() => setSelectedTask(data.tasks.find((t) => t.id === ev.taskId) || null), 50); }}>
            <span className={`event-dot ${ev.kind}`} /><small>{ev.assignee || "System"}: {eventSummary(ev)}</small>
          </div>)}
        </div>
        <div className="sidebar-status"><span className="system-dot" /><div><strong>Hermes online</strong><small>{data.boards.length} boardy · {data.agents.length} agentów</small></div></div>
      </div>
    </aside>

    {/* --- OVERVIEW --- */}
    {view === "overview" && <main className="main-content" id="overview">
      <header className="topbar"><div><p className="eyebrow">AGENT OPERATIONS CENTER</p><h1>Overview</h1></div><div className="top-actions"><span className="shortcut-hint"><kbd>⌘K</kbd> search — <kbd>⌘B</kbd> board</span></div></header>
      <section className="metric-grid" aria-label="Kluczowe metryki">
        <article><span>Aktywni agenci</span><strong>{active}<small> / {data.agents.length}</small></strong><i className="metric-line blue" /></article>
        <article><span>Wymagają decyzji</span><strong>{pendingDecisions}</strong><i className="metric-line red" /></article>
        <article><span>Zadania w toku</span><strong>{data.boards.reduce((s, b) => s + (b.counts.running || 0), 0)}</strong><i className="metric-line violet" /></article>
        <article><span>Ukończone</span><strong>{data.boards.reduce((s, b) => s + (b.counts.done || 0), 0)}</strong><i className="metric-line green" /></article>
      </section>
      <section className="quick-actions">
        <button className="action-btn primary" onClick={() => { setView("board"); setTimeout(() => scrollTo("board"), 50); }}>Przejdź do Kanbanu</button>
        <button className="action-btn" onClick={() => { setView("board"); setTimeout(() => scrollTo("inbox"), 50); }}>CEO Inbox</button>
        <button className="action-btn" onClick={() => setSearchOpen(true)}>Szukaj <kbd>⌘K</kbd></button>
      </section>
      <section className="overview-grid">
        <div>
          <div className="section-head"><div><p className="eyebrow">DECYZJE</p><h2>Wymagające uwagi</h2></div></div>
          {data.tasks.filter((t) => ["blocked", "scheduled"].includes(t.status)).slice(0, 6).map((t) => <button key={t.id} className="task-card compact" onClick={() => { setView("board"); setTimeout(() => { const slug = data.boards.find((b) => b.slug && data.tasks.filter((a) => a.boardSlug === b.slug).includes(t))?.slug || board; selectBoard(slug); setTimeout(() => setSelectedTask(t), 100); }, 50); }}>
            <div className="task-meta"><code>{t.id}</code><span className={`status-badge ${t.status}`}>{t.status}</span></div><h3>{t.title}</h3><footer>{t.boardSlug} · {t.assignee || "unassigned"}</footer>
          </button>)}
          {data.tasks.filter((t) => ["blocked", "scheduled"].includes(t.status)).length === 0 && <p className="empty-state">Wszystkie zadania są odblokowane. Świetnie!</p>}
        </div>
        <div>
          <div className="section-head"><div><p className="eyebrow">OSTATNIA AKTYWNOŚĆ</p><h2>Live feed</h2></div></div>
          {data.activity.slice(0, 8).map((ev) => <article key={`${ev.board}-${ev.id}`} className="activity-row">
            <span className={`activity-dot ${ev.kind}`} /><div><p><strong>{ev.assignee || "System"}</strong> {eventSummary(ev)}</p><button onClick={() => { if (ev.board !== board) selectBoard(ev.board); setTimeout(() => setSelectedTask(data.tasks.find((t) => t.id === ev.taskId) || null), 50); }}>{ev.taskTitle}</button><small>{ev.board} · {relativeTime(ev.createdAt)}</small></div>
          </article>)}
        </div>
      </section>
    </main>}

    {/* --- BOARD --- */}
    {view === "board" && <main className="main-content" id="board">
      <header className="topbar">
        <div><p className="eyebrow">OPERATIONS / LIVE</p><h1>Command Center</h1></div>
        <div className="top-actions"><span className={`live-pill ${live ? "" : "offline"}`}><i /> {live ? "LIVE" : "RECONNECTING"}</span><span className="updated">Aktualizacja {new Date(data.generatedAt).toLocaleTimeString("pl-PL")}</span></div>
      </header>

      <section className="metric-grid" aria-label="Podsumowanie">
        <article><span>Aktywni agenci</span><strong>{active}<small> / {data.agents.length}</small></strong><i className="metric-line blue" /></article>
        <article><span>Zadania w toku</span><strong>{data.boards.reduce((s, b) => s + (b.counts.running || 0), 0)}</strong><i className="metric-line violet" /></article>
        <article><span>Wymaga uwagi</span><strong>{blockedCount}</strong><i className="metric-line red" /></article>
        <article><span>Ukończone</span><strong>{data.boards.reduce((s, b) => s + (b.counts.done || 0), 0)}</strong><i className="metric-line green" /></article>
      </section>

      <section className="project-strip" aria-label="Projekty">
        {data.boards.map((item) => <button key={item.slug} className={`project-chip ${board === item.slug ? "selected" : ""}`} onClick={() => selectBoard(item.slug)}>
          <span className="project-icon">{item.icon}</span><span><strong>{item.name}</strong><small>{item.counts.running || 0} active · {item.counts.blocked || 0} blocked</small></span>
        </button>)}
      </section>

      <section className="inbox-panel" id="inbox">
        <div className="section-head"><div><p className="eyebrow">CEO WORKSPACE</p><h2>CEO Inbox</h2></div><span className="secure-write">2FA protected</span></div>
        <div className="inbox-grid">
          <form className="idea-form" onSubmit={(ev) => { ev.preventDefault(); void submitIdea(ev.currentTarget, "analysis"); }}>
            <label><span>Projekt docelowy</span><select name="project" required defaultValue=""><option value="" disabled>Wybierz projekt</option>{data.boards.filter((b) => !["default", "portfolio"].includes(b.slug)).map((b) => <option value={b.slug} key={b.slug}>{b.name}</option>)}</select></label>
            <label><span>Tytuł pomysłu / feature</span><input name="title" minLength={3} maxLength={160} required placeholder="Np. automatyczne raporty skuteczności" /></label>
            <label><span>Problem, pomysł i oczekiwany efekt</span><textarea name="description" minLength={10} maxLength={6000} required rows={5} placeholder="Co chcemy osiągnąć, dla kogo i po czym poznamy sukces?" /></label>
            <label><span>Priorytet</span><select name="priority" defaultValue="2"><option value="1">P1 — niski</option><option value="2">P2 — normalny</option><option value="3">P3 — wysoki</option><option value="4">P4 — krytyczny</option></select></label>
            <div className="idea-actions"><button type="button" disabled={submittingIdea} onClick={(ev) => { const f = ev.currentTarget.form; if (f) void submitIdea(f, "draft"); }}>Zapisz szkic</button><button className="primary" type="submit" disabled={submittingIdea}>{submittingIdea ? "Wysyłanie…" : "Wyślij PM do analizy"}</button></div>
            {ideaMessage && <p className="form-message">{ideaMessage}</p>}
          </form>
          <div className="idea-list"><header><strong>Pomysły i analizy</strong><span>{ideas.length}</span></header>{ideas.map((idea) => <article key={idea.id}><div><span className={`idea-status ${idea.status}`}>{idea.status}</span><code>{idea.project} · P{idea.priority}</code></div><h3>{idea.title}</h3><p>{idea.description}</p><footer><span>{idea.hermesTaskId ? `Hermes: ${idea.hermesTaskId}` : idea.mode === "draft" ? "Szkic lokalny" : "Oczekuje na bridge"}</span><time>{relativeTime(idea.updatedAt)}</time></footer></article>)}{!ideas.length && <div className="empty-activity"><span>＋</span><p><button onClick={() => { const f = document.querySelector(".idea-form") as HTMLFormElement | null; f?.querySelector<HTMLInputElement>("input")?.focus(); }}>Dodaj pierwszy pomysł dla PM →</button></p></div>}</div>
        </div>
      </section>

      <section className="agent-presence" id="agents">
        <div className="section-head"><div><p className="eyebrow">TEAM STATUS</p><h2>Agent workforce</h2></div><button className={agentFilter === "all" ? "filter active" : "filter"} onClick={() => setAgentFilter("all")}>Wszyscy</button></div>
        <div className="agent-grid">{data.agents.map((agent) => {
          const wl = tasksPerAgent.get(agent.name);
          return <button key={agent.name} onClick={() => setAgentFilter(agentFilter === agent.name ? "all" : agent.name)} className={`agent-card ${agent.status} ${agentFilter === agent.name ? "selected" : ""}`}>
            <div className="agent-avatar">{roleIcon[agent.name] || "◇"}<span /></div>
            <div className="agent-copy"><strong>{agent.name}</strong><small>{agent.status === "working" ? agent.currentTask : agent.status === "blocked" ? `${agent.blocked} blocked` : "Dostępny"}{wl && ` · ${wl.running || 0} active / ${wl.total || 0} total`}</small></div>
            <span className="agent-state" title={`${wl?.total || 0} zadań ogółem, ${wl?.running || 0} w toku, ${wl?.blocked || 0} zablokowanych`}>{agent.status}</span>
          </button>;
        })}</div>
      </section>

      <div className="workspace-grid">
        <section className="board-panel">
          <div className="section-head"><div><p className="eyebrow">{board.toUpperCase()}</p><h2>Delivery board</h2></div><span className="secure-write">2FA protected</span></div>
          {isMobile && <p className="mobile-hint">Dotknij nagłówka kolumny aby ją zwinąć.</p>}
          <div className="kanban-scroll"><div className="kanban-board">{STATUSES.map((status) => {
            const tasks = visibleTasks.filter((t) => t.status === status);
            const isCollapsed = collapsed.has(status);
            const isEmpty = tasks.length === 0;
            return <section className={`kanban-column ${status} ${isCollapsed ? "collapsed" : ""} ${isEmpty && !isCollapsed ? "empty" : ""}`} key={status} aria-label={statusLabel[status]}>
              <header onClick={() => toggleCol(status)} title={`${statusHelp[status] || ""} — kliknij aby ${isCollapsed ? "rozwinąć" : "zwinąć"}`}>
                <span className="status-dot" /><strong>{statusLabel[status]}</strong><b>{tasks.length}</b>
              </header>
              {!isCollapsed && <div className="task-stack">
                {tasks.map((task) => <div className="task-card-wrapper" key={task.id}>
                  <button className="task-card" onClick={() => setSelectedTask(task)}>
                    <div className="task-meta"><code>{task.id}</code><span>P{task.priority}</span></div>
                    <h3>{task.title}</h3>
                    <p>{task.body || "Brak opisu"}</p>
                    <footer><span className="assignee"><i>{roleIcon[task.assignee || ""] || "◇"}</i>{task.assignee || "unassigned"}</span><time>{relativeTime(task.startedAt || task.createdAt)}</time></footer>
                  </button>
                  <div className="task-quick-actions">
                    {["blocked", "scheduled"].includes(task.status) && <button className="quick-approve" title="Akceptuj i odblokuj" onClick={(e) => { e.stopPropagation(); setSelectedTask(task); setTimeout(() => { setDecisionComment(""); void submitDecision("approve"); }, 100); }}>✓</button>}
                    <button className="quick-view" title="Pokaż szczegóły" onClick={(e) => { e.stopPropagation(); setSelectedTask(task); }}>…</button>
                  </div>
                </div>)}
                {isEmpty && <div className="empty-column">{isMobile ? "—" : "Brak zadań"}</div>}
              </div>}
            </section>;
          })}</div></div>
        </section>

        <aside className="activity-panel" id="activity"><div className="section-head"><div><p className="eyebrow">EVENT STREAM</p><h2>Live activity</h2></div><span className="pulse" /></div><div className="activity-list" aria-live="polite">
          {data.activity.map((event) => <article key={`${event.board}-${event.id}`}><div className={`activity-icon ${event.kind}`}>{event.kind === "completed" ? "✓" : event.kind === "blocked" ? "!" : "·"}</div><div><p><strong>{event.assignee || "System"}</strong> {eventSummary(event)}</p><button onClick={() => { if (event.board !== board) { selectBoard(event.board); } else { setSelectedTask(data.tasks.find((t) => t.id === event.taskId) || null); } }}>{event.taskTitle}</button><small>{event.board} · {relativeTime(event.createdAt)}</small></div></article>)}
          {!data.activity.length && <div className="empty-activity"><span>⌁</span><p>Zdarzenia pojawią się, gdy zespół rozpocznie pracę.</p></div>}
        </div></aside>
      </div>
    </main>}

    {/* --- DRAWER --- */}
    {selectedTask && <div className="drawer-backdrop" onMouseDown={(e) => { if (e.currentTarget === e.target) setSelectedTask(null); }}><aside className="task-drawer" role="dialog" aria-modal="true" aria-labelledby="task-title">
      <header><div><code>{selectedTask.id}</code><span className={`status-badge ${selectedTask.status}`} title={statusHelp[selectedTask.status] || ""}>{selectedTask.status}</span></div><button aria-label="Zamknij" onClick={() => setSelectedTask(null)}>×</button></header>
      <h2 id="task-title">{selectedTask.title}</h2>
      <p className="task-body">{selectedTask.body || "Brak opisu."}</p>

      {/* #4: CEO Decision pinned at top */}
      <section className="decision-box"><h3>Decyzja CEO</h3>
        <p>Akcja dotyczy tylko tej karty. PM decyduje, który agent podejmie dalszą pracę.</p>
        <textarea value={decisionComment} onChange={(ev) => setDecisionComment(ev.target.value)} maxLength={2000} rows={3} placeholder={selectedTask.status === "blocked" ? "Komentarz (opcjonalny)" : "Powód"} />
        <div className="decision-actions">
          {["blocked", "scheduled"].includes(selectedTask.status) && <button className="approve" disabled={decisionBusy} onClick={() => void submitDecision("approve")}>{decisionBusy ? "…" : "Akceptuj i odblokuj"}</button>}
          {["blocked", "ready", "running"].includes(selectedTask.status) && <button className="reject" disabled={decisionBusy} onClick={() => void submitDecision("reject")}>Odrzuć</button>}
          {["todo", "ready", "running"].includes(selectedTask.status) && <button disabled={decisionBusy} onClick={() => void submitDecision("hold")}>Zablokuj</button>}
        </div>
        {selectedTask.status === "review" && <p className="decision-note">Status review wymaga natywnego workflow PM/reviewera — tu nie można go zatwierdzić.</p>}
        {decisionMessage && <p className="decision-message">{decisionMessage}</p>}
      </section>

      <dl><div><dt>Agent</dt><dd>{selectedTask.assignee || "Nieprzypisany"}</dd></div><div><dt>Priorytet</dt><dd>P{selectedTask.priority}</dd></div><div><dt>Branch</dt><dd>{selectedTask.branchName || "—"}</dd></div><div><dt>Heartbeat</dt><dd>{relativeTime(selectedTask.lastHeartbeatAt)}</dd></div></dl>

      <section><h3>Dependencies</h3><p>{selectedTask.parentIds.length ? `Parents: ${selectedTask.parentIds.join(", ")}` : "Brak"}</p>{selectedTask.childIds.length > 0 && <p>Children: {selectedTask.childIds.join(", ")}</p>}</section>
      <section><h3>Run history <span>{selectedTask.runs.length}</span></h3>{selectedTask.runs.map((r) => <article className="run" key={r.id}><div><strong>{r.profile || "worker"}</strong><span>{r.outcome || r.status}</span></div><small>{relativeTime(r.startedAt)}</small>{r.summary && <p>{r.summary}</p>}{r.error && <p className="run-error">{r.error}</p>}</article>)}{!selectedTask.runs.length && <p>Brak.</p>}</section>
      <section><h3>Comments <span>{selectedTask.comments.length}</span></h3>{selectedTask.comments.map((c) => <article className="comment" key={c.id}><div><strong>{c.author}</strong><small>{relativeTime(c.createdAt)}</small></div><p>{c.body}</p></article>)}{!selectedTask.comments.length && <p>Brak.</p>}</section>
      <section><h3>Historia decyzji <span>{decisions.length}</span></h3>{decisions.map((d) => <article className="decision-log" key={d.id}><div><strong>{d.action}</strong><span className={d.status}>{d.status}</span></div><p>{d.fromStatus} → {d.resultStatus || d.toStatus || "oczekuje"}</p>{d.comment && <p>{d.comment}</p>}<small>{relativeTime(d.createdAt)}</small></article>)}{!decisions.length && <p>Brak.</p>}</section>
    </aside></div>}
  </div>;
}
