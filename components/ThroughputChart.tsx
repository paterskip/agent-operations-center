"use client";

import type { TrendPoint } from "@/lib/trends";

/** Wykres obszarowy „ukończone zadania dziennie" (30 dni) — czysty SVG, zero zależności. */
export function ThroughputChart({ data }: { data: TrendPoint[] }) {
  if (!data.length) return null;
  const w = 640, h = 168, padX = 6, padY = 10;
  const max = Math.max(1, ...data.map((d) => d.completed));
  const innerW = w - padX * 2;
  const innerH = h - padY * 2;
  const step = innerW / (data.length - 1 || 1);

  const pts = data.map((d, i) => ({
    x: padX + i * step,
    y: h - padY - (d.completed / max) * innerH,
    ...d,
  }));
  const line = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
  const area = `${line} L${pts[pts.length - 1].x},${h - padY} L${pts[0].x},${h - padY} Z`;

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="trend-chart" role="img" aria-label="Ukończone zadania dziennie (30 dni)">
      <defs>
        <linearGradient id="tg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#4da3ff" stopOpacity="0.32" />
          <stop offset="100%" stopColor="#4da3ff" stopOpacity="0" />
        </linearGradient>
      </defs>
      {pts.map((p, i) => (
        <line key={`g${i}`} x1={p.x} y1={padY} x2={p.x} y2={h - padY} stroke="rgba(125,142,163,.07)" strokeWidth="1" />
      ))}
      <path d={area} fill="url(#tg)" />
      <path d={line} fill="none" stroke="#4da3ff" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {pts.map((p, i) => (
        <circle key={`c${i}`} cx={p.x} cy={p.y} r={2.6} fill="#0b1018" stroke="#4da3ff" strokeWidth="1.6">
          <title>{`${p.date}: ${p.completed} ukończonych`}</title>
        </circle>
      ))}
    </svg>
  );
}
