"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ActivityEvent, DashboardSnapshot, IdeaRecord, TaskCard } from "@/lib/types";
import { STATUSES } from "@/lib/types";

const roleIcon: Record<string, string> = { pm: "◆", coder: "⌘", "coder-parallel": "⌘", designer: "✦", tester: "✓", reviewer: "◇" };
const statusLabel: Record<string, string> = { triage: "Triage", todo: "Todo", scheduled: "Scheduled", ready: "Ready", running: "In progress", blocked: "Blocked", review: "Review", done: "Done" };

function relativeTime(timestamp: number | null) {
  if (!timestamp) return "brak aktywności";
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp * 1000) / 1000));
  if (seconds < 60) return `${seconds}s temu`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min temu`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} godz. temu`;
  return new Intl.DateTimeFormat("pl-PL", { dateStyle: "medium", timeStyle: "short" }).format(new Date(timestamp * 1000));
}

function eventCopy(event: ActivityEvent) {
  const labels: Record<string, string> = { created: "utworzono zadanie", claimed: "rozpoczęto pracę", heartbeat: "wysłano heartbeat", completed: "zakończono zadanie", blocked: "zadanie zablokowane", comment: "dodano komentarz", status: "zmieniono status" };
  return labels[event.kind] || event.kind.replaceAll("_", " ");
}

export default function Dashboard() {
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
  const router = useRouter();

  const scrollTo = useCallback((id: string) => {
    const element = document.getElementById(id);
    if (element) element.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const load = useCallback(async (slug?: string) => {
    try {
      const response = await fetch(`/api/snapshot${slug ? `?board=${encodeURIComponent(slug)}` : ""}`, { cache: "no-store" });
      if (!response.ok) throw new Error((await response.json()).error || "Błąd API");
      const snapshot = await response.json() as DashboardSnapshot;
      setData(snapshot); setBoard(snapshot.selectedBoard); setError("");
      setSelectedTask((current) => current ? snapshot.tasks.find((task) => task.id === current.id) || null : null);
    } catch (e) { setError(e instanceof Error ? e.message : "Nie udało się pobrać danych"); }
    finally { setLoading(false); }
  }, []);

  const loadIdeas = useCallback(async () => {
    try {
      const response = await fetch("/api/ideas", { cache: "no-store" });
      if (response.ok) setIdeas(((await response.json()) as { ideas: IdeaRecord[] }).ideas);
    } catch {}
  }, []);

  useEffect(() => { const timer = window.setTimeout(() => { void load(); void loadIdeas(); }, 0); return () => window.clearTimeout(timer); }, [load, loadIdeas]);
  useEffect(() => {
    const source = new EventSource("/api/events");
    source.addEventListener("ready", () => setLive(true));
    source.addEventListener("change", () => { load(board); loadIdeas(); });
    source.addEventListener("source-error", () => setLive(false));
    source.onerror = () => setLive(false);
    return () => { setLive(false); source.close(); };
  }, [board, load, loadIdeas]);

  async function submitIdea(formElement: HTMLFormElement, mode: "draft" | "analysis") {
    setSubmittingIdea(true); setIdeaMessage("");
    const form = new FormData(formElement);
    const payload = { title: form.get("title"), description: form.get("description"), project: form.get("project"), priority: Number(form.get("priority")), mode };
    try {
      const response = await fetch("/api/ideas", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "Nie udało się zapisać pomysłu");
      setIdeaMessage(mode === "draft" ? "Szkic zapisany." : "Pomysł wysłany do PM.");
      formElement.reset(); await loadIdeas();
    } catch (error) { setIdeaMessage(error instanceof Error ? error.message : "Błąd zapisu"); }
    finally { setSubmittingIdea(false); }
  }

  const visibleTasks = useMemo(() => data?.tasks.filter((task) => agentFilter === "all" || task.assignee === agentFilter) || [], [data, agentFilter]);
  const active = data?.agents.filter((agent) => agent.status === "working").length || 0;
  const blocked = data?.boards.reduce((sum, item) => sum + (item.counts.blocked || 0), 0) || 0;

  if (loading) return <main className="center-state"><div className="loader"/><p>Łączenie z centrum operacyjnym…</p></main>;
  if (error || !data) return <main className="center-state"><div className="error-mark">!</div><h1>Brak danych</h1><p>{error}</p><button onClick={() => load(board)}>Spróbuj ponownie</button></main>;

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark">A</span><div><strong>Agent Ops</strong><small>Mission Control</small></div></div>
      <nav aria-label="Główna nawigacja">
        <button type="button" className="nav-item active" onClick={() => scrollTo("board")}><span>⌁</span> Operations</button>
        <button type="button" className="nav-item" onClick={() => scrollTo("inbox")}><span>＋</span> CEO Inbox</button>
        <button type="button" className="nav-item" onClick={() => scrollTo("agents")}><span>◎</span> Agents</button>
        <button type="button" className="nav-item" onClick={() => scrollTo("activity")}><span>≋</span> Activity</button>
      </nav>
      <div className="sidebar-foot"><span className="system-dot"/><div><strong>Hermes online</strong><small>{data.boards.length} boardy · {data.agents.length} agentów</small></div></div>
    </aside>

    <main className="main-content" id="board">
      <header className="topbar">
        <div><p className="eyebrow">OPERATIONS / LIVE</p><h1>Command Center</h1></div>
        <div className="top-actions"><span className={`live-pill ${live ? "" : "offline"}`}><i/> {live ? "LIVE" : "RECONNECTING"}</span><span className="updated">Aktualizacja {new Date(data.generatedAt).toLocaleTimeString("pl-PL")}</span></div>
      </header>

      <section className="metric-grid" aria-label="Podsumowanie">
        <article><span>Aktywni agenci</span><strong>{active}<small> / {data.agents.length}</small></strong><i className="metric-line blue"/></article>
        <article><span>Zadania w toku</span><strong>{data.boards.reduce((s,b) => s + (b.counts.running || 0), 0)}</strong><i className="metric-line violet"/></article>
        <article><span>Wymaga uwagi</span><strong>{blocked}</strong><i className="metric-line red"/></article>
        <article><span>Ukończone</span><strong>{data.boards.reduce((s,b) => s + (b.counts.done || 0), 0)}</strong><i className="metric-line green"/></article>
      </section>

      <section className="project-strip" aria-label="Projekty">
        {data.boards.map((item) => <button key={item.slug} className={`project-chip ${board === item.slug ? "selected" : ""}`} onClick={() => { router.replace(`?board=${encodeURIComponent(item.slug)}`, { scroll: false }); setLoading(true); load(item.slug); }}>
          <span className="project-icon">{item.icon}</span><span><strong>{item.name}</strong><small>{item.counts.running || 0} active · {item.counts.blocked || 0} blocked</small></span>
        </button>)}
      </section>

      <section className="inbox-panel" id="inbox">
        <div className="section-head"><div><p className="eyebrow">CEO WORKSPACE</p><h2>CEO Inbox</h2></div><span className="secure-write">2FA protected</span></div>
        <div className="inbox-grid">
          <form className="idea-form" onSubmit={(event) => { event.preventDefault(); void submitIdea(event.currentTarget, "analysis"); }}>
            <label><span>Projekt docelowy</span><select name="project" required defaultValue=""><option value="" disabled>Wybierz projekt</option>{data.boards.filter((item) => !["default", "portfolio"].includes(item.slug)).map((item) => <option value={item.slug} key={item.slug}>{item.name}</option>)}</select></label>
            <label><span>Tytuł pomysłu / feature</span><input name="title" minLength={3} maxLength={160} required placeholder="Np. automatyczne raporty skuteczności" /></label>
            <label><span>Problem, pomysł i oczekiwany efekt</span><textarea name="description" minLength={10} maxLength={6000} required rows={5} placeholder="Co chcemy osiągnąć, dla kogo i po czym poznamy sukces?" /></label>
            <label><span>Priorytet</span><select name="priority" defaultValue="2"><option value="1">P1 — niski</option><option value="2">P2 — normalny</option><option value="3">P3 — wysoki</option><option value="4">P4 — krytyczny</option></select></label>
            <div className="idea-actions"><button type="button" disabled={submittingIdea} onClick={(event) => { const form = event.currentTarget.form; if (form) void submitIdea(form, "draft"); }}>Zapisz szkic</button><button className="primary" type="submit" disabled={submittingIdea}>{submittingIdea ? "Wysyłanie…" : "Wyślij PM do analizy"}</button></div>
            {ideaMessage && <p className="form-message">{ideaMessage}</p>}
          </form>
          <div className="idea-list"><header><strong>Pomysły i analizy</strong><span>{ideas.length}</span></header>{ideas.map((idea) => <article key={idea.id}><div><span className={`idea-status ${idea.status}`}>{idea.status}</span><code>{idea.project} · P{idea.priority}</code></div><h3>{idea.title}</h3><p>{idea.description}</p><footer><span>{idea.hermesTaskId ? `Hermes: ${idea.hermesTaskId}` : idea.mode === "draft" ? "Szkic lokalny" : "Oczekuje na bridge"}</span><time>{relativeTime(idea.updatedAt)}</time></footer></article>)}{!ideas.length && <div className="empty-activity"><span>＋</span><p>Dodaj pierwszy pomysł dla PM.</p></div>}</div>
        </div>
      </section>

      <section className="agent-presence" id="agents">
        <div className="section-head"><div><p className="eyebrow">TEAM STATUS</p><h2>Agent workforce</h2></div><button className={agentFilter === "all" ? "filter active" : "filter"} onClick={() => setAgentFilter("all")}>Wszyscy</button></div>
        <div className="agent-grid">{data.agents.map((agent) => <button key={agent.name} onClick={() => setAgentFilter(agentFilter === agent.name ? "all" : agent.name)} className={`agent-card ${agent.status} ${agentFilter === agent.name ? "selected" : ""}`}>
          <div className="agent-avatar">{roleIcon[agent.name] || "◇"}<span/></div><div className="agent-copy"><strong>{agent.name}</strong><small>{agent.status === "working" ? agent.currentTask : agent.status === "blocked" ? `${agent.blocked} zablokowane` : "Dostępny"}</small></div><span className="agent-state">{agent.status}</span>
        </button>)}</div>
      </section>

      <div className="workspace-grid">
        <section className="board-panel">
          <div className="section-head"><div><p className="eyebrow">{board.toUpperCase()}</p><h2>Delivery board</h2></div><span className="read-only">Read only</span></div>
          <div className="kanban-scroll"><div className="kanban-board">{STATUSES.map((status) => {
            const tasks = visibleTasks.filter((task) => task.status === status);
            return <section className={`kanban-column ${status}`} key={status} aria-label={statusLabel[status]}><header><span className="status-dot"/><strong>{statusLabel[status]}</strong><b>{tasks.length}</b></header><div className="task-stack">
              {tasks.map((task) => <button className="task-card" key={task.id} onClick={() => setSelectedTask(task)}><div className="task-meta"><code>{task.id}</code><span>P{task.priority}</span></div><h3>{task.title}</h3><p>{task.body || "Brak opisu zadania"}</p><footer><span className="assignee"><i>{roleIcon[task.assignee || ""] || "◇"}</i>{task.assignee || "unassigned"}</span><time>{relativeTime(task.startedAt || task.createdAt)}</time></footer></button>)}
              {!tasks.length && <div className="empty-column">Brak zadań</div>}
            </div></section>;
          })}</div></div>
        </section>

        <aside className="activity-panel" id="activity"><div className="section-head"><div><p className="eyebrow">EVENT STREAM</p><h2>Live activity</h2></div><span className="pulse"/></div><div className="activity-list" aria-live="polite">
          {data.activity.map((event) => <article key={`${event.board}-${event.id}`}><div className={`activity-icon ${event.kind}`}>{event.kind === "completed" ? "✓" : event.kind === "blocked" ? "!" : "·"}</div><div><p><strong>{event.assignee || "System"}</strong> {eventCopy(event)}</p><button onClick={() => { if (event.board !== board) { router.replace(`?board=${encodeURIComponent(event.board)}`, { scroll: false }); load(event.board); } else { setSelectedTask(data.tasks.find((task) => task.id === event.taskId) || null); } }}>{event.taskTitle}</button><small>{event.board} · {relativeTime(event.createdAt)}</small></div></article>)}
          {!data.activity.length && <div className="empty-activity"><span>⌁</span><p>Zdarzenia pojawią się, gdy zespół rozpocznie pracę.</p></div>}
        </div></aside>
      </div>
    </main>

    {selectedTask && <div className="drawer-backdrop" onMouseDown={(e) => { if (e.currentTarget === e.target) setSelectedTask(null); }}><aside className="task-drawer" role="dialog" aria-modal="true" aria-labelledby="task-title"><header><div><code>{selectedTask.id}</code><span className={`status-badge ${selectedTask.status}`}>{selectedTask.status}</span></div><button aria-label="Zamknij" onClick={() => setSelectedTask(null)}>×</button></header><h2 id="task-title">{selectedTask.title}</h2><p className="task-body">{selectedTask.body || "Brak opisu."}</p>
      <dl><div><dt>Agent</dt><dd>{selectedTask.assignee || "Nieprzypisany"}</dd></div><div><dt>Priorytet</dt><dd>P{selectedTask.priority}</dd></div><div><dt>Branch</dt><dd>{selectedTask.branchName || "—"}</dd></div><div><dt>Heartbeat</dt><dd>{relativeTime(selectedTask.lastHeartbeatAt)}</dd></div></dl>
      <section><h3>Dependencies</h3><p>{selectedTask.parentIds.length ? `Parents: ${selectedTask.parentIds.join(", ")}` : "Brak zależności nadrzędnych"}</p>{selectedTask.childIds.length > 0 && <p>Children: {selectedTask.childIds.join(", ")}</p>}</section>
      <section><h3>Run history <span>{selectedTask.runs.length}</span></h3>{selectedTask.runs.map((run) => <article className="run" key={run.id}><div><strong>{run.profile || "worker"}</strong><span>{run.outcome || run.status}</span></div><small>{relativeTime(run.startedAt)}</small>{run.summary && <p>{run.summary}</p>}{run.error && <p className="run-error">{run.error}</p>}</article>)}{!selectedTask.runs.length && <p>Brak prób wykonania.</p>}</section>
      <section><h3>Comments <span>{selectedTask.comments.length}</span></h3>{selectedTask.comments.map((comment) => <article className="comment" key={comment.id}><div><strong>{comment.author}</strong><small>{relativeTime(comment.createdAt)}</small></div><p>{comment.body}</p></article>)}{!selectedTask.comments.length && <p>Brak komentarzy.</p>}</section>
    </aside></div>}
  </div>;
}
