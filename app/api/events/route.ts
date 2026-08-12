import { activityCursor, getAgentStatuses, getTaskDeltas } from "@/lib/hermes";

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
            previousCursor = cursor;
            const agents = getAgentStatuses();
            const tasks = getTaskDeltas();
            controller.enqueue(encoder.encode(
              `event: change\ndata: ${JSON.stringify({ cursor, agents, tasks })}\n\n`
            ));
          } else {
            controller.enqueue(encoder.encode(`: heartbeat\n\n`));
          }
        } catch {
          controller.enqueue(encoder.encode(
            `event: source-error\ndata: ${JSON.stringify({ message: "Hermes data source unavailable" })}\n\n`
          ));
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
