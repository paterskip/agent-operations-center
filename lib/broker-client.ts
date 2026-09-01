import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { getSnapshot } from "./hermes";
import type { TaskCard, TaskStatus } from "./types";

const kanbanRoot = process.env.HERMES_KANBAN_ROOT || "/root/.hermes/kanban";

export interface HermesBrokerClientOptions {
  kanbanRoot?: string;
}

export class HermesBrokerClient {
  private kanbanRoot: string;

  constructor(options?: HermesBrokerClientOptions) {
    this.kanbanRoot = options?.kanbanRoot || kanbanRoot;
  }

  public getBoardSnapshot(boardSlug: string) {
    return getSnapshot(boardSlug);
  }

  public getTask(boardSlug: string, taskId: string): TaskCard | null {
    const snap = getSnapshot(boardSlug);
    return snap.tasks.find((t) => t.id === taskId) || null;
  }

  public verifyToken(inputToken: string): boolean {
    const expectedToken = process.env.AOC_HERMES_API_TOKEN || "";
    if (!expectedToken || !inputToken) return false;
    return inputToken === expectedToken;
  }

  public executeTransition(boardSlug: string, taskId: string, targetStatus: TaskStatus, token?: string): { success: boolean; message: string } {
    if (token !== undefined && !this.verifyToken(token)) {
      return { success: false, message: "Nieprawidłowy token bramki API brokera (Unauthorized)" };
    }

    const dbPath = boardSlug === "default" 
      ? path.resolve(this.kanbanRoot, "..", "kanban.db") 
      : path.join(this.kanbanRoot, "boards", boardSlug, "kanban.db");

    if (!fs.existsSync(dbPath)) {
      return { success: false, message: `Baza danych dla boarda ${boardSlug} nie istnieje.` };
    }

    try {
      const db = new Database(dbPath);
      const now = Math.floor(Date.now() / 1000);
      const update = db.prepare("UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?");
      const res = update.run(targetStatus, now, taskId);
      
      if (res.changes > 0) {
        db.prepare("INSERT INTO task_events (task_id, kind, payload, created_at) VALUES (?, ?, ?, ?)").run(
          taskId,
          `status_change_${targetStatus}`,
          JSON.stringify({ fromBroker: true, targetStatus }),
          now
        );
        db.close();
        return { success: true, message: `Status zadania ${taskId} zmieniony na ${targetStatus}` };
      }
      db.close();
      return { success: false, message: `Zadanie ${taskId} nie zostało znalezione.` };
    } catch (err) {
      return { success: false, message: err instanceof Error ? err.message : "Błąd bazy danych broker." };
    }
  }
}

export const brokerClient = new HermesBrokerClient();

