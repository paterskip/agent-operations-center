import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ActivityHeatmap, dayWindow } from "./ActivityHeatmap";
import type { AgentActivityCell } from "@/lib/trends";

describe("dayWindow", () => {
  it("returns exactly 84 days ending at the reference date", () => {
    const w = dayWindow("2026-08-15");
    expect(w).toHaveLength(84);
    expect(w[0]).toBe("2026-05-24"); // 15.08 - 83 dni
    expect(w[83]).toBe("2026-08-15");
  });

  it("honors a custom window size", () => {
    const w = dayWindow("2026-08-15", 7);
    expect(w).toHaveLength(7);
    expect(w[6]).toBe("2026-08-15");
    expect(w[0]).toBe("2026-08-09");
  });

  it("is deterministic for a fixed reference date", () => {
    expect(dayWindow("2026-08-15")).toEqual(dayWindow("2026-08-15"));
  });

  it("spans the end of month correctly", () => {
    const w = dayWindow("2026-03-02", 3);
    expect(w).toEqual(["2026-02-28", "2026-03-01", "2026-03-02"]);
  });
});

const agents = [
  { slug: "coder", name: "Koder" },
  { slug: "writer", name: "Pisarz" },
];

const data: AgentActivityCell[] = [
  { agent: "coder", date: "2026-08-15", count: 3 },
  { agent: "coder", date: "2026-08-14", count: 6 },
  { agent: "writer", date: "2026-08-15", count: 1 },
];

describe("ActivityHeatmap", () => {
  const html = (t?: string) =>
    renderToStaticMarkup(
      <ActivityHeatmap data={data} agents={agents} today={t ?? "2026-08-15"} />,
    );

  it("renders a heatmap row per agent with data", () => {
    const h = html();
    expect(h).toContain('class="heatmap"');
    expect((h.match(/class="heatmap-row"/g) || []).length).toBe(2);
  });

  it("renders exactly 84 cells per agent", () => {
    const h = html();
    expect((h.match(/class="hm-cell"/g) || []).length).toBe(84 * 2);
  });

  it("applies cell color by count bucket", () => {
    const h = html();
    // coder: 6 -> --hm3, 3 -> --hm2, reszta 0 -> --hm0
    expect(h).toContain("background:var(--hm3)");
    expect(h).toContain("background:var(--hm2)");
    expect(h).toContain("background:var(--hm0)");
  });

  it("shows the per-agent activity total in the label", () => {
    const h = html();
    // coder total = 9, writer total = 1
    expect(h).toContain('>Koder<');
    expect(h).toContain('>9<');
    expect(h).toContain('>Pisarz<');
    expect(h).toContain('>1<');
  });

  it("sets a descriptive title on each cell", () => {
    const h = html();
    expect(h).toContain('title="Koder · 2026-08-15 · 3 zdarzeń"');
  });

  it("filters out agents without any activity", () => {
    const lone = renderToStaticMarkup(
      <ActivityHeatmap data={data} agents={[...agents, { slug: "qa", name: "QA" }]} today="2026-08-15" />,
    );
    expect((lone.match(/class="heatmap-row"/g) || []).length).toBe(2);
    expect(lone).not.toContain('>QA<');
  });

  it("renders the empty state when no agent has activity", () => {
    const h = renderToStaticMarkup(
      <ActivityHeatmap data={[]} agents={agents} today="2026-08-15" />,
    );
    expect(h).toContain('class="heatmap-empty"');
    expect(h).toContain("Brak aktywności");
  });
});
