"use client";

import { useMemo, useState, useRef } from "react";
import type { TrendPoint } from "@/lib/trends";

function formatDatePl(dateStr: string): string {
  try {
    const [y, m, d] = dateStr.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    return new Intl.DateTimeFormat("pl-PL", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(dt);
  } catch {
    return dateStr;
  }
}

function formatShortDate(dateStr: string): string {
  try {
    const [, m, d] = dateStr.split("-");
    return `${d}.${m}`;
  } catch {
    return dateStr;
  }
}

interface ThroughputChartProps {
  data: TrendPoint[];
}

export function ThroughputChart({ data }: ThroughputChartProps) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const metrics = useMemo(() => {
    if (!data.length) return { totalCompleted: 0, totalBlocked: 0, avgDaily: 0, peakDay: null, maxVal: 1 };
    const totalCompleted = data.reduce((s, d) => s + (d.completed || 0), 0);
    const totalBlocked = data.reduce((s, d) => s + (d.blocked || 0), 0);
    const avgDaily = +(totalCompleted / data.length).toFixed(1);

    let peakDay: TrendPoint | null = null;
    let maxVal = 1;
    for (const item of data) {
      if (!peakDay || item.completed > peakDay.completed) {
        peakDay = item;
      }
      if (item.completed > maxVal) maxVal = item.completed;
      if (item.blocked > maxVal) maxVal = item.blocked;
    }

    return { totalCompleted, totalBlocked, avgDaily, peakDay, maxVal };
  }, [data]);

  if (!data.length) return null;

  const w = 720;
  const h = 180;
  const padLeft = 32;
  const padRight = 16;
  const padTop = 18;
  const padBottom = 28;

  const innerW = w - padLeft - padRight;
  const innerH = h - padTop - padBottom;
  const step = innerW / (data.length - 1 || 1);

  // Generowanie punktów dla zadań ukończonych
  const points = data.map((d, i) => {
    const x = padLeft + i * step;
    const y = padTop + innerH - (d.completed / metrics.maxVal) * innerH;
    const yBlocked = padTop + innerH - (d.blocked / metrics.maxVal) * innerH;
    return { ...d, x, y, yBlocked, index: i };
  });

  const lineCompleted = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const areaCompleted = `${lineCompleted} L${points[points.length - 1].x.toFixed(1)},${(padTop + innerH).toFixed(1)} L${points[0].x.toFixed(1)},${(padTop + innerH).toFixed(1)} Z`;

  const activePoint = hoveredIdx !== null && points[hoveredIdx] ? points[hoveredIdx] : null;

  // Interaktywna obsługa kursora
  function handlePointerMove(e: React.PointerEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const clientX = e.clientX - rect.left;
    const scaleX = w / rect.width;
    const svgX = clientX * scaleX;

    const relX = svgX - padLeft;
    const rawIdx = Math.round(relX / step);
    const clampedIdx = Math.max(0, Math.min(points.length - 1, rawIdx));
    setHoveredIdx(clampedIdx);
  }

  function handlePointerLeave() {
    setHoveredIdx(null);
  }

  // Etykiety osi X (5 punktów czasowych)
  const xAxisIndices = [0, Math.floor(data.length * 0.25), Math.floor(data.length * 0.5), Math.floor(data.length * 0.75), data.length - 1];

  return (
    <div className="throughput-card" ref={containerRef}>
      {/* ── KPI Summary Bar ── */}
      <div className="throughput-summary-bar">
        <div className="throughput-kpi-item">
          <span className="throughput-kpi-label">Ukończone (30 dni)</span>
          <strong className="throughput-kpi-val completed">{metrics.totalCompleted} <small>zadań</small></strong>
        </div>
        <div className="throughput-kpi-item">
          <span className="throughput-kpi-label">Średnie tempo</span>
          <strong className="throughput-kpi-val">{metrics.avgDaily} <small>/ dzień</small></strong>
        </div>
        <div className="throughput-kpi-item">
          <span className="throughput-kpi-label">Rekord dzienny</span>
          <strong className="throughput-kpi-val peak">
            {metrics.peakDay ? `${metrics.peakDay.completed} ` : "0 "}
            <small>{metrics.peakDay ? `(${formatShortDate(metrics.peakDay.date)})` : ""}</small>
          </strong>
        </div>
        <div className="throughput-legend">
          <span className="legend-chip completed">
            <i /> Ukończone
          </span>
          {metrics.totalBlocked > 0 && (
            <span className="legend-chip blocked">
              <i /> Zablokowane ({metrics.totalBlocked})
            </span>
          )}
        </div>
      </div>

      {/* ── Interactive SVG Area ── */}
      <div className="throughput-chart-wrapper">
        <svg
          viewBox={`0 0 ${w} ${h}`}
          className="throughput-svg"
          onPointerMove={handlePointerMove}
          onPointerLeave={handlePointerLeave}
          role="img"
          aria-label="Interaktywny wykres przepustowości 30-dniowej"
        >
          <defs>
            <linearGradient id="tpGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#4da3ff" stopOpacity="0.36" />
              <stop offset="100%" stopColor="#4da3ff" stopOpacity="0.0" />
            </linearGradient>
          </defs>

          {/* Grid lines Y & labels */}
          {[0, 0.5, 1].map((ratio) => {
            const y = padTop + innerH * (1 - ratio);
            const val = Math.round(metrics.maxVal * ratio);
            return (
              <g key={`y-${ratio}`}>
                <line
                  x1={padLeft}
                  y1={y}
                  x2={w - padRight}
                  y2={y}
                  stroke="rgba(255, 255, 255, 0.07)"
                  strokeDasharray={ratio > 0 && ratio < 1 ? "3 3" : undefined}
                />
                <text
                  x={padLeft - 8}
                  y={y + 3.5}
                  textAnchor="end"
                  fill="rgba(255, 255, 255, 0.35)"
                  fontSize="9.5"
                  fontFamily="var(--font-mono)"
                >
                  {val}
                </text>
              </g>
            );
          })}

          {/* Axis X ticks */}
          {xAxisIndices.map((idx) => {
            const p = points[idx];
            if (!p) return null;
            return (
              <g key={`x-tick-${idx}`}>
                <line x1={p.x} y1={padTop + innerH} x2={p.x} y2={padTop + innerH + 4} stroke="rgba(255, 255, 255, 0.2)" />
                <text
                  x={p.x}
                  y={padTop + innerH + 16}
                  textAnchor="middle"
                  fill="rgba(255, 255, 255, 0.4)"
                  fontSize="9.5"
                  fontFamily="var(--font-mono)"
                >
                  {formatShortDate(p.date)}
                </text>
              </g>
            );
          })}

          {/* Fill Area & Main Completed Line */}
          <path d={areaCompleted} fill="url(#tpGradient)" />
          <path
            d={lineCompleted}
            fill="none"
            stroke="#4da3ff"
            strokeWidth="2.2"
            strokeLinejoin="round"
            strokeLinecap="round"
          />

          {/* Passive Dots */}
          {points.map((p) => {
            const isHovered = hoveredIdx === p.index;
            if (p.completed === 0 && !isHovered) return null;
            return (
              <circle
                key={`dot-${p.index}`}
                cx={p.x}
                cy={p.y}
                r={isHovered ? 4.5 : 2.5}
                fill={isHovered ? "#4da3ff" : "#0c1015"}
                stroke="#4da3ff"
                strokeWidth={isHovered ? 2.5 : 1.5}
                className="tp-dot"
              />
            );
          })}

          {/* Hover Crosshair & Pointer Highlight */}
          {activePoint && (
            <g className="tp-crosshair" pointerEvents="none">
              <line
                x1={activePoint.x}
                y1={padTop}
                x2={activePoint.x}
                y2={padTop + innerH}
                stroke="rgba(212, 255, 0, 0.5)"
                strokeWidth="1.5"
                strokeDasharray="3 3"
              />
              <circle
                cx={activePoint.x}
                cy={activePoint.y}
                r="6.5"
                fill="none"
                stroke="var(--accent-lime)"
                strokeWidth="2"
                className="tp-pulse"
              />
              <circle
                cx={activePoint.x}
                cy={activePoint.y}
                r="3.5"
                fill="var(--accent-lime)"
              />
            </g>
          )}
        </svg>

        {/* ── Rich Glassmorphism Floating Tooltip ── */}
        {activePoint && (
          <div
            className="throughput-tooltip"
            style={{
              left: `${(activePoint.x / w) * 100}%`,
              transform: `translate(${activePoint.x > w * 0.75 ? "-100%" : activePoint.x < w * 0.25 ? "0%" : "-50%"}, -110%)`,
            }}
          >
            <div className="tooltip-date">{formatDatePl(activePoint.date)}</div>
            <div className="tooltip-metrics">
              <div className="tooltip-row completed">
                <span className="tooltip-dot" />
                <span className="tooltip-name">Ukończone zadania</span>
                <strong>{activePoint.completed}</strong>
              </div>
              {activePoint.blocked > 0 && (
                <div className="tooltip-row blocked">
                  <span className="tooltip-dot" />
                  <span className="tooltip-name">Zablokowane</span>
                  <strong>{activePoint.blocked}</strong>
                </div>
              )}
            </div>
            {metrics.avgDaily > 0 && (
              <div className="tooltip-footer">
                {activePoint.completed >= metrics.avgDaily ? (
                  <span className="velocity-up">▲ Powyżej średniej ({metrics.avgDaily}/d)</span>
                ) : (
                  <span className="velocity-down">▼ Poniżej średniej ({metrics.avgDaily}/d)</span>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
