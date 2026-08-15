#!/usr/bin/env node
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const boardsDir = "/root/.hermes/kanban/boards";
const HOUR = 3600;

function listBoards() {
  const slugs = [];
  if (fs.existsSync(boardsDir)) {
    for (const slug of fs.readdirSync(boardsDir).sort()) {
      if (slug.startsWith("_") || slug.includes("..") || !fs.statSync(path.join(boardsDir, slug)).isDirectory()) continue;
      if (fs.existsSync(path.join(boardsDir, slug, "kanban.db"))) slugs.push(slug);
    }
  }
  return slugs;
}

function openReadOnly(dbPath) {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  db.pragma("query_only = ON");
  return db;
}

function blockedNeedsInput(board) {
  const dbPath = path.join(boardsDir, board, "kanban.db");
  const db = openReadOnly(dbPath);
  try {
    const taskRows = db.prepare(`
      SELECT id, title, body, assignee, status, priority, created_at, started_at, block_kind, block_recurrences
      FROM tasks
      WHERE status = 'blocked' AND block_kind = 'needs_input'
      ORDER BY priority DESC, created_at DESC
    `).all();

    const runRows = db.prepare(`
      SELECT task_id, summary FROM task_runs
      WHERE outcome = 'blocked' OR status = 'blocked'
      ORDER BY id DESC
    `).all();

    const summaryByTask = new Map();
    for (const r of runRows) {
      const taskId = String(r.task_id);
      if (!summaryByTask.has(taskId) && r.summary) summaryByTask.set(taskId, String(r.summary));
    }

    const commentRows = db.prepare(`
      SELECT task_id, author, body, created_at FROM task_comments
      ORDER BY created_at DESC
    `).all();

    const commentsByTask = new Map();
    for (const c of commentRows) {
      const taskId = String(c.task_id);
      if (!commentsByTask.has(taskId)) commentsByTask.set(taskId, []);
      commentsByTask.get(taskId).push({
        author: String(c.author),
        body: String(c.body || ""),
        createdAt: Number(c.created_at),
      });
    }

    return taskRows.map((r) => ({
      id: String(r.id),
      title: String(r.title),
      body: String(r.body || ""),
      assignee: r.assignee == null ? null : String(r.assignee),
      status: String(r.status),
      priority: Number(r.priority || 0),
      createdAt: Number(r.created_at),
      startedAt: r.started_at == null ? null : Number(r.started_at),
      blockKind: r.block_kind == null ? null : String(r.block_kind),
      latestSummary: summaryByTask.get(String(r.id)) || "",
      comments: commentsByTask.get(String(r.id)) || [],
    }));
  } finally { db.close(); }
}

function ageHours(task) {
  const now = Math.floor(Date.now() / 1000);
  const ref = task.startedAt || task.createdAt || now;
  return Math.max(0, Math.floor((now - ref) / HOUR));
}

function priorityEmoji(hours) {
  if (hours >= 5 * 24) return "🔴";
  if (hours >= 2 * 24) return "🟡";
  return "🟢";
}

function normalize(text = "") {
  return text
    .replace(/\r/g, "")
    .replace(/#{1,6}\s*/g, "")
    .replace(/\*\*/g, "")
    .replace(/__/g, "")
    .replace(/`([^`]+)`/g, "$1");
}

function extractQuestion(text = "") {
  const plain = normalize(text);
  const lines = plain.split(/\n/).map((l) => l.trim()).filter(Boolean);

  // Look for explicit decision asks first
  for (const line of lines) {
    if (/^(decyzja|pytanie|wybierz|któr[ąy]|jaką|jakiego|czy |co wybierasz|co zrobić|jak postąpić|jaką opcję|na co się decydujesz)/i.test(line)) {
      return line.replace(/^decyzja[:\s]*/i, "").slice(0, 140);
    }
  }

  // Look for lines ending with question mark
  for (const line of lines) {
    if (line.endsWith("?") && line.length > 15 && line.length < 140) return line.slice(0, 140);
  }

  // Look for "OPCJE DECYZYJNE" / "DECYZJA" / "DECYZJA (wybierz)" sections
  const optionHeaderIdx = lines.findIndex((l) => /^(OPCJE DECYZYJNE|DECYZJA|do podjęcia)/i.test(l));
  if (optionHeaderIdx > 0) {
    const candidate = lines[optionHeaderIdx - 1];
    if (candidate.length > 10 && candidate.length < 140) return candidate.slice(0, 140);
  }

  // Fallback: first substantive line that isn't a markdown heading remnant or option
  for (const line of lines) {
    if (!/^\s*[-•*\d]/.test(line) && !/^[A-E][).]/.test(line) && line.length > 15 && line.length < 140) {
      return line.slice(0, 140);
    }
  }
  return "Wymagana decyzja CEO — szczegóły na karcie.";
}

function extractOptions(text = "") {
  const plain = normalize(text);
  const options = [];

  // 1. Try A) B) C) or A. B. C.
  const letterMatches = plain.matchAll(/(?:^|\n)\s*\(?([A-Ea-e][).])\)?\s*([^\n]+)/g);
  for (const m of letterMatches) {
    const label = m[1].toUpperCase();
    const value = m[2].trim().slice(0, 120);
    if (value.length < 5) continue;
    options.push({ label, value });
  }

  // 2. Try numbered options if no letters found, and map to A/B/C
  if (!options.length) {
    const numericMatches = plain.matchAll(/(?:^|\n)\s*(\d+)[).]\s*([^\n]+)/g);
    const usedLabels = ["A", "B", "C", "D", "E"];
    let i = 0;
    for (const m of numericMatches) {
      if (i >= usedLabels.length) break;
      const value = m[2].trim().slice(0, 120);
      if (value.length < 5) continue;
      options.push({ label: usedLabels[i++], value });
    }
  }

  return options.slice(0, 5);
}

function extractRecommendation(text = "") {
  const plain = normalize(text);
  const m = plain.match(/rekomendacja[:\s]+([^\n]+)/i);
  if (m) return m[1].trim().slice(0, 120);
  return null;
}

function buildDecisionText(task) {
  // Prefer the PM's own blocked-run summary (already condensed), then comments, then body
  const sources = [];
  if (task.latestSummary) sources.push(task.latestSummary);
  if (task.comments?.length) {
    const decisionComments = task.comments
      .filter((c) => /pm|reviewer|default/i.test(c.author))
      .sort((a, b) => b.createdAt - a.createdAt);
    for (const c of decisionComments) sources.push(c.body);
  }
  sources.push(task.body);

  let bestQuestion = null;
  let bestOptions = [];
  let bestRecommendation = null;

  for (const src of sources) {
    if (!src) continue;
    const q = extractQuestion(src);
    if (!bestQuestion || (bestQuestion === "Wymagana decyzja CEO — szczegóły na karcie." && q !== bestQuestion)) {
      bestQuestion = q;
    }
    if (!bestOptions.length) {
      bestOptions = extractOptions(src);
    }
    if (!bestRecommendation) {
      bestRecommendation = extractRecommendation(src);
    }
    if (bestQuestion && bestQuestion !== "Wymagana decyzja CEO — szczegóły na karcie." && bestOptions.length && bestRecommendation) break;
  }

  // If summary gave a good question but comments gave better options, prefer comment options
  const commentOptions = [];
  for (const c of task.comments || []) {
    if (/pm|reviewer|default/i.test(c.author)) {
      const opts = extractOptions(c.body);
      if (opts.length > commentOptions.length) commentOptions.push(...opts);
    }
  }
  if (commentOptions.length > bestOptions.length) bestOptions = commentOptions.slice(0, 5);

  return { question: bestQuestion || "Wymagana decyzja CEO — szczegóły na karcie.", options: bestOptions, recommendation: bestRecommendation };
}

function boardUrl(slug, taskId) {
  return `https://agents.paterski.com/decisions?board=${slug}&task=${taskId}`;
}

function formatDigest(tasksByBoard) {
  const all = [];
  for (const [board, tasks] of tasksByBoard) {
    for (const t of tasks) all.push({ ...t, board, hours: ageHours(t) });
  }
  all.sort((a, b) => b.hours - a.hours);

  if (!all.length) return { text: "📋 CEO Decision Digest — brak oczekujących decyzji.\n\nWszystkie karty są odblokowane.", count: 0 };

  const oldest = all[0].hours;
  const critical = all.filter((t) => t.hours >= 5 * 24).length;

  let text = `📋 CEO Decision Digest — ${new Date().toLocaleDateString("pl-PL")}\n\n`;
  text += `${all.length} ${all.length === 1 ? "decyzja czeka" : "decyzji czeka"} | najstarsza: ${oldest}h (${Math.floor(oldest / 24)} dni) | ${critical} krytyczn${critical === 1 ? "a" : "e"}\n`;
  text += "═══════════════════════════════════════════════════════════\n\n";

  for (const t of all) {
    const decision = buildDecisionText(t);

    text += `${priorityEmoji(t.hours)} ${t.title} — ${t.id} (${t.hours}h)\n`;
    text += `   ${decision.question}\n`;
    for (const opt of decision.options) {
      text += `   ${opt.label} ${opt.value}\n`;
    }
    if (decision.recommendation) {
      text += `   💡 Rekomendacja PM: ${decision.recommendation}\n`;
    }
    text += `   🔗 ${boardUrl(t.board, t.id)}\n\n`;
  }

  text += "═══════════════════════════════════════════════════════════\n\n";
  text += `Po decyzjach odblokowujemy ${all.length} ${all.length === 1 ? "zadanie" : "zadania"}.`;

  return { text, count: all.length };
}

function main() {
  const boards = listBoards();
  const tasksByBoard = new Map();
  for (const board of boards) {
    try {
      const tasks = blockedNeedsInput(board);
      if (tasks.length) tasksByBoard.set(board, tasks);
    } catch (err) {
      process.stderr.write(`digest: ${board}: ${err.message}\n`);
    }
  }
  const digest = formatDigest(tasksByBoard);
  console.log(digest.text);
  if (digest.count === 0) process.exit(2); // exit-safe signal: nothing to send
}

main();
