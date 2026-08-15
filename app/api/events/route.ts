import { activityCursor, activityDelta, getAgentStatuses, getTaskDeltas } from "@/lib/hermes";
import { classifyEvents } from "@/lib/kanban-delta";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(request: Request) {
  const encoder = new TextEncoder();
  let timer: ReturnType<typeof setInterval> | undefined;
  let previousCursor = activityCursor();

  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(`event: ready\ndata: ${JSON.stringify({ cursor: previousCursor })}\n\n`));

      timer = setInterval(() => {
        if (request.signal.aborted) return;
        try {
          const cursor = activityCursor();
          if (cursor !== previousCursor) {
            const entries = activityDelta(previousCursor);
            previousCursor = cursor;
            const hasWork = classifyEvents(entries) === "work";
            const payload = { cursor, agents: getAgentStatuses() };
            if (hasWork) {
              // Real work: send task deltas + new activity so the client can
              // update the board in place — no full snapshot reload.
              Object.assign(payload, { tasks: getTaskDeltas(), activity: entries });
              controller.enqueue(encoder.encode(`event: change\ndata: ${JSON.stringify(payload)}\n\n`));
            } else {
              // Heartbeat-only tick: presence update, zero kanban churn.
              controller.enqueue(encoder.encode(`event: presence\ndata: ${JSON.stringify(payload)}\n\n`));
            }
          } else {
            controller.enqueue(encoder.encode(`: heartbeat\n\n`));
          }
        } catch {
          try {
            controller.enqueue(encoder.encode(
              `event: source-error\ndata: ${JSON.stringify({ message: "Hermes data source unavailable" })}\n\n`
            ));
          } catch { /* controller already closed */ }
        }
      }, 2500);

      request.signal.addEventListener("abort", () => {
        if (timer) clearInterval(timer);
        try { controller.close(); } catch { /* ignore */ }
      });
    },
    cancel() {
      if (timer) clearInterval(timer);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
