// Best-effort unwrap of kanban task bodies stored as JSON envelopes.
// Real-world Hermes kanban bodies are sometimes a {"title":..,"body":".."}
// envelope that gets TRUNCATED on write — JSON.parse then fails. We fall
// back to extracting the "body" string literal (handling JSON escapes).

export function unwrapBody(body: string): string {
  if (!body || !body.trimStart().startsWith("{")) return body;
  try {
    const parsed = JSON.parse(body) as { body?: unknown };
    if (typeof parsed.body === "string") return parsed.body;
  } catch {
    // Truncated JSON envelope (seen in real boards): extract the "body" string best-effort.
    const start = body.indexOf('"body":"');
    if (start !== -1) {
      const slice = body.slice(start + 8);
      let out = "";
      for (let i = 0; i < slice.length; i++) {
        const ch = slice[i];
        if (ch === "\\") {
          const nxt = slice[i + 1];
          if (nxt === "u") {
            const hex = slice.slice(i + 2, i + 6);
            if (/^[0-9a-fA-F]{4}$/.test(hex)) { out += String.fromCharCode(parseInt(hex, 16)); i += 5; continue; }
            out += "u"; i += 1; continue;
          }
          out += nxt === "n" ? "\n" : nxt === "t" ? "\t" : nxt === "r" ? "\r" : nxt === '"' ? '"' : nxt === "\\" ? "\\" : nxt === "b" ? "\b" : nxt === "f" ? "\f" : ch + (nxt ?? "");
          i++; continue;
        }
        if (ch === '"') break;
        out += ch;
      }
      if (out.trim()) return out;
    }
  }
  return body;
}
