"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ActivityEvent, AgentSummary, DashboardSnapshot, DecisionRecord, IdeaRecord, TaskCard } from "@/lib/types";
import { applyTaskDeltas, mergeActivity, type ActivityEntry, type TaskDelta } from "@/lib/kanban-delta";
import { STATUSES } from "@/lib/types";
import { DndContext, type DragEndEvent, type DragOverEvent, type DragStartEvent, PointerSensor, TouchSensor, useSensor, useSensors } from "@dnd-kit/core";
import { ALLOWED_DROPS } from "@/lib/transitions";
import SearchModal from "./search-modal";
import { KanbanColumn } from "./kanban-column";
import SecurityPanel from "./security-panel";
import { copyText } from "@/lib/clipboard";
import { AnimatedNumber } from "./AnimatedNumber";
import { MissionClock } from "./MissionClock";
import { ThroughputChart } from "./ThroughputChart";
import { ActivityHeatmap } from "./ActivityHeatmap";
import type { TrendPoint, AgentActivityCell } from "@/lib/trends";

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

const ALLOWED_DROP_TARGETS = ALLOWED_DROPS;

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

type ViewMode = "overview" | "board" | "security";
type ToastItem = { id: number; text: string; kind: "info" | "success" | "warning" };

const SELECTED_BOARDS_KEY = "aoc_project";
let toastId = 0;

export default function Dashboard() {
  const [view, setView] = useState<ViewMode>("overview");
  const [data, setData] = useState<DashboardSnapshot | null>(null);
  const [liveTasks, setLiveTasks] = useState<TaskCard[] | null>(null);
  const [liveAgents, setLiveAgents] = useState<DashboardSnapshot["agents"] | null>(null);
  const [liveActivity, setLiveActivity] = useState<DashboardSnapshot["activity"] | null>(null);
  const [board, setBoard] = useState("");
  const [selectedTask, setSelectedTask] = useState<TaskCard | null>(null);
  const [agentFilter, setAgentFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const drawerRef = useRef<HTMLElement | null>(null);
  const drawerLastFocusRef = useRef<HTMLElement | null>(null);
  const [error, setError] = useState("");
  const [live, setLive] = useState(false);
  const [ideas, setIdeas] = useState<IdeaRecord[]>([]);
  const [ideaMessage, setIdeaMessage] = useState("");
  const [scorecard, setScorecard] = useState<{ slug: string; name: string; done7: number; done30: number; blocked7: number; blocked30: number; rework30: number; running: number; total: number; sessions30: number; tokens30: number; cost30: number | null }[] | null>(null);
  const [trends, setTrends] = useState<{ throughput: TrendPoint[]; agentActivity: AgentActivityCell[] } | null>(null);
  const [focusMode, setFocusMode] = useState(false);
  const [dense, setDense] = useState(false);

  useEffect(() => {
    document.body.classList.toggle("focus-mode", focusMode);
    return () => document.body.classList.remove("focus-mode");
  }, [focusMode]);
  useEffect(() => {
    document.body.classList.toggle("density-compact", dense);
    return () => document.body.classList.remove("density-compact");
  }, [dense]);

  /* Live-derived views: SSE deltas override the snapshot; full load() resyncs. */
  const tasks = liveTasks ?? data?.tasks ?? [];
  const agents = liveAgents ?? data?.agents ?? [];
  const activity = liveActivity ?? data?.activity ?? [];
  const tasksRef = useRef<TaskCard[]>(tasks);
  // eslint-disable-next-line react-hooks/refs -- latest-ref: read in event handlers (moveTask/submitDecision), render-time assignment is intentional
  tasksRef.current = tasks;
  /* Tick for render-time clocks (SLA badges) — pure render, refreshed each minute */
  const [nowSec, setNowSec] = useState(() => Date.now() / 1000);
  useEffect(() => { const t = setInterval(() => setNowSec(Date.now() / 1000), 60_000); return () => clearInterval(t); }, []);
  const [submittingIdea, setSubmittingIdea] = useState(false);
  const [decisions, setDecisions] = useState<DecisionRecord[]>([]);
  const [decisionComment, setDecisionComment] = useState("");
  const [decisionMessage, setDecisionMessage] = useState("");
  const [decisionBusy, setDecisionBusy] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  // ── Navigation scroll target (triggers after view render) ──
  const pendingScrollRef = useRef<string | null>(null);

  // ── DnD state ──
  const draggingTaskIdRef = useRef<string | null>(null); // event handlers + SSE guard (not render)
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null); // render-safe
  const [dragOverStatus, setDragOverStatus] = useState<TaskCard["status"] | null>(null);

  // ── Task Creator state ──
  const [creatorOpen, setCreatorOpen] = useState(false);
  const [creatorError, setCreatorError] = useState("");
  const [creatorBusy, setCreatorBusy] = useState(false);
  const creatorFormRef = useRef<HTMLFormElement | null>(null);
  const [creatorBoard, setCreatorBoard] = useState("");

  function addToast(text: string, kind: ToastItem["kind"] = "info") {
    const id = ++toastId;
    setToasts((prev) => [...prev.slice(-4), { id, text, kind }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000);
  }

  const scrollTo = useCallback((id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    const y = el.getBoundingClientRect().top + window.scrollY - 16;
    window.scrollTo({ top: y, behavior: "smooth" });
  }, []);

  // Scroll to target after view change — fires only when DOM is committed
  useEffect(() => {
    if (view !== "board" || !pendingScrollRef.current) return;
    const target = pendingScrollRef.current;
    pendingScrollRef.current = null;
    // rAF ensures browser has painted the new DOM, fallback setTimeout catches late layout
    requestAnimationFrame(() => { scrollTo(target); });
    const t = setTimeout(() => {
      const el = document.getElementById(target);
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (rect.top < 60 || rect.top > window.innerHeight - 60) {
        window.scrollTo({ top: rect.top + window.scrollY - 16, behavior: "auto" });
      }
    }, 180);
    return () => clearTimeout(t);
  }, [view, scrollTo]);

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
      setLiveTasks(snap.tasks); setLiveAgents(null); setLiveActivity(snap.activity);
      setSelectedTask((c) => c ? snap.tasks.find((t) => t.id === c.id) || null : null);
    } catch (e) {
      const msg = e instanceof DOMException && e.name === "AbortError" ? "Przekroczono czas połączenia — spróbuj ponownie." : e instanceof Error ? e.message : "Nie udało się pobrać danych";
      setError(msg);
    }
    finally { clearTimeout(timer); setLoading(false); setRefreshing(false); }
  }, []);

  const loadIdeas = useCallback(async () => {
    try { const r = await fetch("/api/ideas", { cache: "no-store" }); if (r.ok) setIdeas(((await r.json()) as { ideas: IdeaRecord[] }).ideas); } catch {}
  }, []);

  /* Agent scorecard — refresh on mount + every 60s while on the board view */
  useEffect(() => {
    let active = true;
    const fetchScorecard = () => {
      fetch("/api/scorecard", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => { if (active && j?.scorecard) setScorecard(j.scorecard); })
        .catch(() => {});
    };
    fetchScorecard();
    const timer = setInterval(() => { if (view === "board") fetchScorecard(); }, 60_000);
    return () => { active = false; clearInterval(timer); };
  }, [view]);

  useEffect(() => {
    let active = true;
    const fetchTrends = () => {
      fetch("/api/trends", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => { if (active && j?.throughput) setTrends(j); })
        .catch(() => {});
    };
    fetchTrends();
    const timer = setInterval(fetchTrends, 5 * 60_000);
    return () => { active = false; clearInterval(timer); };
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const slug = params.get("board") || undefined;
    const t = setTimeout(() => { void load(slug); void loadIdeas(); }, 0);
    return () => clearTimeout(t);
  }, [load, loadIdeas]);

  /* Live updates: SSE deltas applied in place — NO full snapshot reloads.
     Full load() only on: mount, board switch, reconnect (dropped flag), explicit refresh. */
  const dataRef = useRef(data);
  // eslint-disable-next-line react-hooks/refs -- latest-ref: read in SSE apply closures, render-time assignment is intentional
  dataRef.current = data;
  const droppedRef = useRef(false);
  useEffect(() => {
    if (view !== "board") return;
    const es = new EventSource("/api/events");
    const apply = (payload: { tasks?: TaskDelta[]; agents?: AgentSummary[]; activity?: ActivityEntry[] }) => {
      if (payload.tasks?.length) {
        setLiveTasks((prev) => applyTaskDeltas(prev ?? dataRef.current?.tasks ?? [], payload.tasks!));
      }
      if (payload.agents?.length) setLiveAgents(payload.agents);
      if (payload.activity?.length) {
        // Server entries are structurally ActivityEvent minus `payload` — the
        // feed render only reads kind/taskTitle/board/assignee/createdAt.
        setLiveActivity((prev) => mergeActivity(prev ?? dataRef.current?.activity ?? [], payload.activity as unknown as ActivityEvent[]));
      }
    };
    es.addEventListener("ready", () => {
      setLive(true);
      // Reconnect after a drop: resync with a full snapshot (rare — safe point).
      if (droppedRef.current) { droppedRef.current = false; void load(board); }
    });
    es.addEventListener("change", (ev) => {
      // Nie ruszaj boardu podczas przeciągania — zabezpiecza przed przerwaniem drag
      if (draggingTaskIdRef.current) return;
      try { apply(JSON.parse((ev as MessageEvent).data)); } catch { /* malformed frame */ }
      setLive(true);
    });
    es.addEventListener("presence", (ev) => {
      try {
        const p = JSON.parse((ev as MessageEvent).data);
        if (p?.agents?.length) setLiveAgents(p.agents);
      } catch { /* malformed frame */ }
      setLive(true);
    });
    es.addEventListener("source-error", () => setLive(false));
    es.onerror = () => { droppedRef.current = true; setLive(false); };
    return () => { setLive(false); es.close(); };
  }, [view, board, load]);

  /* Toast for new activity — derived from the live feed diff (no extra SSE) */
  const lastToastIdRef = useRef<number | null>(null);
  useEffect(() => {
    const latest = activity[0];
    if (!latest) return;
    if (lastToastIdRef.current !== null && lastToastIdRef.current !== latest.id) {
      addToast(`${latest.assignee || "System"} — ${eventSummary(latest)}: ${latest.taskTitle}`, latest.kind === "completed" ? "success" : latest.kind === "blocked" ? "warning" : "info");
    }
    lastToastIdRef.current = latest.id;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activity]);

  /* Keyboard shortcuts */
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") { e.preventDefault(); setSearchOpen(true); return; }
      if ((e.metaKey || e.ctrlKey) && e.key === "b") { e.preventDefault(); setView((v) => v === "board" ? "overview" : "board"); return; }
      if (e.key === "Escape") { if (creatorOpen) { setCreatorOpen(false); return; } if (selectedTask) { setSelectedTask(null); return; } }
      if (e.key === "?" && !e.ctrlKey && !e.metaKey && document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "TEXTAREA") { setSearchOpen(true); return; }
      // J/K — nawigacja po kartach decyzji (Vim-style) w overview
      if (view === "overview" && (e.key === "j" || e.key === "k" || e.key === "J" || e.key === "K") && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const tag = document.activeElement?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA") return;
        if (searchOpen || creatorOpen || selectedTask) return;
        const cards = [...document.querySelectorAll<HTMLElement>(".task-card.compact")];
        if (!cards.length) return;
        const idx = cards.findIndex((c) => c === document.activeElement);
        const next = e.key.toLowerCase() === "j" ? Math.min(idx + 1, cards.length - 1) : Math.max(idx - 1, 0);
        cards[next]?.focus();
        cards[next]?.scrollIntoView({ block: "nearest" });
        e.preventDefault();
        return;
      }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selectedTask, creatorOpen, searchOpen, view]);

  /* Move focus into the task drawer on open, restore it on close (dialog a11y) */
  useEffect(() => {
    if (selectedTask) {
      drawerLastFocusRef.current = document.activeElement as HTMLElement | null;
      const t = setTimeout(() => drawerRef.current?.focus(), 30);
      return () => clearTimeout(t);
    }
    drawerLastFocusRef.current?.focus?.();
  }, [selectedTask]);

  /* Lock page scroll while a dialog is open */
  useEffect(() => {
    const locked = !!(selectedTask || searchOpen || creatorOpen);
    document.body.style.overflow = locked ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [selectedTask, searchOpen, creatorOpen]);

  /* persist selected project boards */
  useEffect(() => {
    // Load persisted board preference on mount — run once
    if (typeof window === "undefined") return;
    try {
      const saved = window.localStorage.getItem(SELECTED_BOARDS_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as Record<string, string>;
        if (!board && parsed.workspace) {
          const u = new URL(window.location.href);
          u.searchParams.set("board", parsed.workspace);
          window.history.replaceState({}, "", u.toString());
        }
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    try { const saved = JSON.parse(window.localStorage.getItem(SELECTED_BOARDS_KEY) || "{}") as Record<string, string>; saved.workspace = slug; window.localStorage.setItem(SELECTED_BOARDS_KEY, JSON.stringify(saved)); } catch {}
    setView("board");
    setRefreshing(true); void load(slug);
  }, [load]);

  // Odpowiedzi filtrujemy po (board, taskId) i odrzucamy te, które dotyczą już
  // nieaktualnego zaznaczenia — inaczej wolniejszy fetch poprzedniej karty
  // nadpisywał historię aktualnej (komentarz "wyciekał" na inne zadania).
  const loadDecisions = useCallback(async (slug: string, taskId: string, isCurrent: () => boolean) => {
    try {
      const r = await fetch(`/api/decisions?board=${encodeURIComponent(slug)}&taskId=${encodeURIComponent(taskId)}`, { cache: "no-store" });
      if (!r.ok) return;
      const rows = ((await r.json()) as { decisions: DecisionRecord[] }).decisions || [];
      if (!isCurrent()) return;
      setDecisions(rows.filter((d) => d.taskId === taskId && d.board === slug));
    } catch {}
  }, []);

  const tid = selectedTask?.id;
  useEffect(() => {
    // Czyścimy przy zmianie karty — historia poprzedniego zadania
    // nie może być widoczna ani przez chwilę, ani gdy fetch się nie powiedzie.
    let active = true;
    const t = setTimeout(() => {
      if (!active) return;
      setDecisions([]);
      setDecisionComment("");
      setDecisionMessage("");
      if (tid) void loadDecisions(board, tid, () => active);
    }, 0);
    return () => { active = false; clearTimeout(t); };
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
        const rows = (((await h.json()) as { decisions: DecisionRecord[] }).decisions || [])
          .filter((d) => d.taskId === selectedTask.id && d.board === board);
        setDecisions(rows);
        const cur = rows.find((d) => d.id === j.id);
        if (cur?.status === "failed") throw new Error(cur.lastError || "Broker odrzucił");
        if (cur?.status === "done") {
          setDecisionMessage(`Gotowe: ${cur.fromStatus} → ${cur.resultStatus}.`);
          setDecisionComment("");
          const landed = cur.resultStatus;
          if (landed) {
            // Płynna lokalna aktualizacja karty — bez pełnego reloadu. SSE delta potwierdzi.
            setLiveTasks((prev) => applyTaskDeltas(prev ?? dataRef.current?.tasks ?? [], [{ id: selectedTask.id, status: landed, assignee: selectedTask.assignee, board: board, lastHeartbeatAt: null }]));
            setSelectedTask((c) => (c && c.id === selectedTask.id ? { ...c, status: landed } : c));
          }
          addToast(`Decyzja wykonana: ${selectedTask.id} ${cur.fromStatus}→${cur.resultStatus}`, "success");
          break;
        }
        if (i === 5) { setDecisionMessage("Decyzja w toku — sprawdź historię za chwilę."); addToast("Decyzja nadal przetwarzana przez brokera", "info"); }
      }
    } catch (e) { setDecisionMessage(e instanceof Error ? e.message : "Błąd"); }
    finally { setDecisionBusy(false); }
  }

  // ── DnD: move task via API ──
  async function moveTask(taskId: string, fromStatus: string, toStatus: string) {
    if (!data) return;
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;
    const bn = data.boards.find((b) => b.slug === board)?.name || board;
    if (!confirm(`Przenieść ${task.id} (${task.title}) z ${statusLabel[fromStatus] || fromStatus} do ${statusLabel[toStatus] || toStatus} na boardzie ${bn}?`)) return;
    try {
      const r = await fetch("/api/tasks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ board, taskId: task.id, targetStatus: toStatus }),
      });
      const j = await r.json() as { id?: string; error?: string };
      if (!r.ok) throw new Error(j.error || "Błąd");
      addToast(`Przenoszenie ${task.id} ${statusLabel[fromStatus] || fromStatus}→${statusLabel[toStatus] || toStatus} — broker przetwarza…`, "info");

      // Czekamy na faktyczny wynik brokera zamiast zakładać, że karta wyląduje
      // w kolumnie docelowej. Hermes potrafi po `specify` od razu auto-promować
      // todo → ready, więc prawdziwy status znamy dopiero z rekordu ruchu.
      let settled = false;
      for (let i = 0; i < 8; i++) {
        await new Promise((resolve) => setTimeout(resolve, 1200));
        let row: { status?: string; resultStatus?: string | null; lastError?: string | null } | undefined;
        try {
          const h = await fetch(`/api/tasks?board=${encodeURIComponent(board)}&taskId=${encodeURIComponent(task.id)}`, { cache: "no-store" });
          if (h.ok) {
            const moves = ((await h.json()) as { moves?: Array<{ id: string; status: string; resultStatus: string | null; lastError: string | null }> }).moves || [];
            row = moves.find((m) => m.id === j.id);
          }
        } catch {}
        if (!row) continue;
        if (row.status === "failed") { settled = true; throw new Error(row.lastError || "Broker odrzucił przeniesienie"); }
        if (row.status === "done") {
          settled = true;
          const landed = row.resultStatus || toStatus;
          // Płynna lokalna aktualizacja — bez pełnego reloadu. SSE delta potwierdzi.
          setLiveTasks((prev) => applyTaskDeltas(prev ?? dataRef.current?.tasks ?? [], [{ id: task.id, status: landed, assignee: task.assignee, board: board, lastHeartbeatAt: null }]));
          setSelectedTask((c) => (c && c.id === task.id ? { ...c, status: landed } : c));
          if (landed !== toStatus) {
            addToast(`${task.id}: Hermes przeniósł dalej — karta jest w ${statusLabel[landed] || landed} (auto-promocja z ${statusLabel[toStatus] || toStatus}).`, "info");
          } else {
            addToast(`${task.id} → ${statusLabel[landed] || landed}`, "success");
          }
          break;
        }
      }
      if (!settled) { addToast("Ruch nadal przetwarzany przez brokera — karta zaktualizuje się sama.", "info"); }
    } catch (e) { addToast(e instanceof Error ? e.message : "Błąd przenoszenia", "warning"); }
  }

  // ── Task Creator: submit ──
  async function submitNewTask(ev: React.FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    if (!creatorFormRef.current) return;
    setCreatorBusy(true); setCreatorError("");
    const fd = new FormData(creatorFormRef.current);
    const targetBoard = fd.get("board") as string;
    const title = fd.get("title") as string;
    const body = fd.get("description") as string;
    const priority = Number(fd.get("priority"));
    try {
      const r = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ board: targetBoard, title, body, priority }),
      });
      const j = await r.json() as { id?: string; error?: string };
      if (!r.ok) throw new Error(j.error || "Błąd");
      setCreatorOpen(false);
      creatorFormRef.current.reset();
      addToast(`Zadanie ${title.slice(0, 40)} utworzone — broker przetwarza…`, "success");
      await new Promise((resolve) => setTimeout(resolve, 1500));
      if (targetBoard === board) await load(board); // nowa karta pojawia się tylko w pełnym snapshotcie
      void loadIdeas();
    } catch (e) { setCreatorError(e instanceof Error ? e.message : "Błąd"); }
    finally { setCreatorBusy(false); }
  }

  // ── DnD handlers (@dnd-kit) ──
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } })
  );

  function handleDragStart(event: DragStartEvent) {
    draggingTaskIdRef.current = String(event.active.id);
    setDraggingTaskId(String(event.active.id));
    setDragOverStatus(null);
  }

  function handleDragOver(event: DragOverEvent) {
    const overId = event.over?.id;
    const overStatus = overId ? String(overId) : null;
    if (overStatus && (STATUSES as readonly string[]).includes(overStatus)) {
      setDragOverStatus(overStatus as TaskCard["status"]);
    } else if (overStatus) {
      // over a sortable item — derive its column
      const task = tasksRef.current.find((t) => t.id === overStatus);
      if (task) setDragOverStatus(task.status);
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    draggingTaskIdRef.current = null;
    setDraggingTaskId(null);
    setDragOverStatus(null);
    if (!over || !data) return;

    const taskId = String(active.id);
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;

    let toStatus: TaskCard["status"] | null = null;
    const overId = String(over.id);
    if ((STATUSES as readonly string[]).includes(overId)) {
      toStatus = overId as TaskCard["status"];
    } else {
      const overTask = tasks.find((t) => t.id === overId);
      if (overTask) toStatus = overTask.status;
    }

    if (!toStatus || toStatus === task.status) return;
    if (!(ALLOWED_DROP_TARGETS[task.status] || []).includes(toStatus)) return;

    // Optimistic update
    setData((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        tasks: prev.tasks.map((t) => (t.id === taskId ? { ...t, status: toStatus as TaskCard["status"] } : t)),
      };
    });

    void moveTask(taskId, task.status, toStatus);
  }

  function toggleCol(status: string) { setCollapsed((prev) => { const n = new Set(prev); if (n.has(status)) n.delete(status); else n.add(status); return n; }); }

  const tasksPerAgent = useMemo(() => {
    if (!data) return new Map<string, { total: number; running: number; blocked: number }>();
    const m = new Map<string, { total: number; running: number; blocked: number }>();
    for (const t of tasks) {
      if (!t.assignee) continue;
      const e = m.get(t.assignee) || { total: 0, running: 0, blocked: 0 };
      e.total++;
      if (t.status === "running") e.running++;
      if (t.status === "blocked") e.blocked++;
      m.set(t.assignee, e);
    }
    return m;
  }, [data]);

  const visibleTasks = useMemo(() => tasks.filter((t) => agentFilter === "all" || t.assignee === agentFilter), [tasks, agentFilter]);
  const active = agents.filter((a) => a.status === "working").length || 0;
  const blockedCount = data?.boards.reduce((s, b) => s + (b.counts.blocked || 0), 0) || 0;
  const pendingDecisions = data?.boards.reduce((s, b) => s + (b.counts.blocked || 0) + (b.counts.scheduled || 0), 0) || 0;

  const isMobile = typeof window !== "undefined" && window.innerWidth < 768;

  if (loading) return <main className="center-state skeleton-screen"><div className="metric-grid"><div className="skeleton skeleton-metric" /><div className="skeleton skeleton-metric" /><div className="skeleton skeleton-metric" /><div className="skeleton skeleton-metric" /></div><div className="skeleton-list"><div className="skeleton skeleton-card" /><div className="skeleton skeleton-card" /><div className="skeleton skeleton-card" /></div></main>;
  if (error || !data) return <main className="center-state"><div className="error-mark">!</div><h1>Brak danych</h1><p>{error}</p><button onClick={() => load(board)}>Spróbuj ponownie</button></main>;

  return <div className="app-shell">
    <SearchModal open={searchOpen} onClose={() => setSearchOpen(false)} data={data} board={board} onSelectBoard={selectBoard} onSelectTask={setSelectedTask} actions={[
      { label: "Przejdź do Kanbanu", icon: "⌁", hint: "Board", onRun: () => { pendingScrollRef.current = "board"; setView("board"); } },
      { label: "Nowe zadanie", icon: "＋", hint: "Utwórz", onRun: () => { setCreatorBoard(board); setCreatorOpen(true); } },
      { label: focusMode ? "Wyłącz tryb focus" : "Włącz tryb focus", icon: "◎", hint: "Pełny ekran boardu", onRun: () => setFocusMode((f) => !f) },
      { label: dense ? "Gęstość: normalna" : "Gęstość: kompaktowa", icon: "▤", hint: "Zagęść widok", onRun: () => setDense((d) => !d) },
      { label: "Audyt (dziennik)", icon: "⚿", hint: "Bezpieczeństwo", onRun: () => setView("security") },
    ]} />

    <div className="toast-container" aria-live="polite">
      {toasts.map((toast) => <div key={toast.id} className={`toast ${toast.kind}`}>{toast.text}</div>)}
    </div>

    {/* ── Task Creator modal ── */}
    {creatorOpen && <div className="creator-backdrop" onMouseDown={(ev) => { if (ev.currentTarget === ev.target) setCreatorOpen(false); }}>
      <div className="creator-modal">
        <h2>Nowe zadanie</h2>
        <form ref={creatorFormRef} onSubmit={submitNewTask}>
          <label><span>Projekt / board</span>
            <select name="board" required defaultValue={creatorBoard || board} onChange={(ev) => setCreatorBoard(ev.target.value)}>
              {data.boards.filter((b) => !["default", "portfolio"].includes(b.slug)).map((b) => <option value={b.slug} key={b.slug}>{b.name}</option>)}
            </select>
          </label>
          <label><span>Tytuł</span><input name="title" minLength={3} maxLength={160} required placeholder="Np. dodaj endpoint REST dla raportów" /></label>
          <label><span>Opis</span><textarea name="description" minLength={10} maxLength={6000} required rows={5} placeholder="Co należy zrobić? Jakie są kryteria sukcesu?" /></label>
          <label><span>Priorytet</span>
            <select name="priority" defaultValue="2">
              <option value="1">P1 — niski</option><option value="2">P2 — normalny</option><option value="3">P3 — wysoki</option><option value="4">P4 — krytyczny</option>
            </select>
          </label>
          {creatorError && <p className="creator-error">{creatorError}</p>}
          <div className="creator-actions">
            <button type="button" onClick={() => setCreatorOpen(false)}>Anuluj</button>
            <button className="primary" type="submit" disabled={creatorBusy}>{creatorBusy ? "Tworzenie…" : "Utwórz zadanie"}</button>
          </div>
        </form>
      </div>
    </div>}

    <aside className="sidebar" aria-label="Panel boczny">
      <div className="brand"><span className="brand-mark">A</span><div><strong>Agent Ops</strong><small>Mission Control</small></div></div>
      <nav aria-label="Główna nawigacja">
        <button className={`nav-item ${view === "overview" ? "active" : ""}`} onClick={() => setView("overview")}><span>◎</span> Overview <kbd>⌃B</kbd></button>
        <button className={`nav-item ${view === "board" ? "active" : ""}`} onClick={() => { if (view === "board") scrollTo("board"); else { pendingScrollRef.current = "board"; setView("board"); } }}><span>⌁</span> Board</button>
        <button className="nav-item" onClick={() => { if (view === "board") scrollTo("inbox"); else { pendingScrollRef.current = "inbox"; setView("board"); } }}><span>＋</span> CEO Inbox</button>
        <button className="nav-item" onClick={() => { if (view === "board") scrollTo("agents"); else { pendingScrollRef.current = "agents"; setView("board"); } }}><span>◎</span> Agents</button>
        <button className="nav-item" onClick={() => setSearchOpen(true)}><span>⌕</span> Search <kbd>⌘K</kbd></button>
        <button className={`nav-item ${view === "security" ? "active" : ""}`} onClick={() => setView("security")}><span>⚿</span> Audyt</button>
      </nav>
      <div className="sidebar-foot">
        <div className="sidebar-activity">
          {activity.slice(0, 3).map((ev) => <div key={`${ev.board}-${ev.id}`} className="sidebar-event" onClick={() => { if (ev.board !== board) selectBoard(ev.board); setTimeout(() => setSelectedTask(tasks.find((t) => t.id === ev.taskId) || null), 50); }}>
            <span className={`event-dot ${ev.kind}`} /><small>{ev.assignee || "System"}: {eventSummary(ev)}</small>
          </div>)}
        </div>
        <div className="sidebar-status"><span className="system-dot" /><div><strong>Hermes online</strong><small>{data.boards.length} boardy · {agents.length} agentów</small></div></div>
      </div>
    </aside>

    {/* --- OVERVIEW --- */}
    {view === "overview" && <main className="main-content" id="overview">
      <header className="topbar"><div><p className="eyebrow">AGENT OPERATIONS CENTER</p><h1>Overview</h1></div><div className="top-actions"><MissionClock /><span className="shortcut-hint"><kbd>⌘K</kbd> search — <kbd>⌘B</kbd> board</span></div></header>
      <section className="metric-grid" aria-label="Kluczowe metryki">
        <article><span>Aktywni agenci</span><strong><AnimatedNumber value={active} /><small> / {agents.length}</small></strong><i className="metric-line blue" /></article>
        <article><span>Wymagają decyzji</span><strong><AnimatedNumber value={pendingDecisions} /></strong><i className="metric-line red" /></article>
        <article><span>Zadania w toku</span><strong><AnimatedNumber value={data.boards.reduce((s, b) => s + (b.counts.running || 0), 0)} /></strong><i className="metric-line violet" /></article>
        <article><span>Ukończone</span><strong><AnimatedNumber value={data.boards.reduce((s, b) => s + (b.counts.done || 0), 0)} /></strong><i className="metric-line green" /></article>
      </section>
      {trends && <section className="trends-panel" aria-label="Trendy">
        <div className="section-head"><div><p className="eyebrow">TRENDY</p><h2>Przepustowość — 30 dni</h2></div><span className="updated">odświeżanie co 5 min</span></div>
        <ThroughputChart data={trends.throughput} />
        <div className="section-head" style={{ marginTop: 18 }}><div><p className="eyebrow">AKTYWNOŚĆ</p><h2>Agentów — 12 tygodni</h2></div></div>
        <ActivityHeatmap data={trends.agentActivity} agents={agents} />
      </section>}
      <section className="quick-actions">
        <button className="action-btn primary" onClick={() => { pendingScrollRef.current = "board"; setView("board"); }}>Przejdź do Kanbanu</button>
        <button className="action-btn" onClick={() => { pendingScrollRef.current = "inbox"; setView("board"); }}>CEO Inbox</button>
        <button className="action-btn" onClick={() => setSearchOpen(true)}>Szukaj <kbd>⌘K</kbd></button>
        <button className="action-btn" onClick={() => { setCreatorBoard(board); setCreatorOpen(true); }}>＋ Nowe zadanie</button>
      </section>
      <section className="overview-grid">
        <div>
          <div className="section-head"><div><p className="eyebrow">DECYZJE</p><h2>Wymagające uwagi</h2></div></div>
          {tasks.filter((t) => ["blocked", "scheduled"].includes(t.status)).sort((a, b) => (a.startedAt || a.createdAt) - (b.startedAt || b.createdAt)).slice(0, 6).map((t) => {
            const ageH = Math.floor((nowSec - (t.startedAt || t.createdAt)) / 3600);
            return <button key={t.id} className="task-card compact" onClick={() => { setView("board"); setTimeout(() => { selectBoard(t.boardSlug); setTimeout(() => setSelectedTask(t), 100); }, 50); }}>
            <div className="task-meta"><code>{t.id}</code><span className={`status-badge ${t.status}`}>{t.status}</span><span className={`sla-badge ${ageH >= 48 ? "overdue" : ageH >= 24 ? "warn" : ""}`}>{ageH >= 24 ? `${Math.floor(ageH / 24)}d ${ageH % 24}h` : `${ageH}h`}</span></div><h3>{t.title}</h3><footer>{t.boardSlug} · {t.assignee || "unassigned"}</footer>
          </button>;
          })}
          {tasks.filter((t) => ["blocked", "scheduled"].includes(t.status)).length === 0 && <p className="empty-state">Wszystkie zadania są odblokowane. Świetnie!</p>}
        </div>
        <div>
          <div className="section-head"><div><p className="eyebrow">OSTATNIA AKTYWNOŚĆ</p><h2>Live feed</h2></div></div>
          {activity.slice(0, 8).map((ev) => <article key={`${ev.board}-${ev.id}`} className="activity-row">
            <span className={`activity-dot ${ev.kind}`} /><div><p><strong>{ev.assignee || "System"}</strong> {eventSummary(ev)}</p><button onClick={() => { if (ev.board !== board) selectBoard(ev.board); setTimeout(() => setSelectedTask(tasks.find((t) => t.id === ev.taskId) || null), 50); }}>{ev.taskTitle}</button><small>{ev.board} · {relativeTime(ev.createdAt)}</small></div>
          </article>)}
        </div>
      </section>
    </main>}

    {/* --- BOARD --- */}
    {view === "security" && <main className="main-content" id="security"><SecurityPanel /></main>}

    {view === "board" && <main className="main-content" id="board">
      <header className="topbar">
        <div><p className="eyebrow">OPERATIONS / LIVE</p><h1>Command Center</h1></div>
        <div className="top-actions"><span className={`live-pill ${live ? "" : "offline"}`}><i /> {live ? "LIVE" : "RECONNECTING"}</span>{refreshing && <span className="refreshing" role="status">Odświeżam…</span>}<span className="updated">Aktualizacja {new Date(data.generatedAt).toLocaleTimeString("pl-PL")}</span></div>
      </header>

      <section className="metric-grid" aria-label="Podsumowanie">
        <article><span>Aktywni agenci</span><strong><AnimatedNumber value={active} /><small> / {agents.length}</small></strong><i className="metric-line blue" /></article>
        <article><span>Zadania w toku</span><strong><AnimatedNumber value={data.boards.reduce((s, b) => s + (b.counts.running || 0), 0)} /></strong><i className="metric-line violet" /></article>
        <article><span>Wymaga uwagi</span><strong><AnimatedNumber value={blockedCount} /></strong><i className="metric-line red" /></article>
        <article><span>Ukończone</span><strong><AnimatedNumber value={data.boards.reduce((s, b) => s + (b.counts.done || 0), 0)} /></strong><i className="metric-line green" /></article>
      </section>

      <section className="project-strip" aria-label="Projekty">
        {data.boards.map((item) => <button key={item.slug} className={`project-chip ${board === item.slug ? "selected" : ""}`} onClick={() => selectBoard(item.slug)}>
          <span className="project-icon">{item.icon}</span><span><strong>{item.name}</strong><small>{item.counts.running || 0} active · {item.counts.blocked || 0} blocked</small></span>
        </button>)}
      </section>

      <section className="inbox-panel" id="inbox">
        <div className="section-head"><div><p className="eyebrow">CEO WORKSPACE</p><h2>CEO Inbox</h2></div><span className="secure-write">Authelia</span></div>
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
        <div className="agent-grid">{agents.map((agent) => {
          const wl = tasksPerAgent.get(agent.slug);
          return <button key={agent.slug} onClick={() => setAgentFilter(agentFilter === agent.slug ? "all" : agent.slug)} className={`agent-card ${agent.status} ${agentFilter === agent.slug ? "selected" : ""}`}>
            <div className="agent-avatar">{roleIcon[agent.slug] || "◇"}<span /></div>
            <div className="agent-copy"><strong>{agent.name}</strong><small>{agent.status === "working" ? agent.currentTask : agent.status === "blocked" ? `${agent.blocked} blocked` : "Dostępny"}{wl && ` · ${wl.running || 0} active / ${wl.total || 0} total`}</small></div>
            <span className="agent-state" title={`${wl?.total || 0} zadań ogółem, ${wl?.running || 0} w toku, ${wl?.blocked || 0} zablokowanych`}>{agent.status}</span>
          </button>;
        })}</div>
        {scorecard && scorecard.length > 0 && <div className="scorecard" aria-label="Wyniki agentów (30 dni)">
          <div className="section-head"><div><p className="eyebrow">DELIVERY METRICS</p><h2>Scorecard — 30 dni</h2></div><span className="updated">odświeżanie co 60s</span></div>
          <div className="scorecard-table">
            {scorecard.map((row) => {
              const max = Math.max(...scorecard.map((r) => r.done30), 1);
              return <div className="scorecard-row" key={row.slug}>
                <span className="scorecard-name" title={row.slug}>{row.name}</span>
                <span className="scorecard-bar"><i style={{ width: `${Math.round((row.done30 / max) * 100)}%` }} /></span>
                <span className="scorecard-nums"><b title="ukończone 7d/30d">{row.done7}/{row.done30}</b><em title="zablokowane 7d/30d">⚑ {row.blocked7}/{row.blocked30}</em>{row.rework30 > 0 && <em className="rework" title="zadania ukończone ponownie (rework)">↻ {row.rework30}</em>}<em title="w toku / ogółem">◉ {row.running}/{row.total}</em>{row.cost30 != null && <em className="cost" title={`${row.sessions30} sesji kanban · ${row.tokens30.toLocaleString("pl-PL")} tokenów (30 dni)`}>{row.cost30 > 0 ? `≈ $${row.cost30.toFixed(2)}` : `${(row.tokens30 / 1e6).toFixed(1)}M tok`}</em>}</span>
              </div>;
            })}
          </div>
        </div>}
      </section>

      <div className="workspace-grid">
        <section className="board-panel">
          <div className="section-head">
            <div><p className="eyebrow">{board.toUpperCase()}</p><h2>Delivery board</h2></div>
            <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
              <button className="new-task-btn" onClick={() => { setCreatorBoard(board); setCreatorOpen(true); }}>＋ Nowe zadanie</button>
              <span className="secure-write">Authelia</span>
            </div>
          </div>
          {isMobile && <p className="mobile-hint">Dotknij nagłówka kolumny, aby ją zwinąć. Dotknij karty, aby zobaczyć szczegóły. Przeciąganie kart działa na desktopie.</p>}
          <div className="kanban-scroll">
            <DndContext
              sensors={sensors}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDragEnd={handleDragEnd}
            >
              <div className="kanban-board">
                {STATUSES.map((status) => {
                  const tasks = visibleTasks.filter((t) => t.status === status);
                  const isCollapsed = collapsed.has(status);
                  const draggingTask = tasks.find((t) => t.id === draggingTaskId);
                  const isInvalidDrop = Boolean(
                    dragOverStatus === status && draggingTask && !(ALLOWED_DROP_TARGETS[draggingTask.status] || []).includes(status)
                  );

                  return (
                    <KanbanColumn
                      key={status}
                      status={status}
                      statusLabel={statusLabel[status]}
                      statusHelp={statusHelp[status]}
                      tasks={tasks}
                      isCollapsed={isCollapsed}
                      isMobile={isMobile}
                      isInvalidDrop={isInvalidDrop}
                      onToggle={() => toggleCol(status)}
                      onSelectTask={setSelectedTask}
                      onApproveTask={(task) => {
                        setSelectedTask(task);
                        setTimeout(() => { setDecisionComment(""); void submitDecision("approve"); }, 100);
                      }}
                      onCopyId={(id, ok) => addToast(ok ? `Skopiowano ${id}` : `Nie udało się skopiować ${id}`, ok ? "success" : "warning")}
                    />
                  );
                })}
              </div>
            </DndContext>
          </div>
        </section>

        <aside className="activity-panel" id="activity" aria-label="Aktywność na żywo"><div className="section-head"><div><p className="eyebrow">EVENT STREAM</p><h2>Live activity</h2></div><span className="pulse" /></div><div className="activity-list" aria-live="polite">
          {activity.map((event) => <article key={`${event.board}-${event.id}`}><div className={`activity-icon ${event.kind}`}>{event.kind === "completed" ? "✓" : event.kind === "blocked" ? "!" : "·"}</div><div><p><strong>{event.assignee || "System"}</strong> {eventSummary(event)}</p><button onClick={() => { if (event.board !== board) { selectBoard(event.board); } else { setSelectedTask(tasks.find((t) => t.id === event.taskId) || null); } }}>{event.taskTitle}</button><small>{event.board} · {relativeTime(event.createdAt)}</small></div></article>)}
          {!activity.length && <div className="empty-activity"><span>⌁</span><p>Zdarzenia pojawią się, gdy zespół rozpocznie pracę.</p></div>}
        </div></aside>
      </div>
    </main>}

    {/* --- DRAWER --- */}
    {selectedTask && <div className="drawer-backdrop" onMouseDown={(e) => { if (e.currentTarget === e.target) setSelectedTask(null); }}><aside className="task-drawer" role="dialog" aria-modal="true" aria-labelledby="task-title" ref={drawerRef} tabIndex={-1}>
      <header><div><button type="button" className="task-id-copy" title={`Kliknij, aby skopiować ${selectedTask.id}`} aria-label={`Kopiuj identyfikator zadania ${selectedTask.id}`} onClick={() => { void copyText(selectedTask.id).then((ok) => addToast(ok ? `Skopiowano ${selectedTask.id}` : `Nie udało się skopiować ${selectedTask.id}`, ok ? "success" : "warning")); }}><code>{selectedTask.id}</code><i aria-hidden="true">⧉</i></button><span className={`status-badge ${selectedTask.status}`} title={statusHelp[selectedTask.status] || ""}>{selectedTask.status}</span></div><button aria-label="Zamknij" onClick={() => setSelectedTask(null)}>×</button></header>
      <h2 id="task-title">{selectedTask.title}</h2>
      <p className="task-body">{selectedTask.body || "Brak opisu."}</p>

      <section className="decision-box"><h3>Decyzja CEO</h3>
        <p>Akcja dotyczy tylko tej karty. PM decyduje, który agent podejmie dalszą pracę.</p>
        <textarea value={decisionComment} onChange={(ev) => setDecisionComment(ev.target.value)} maxLength={2000} rows={3} placeholder={selectedTask.status === "blocked" ? "Komentarz (opcjonalny)" : "Powód"} />
        <div className="decision-actions">
          {/* Accept — available for statuses that need CEO approval to move forward */}
          {["triage", "blocked", "scheduled"].includes(selectedTask.status) && <button className="approve" disabled={decisionBusy} onClick={() => void submitDecision("approve")}>{decisionBusy ? "…" : selectedTask.status === "triage" ? "Akceptuj → Todo" : selectedTask.status === "scheduled" ? "Akceptuj → Ready" : "Akceptuj i odblokuj"}</button>}
          {/* Reject — available for all statuses where CEO can kill the task */}
          {["triage", "todo", "scheduled", "blocked", "ready", "running"].includes(selectedTask.status) && <button className="reject" disabled={decisionBusy} onClick={() => void submitDecision("reject")}>Odrzuć</button>}
          {/* Hold / Block — available for active statuses that can be frozen */}
          {["triage", "todo", "scheduled", "ready", "running"].includes(selectedTask.status) && <button disabled={decisionBusy} onClick={() => void submitDecision("hold")}>Zablokuj</button>}
        </div>
        {selectedTask.status === "review" && <p className="decision-note">Status review wymaga natywnego workflow PM/reviewera — tu nie można go zatwierdzić.</p>}
        {selectedTask.status === "done" && <p className="decision-note">Zadanie jest już zakończone — decyzje CEO nie są potrzebne.</p>}
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
