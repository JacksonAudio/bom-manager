// src/components/PriceChart.jsx — SVG line chart for price history
import React, { useState, useRef, useMemo } from "react";

const FONT = "-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',sans-serif";

/**
 * PriceChart — pure SVG line chart with area fill, tooltips, and dark mode support.
 *
 * Props:
 *   data      — array of { recorded_at, unit_price, supplier?, source? }
 *   width     — SVG width (default 600, responsive via viewBox)
 *   height    — SVG height (default 220)
 *   title     — optional chart title
 *   darkMode  — boolean
 *   sparkline — boolean, if true renders a minimal sparkline (no axes/labels)
 */
export default function PriceChart({ data, width = 600, height = 220, title, darkMode = false, sparkline = false }) {
  const [hoverIdx, setHoverIdx] = useState(null);
  const svgRef = useRef(null);

  const sorted = useMemo(() => {
    if (!data || data.length === 0) return [];
    return [...data]
      .map(d => ({ ...d, date: new Date(d.recorded_at), price: parseFloat(d.unit_price) }))
      .filter(d => !isNaN(d.price) && !isNaN(d.date.getTime()))
      .sort((a, b) => a.date - b.date);
  }, [data]);

  if (!sorted.length) {
    if (sparkline) return null;
    return (
      <div style={{ padding: "20px 16px", textAlign: "center", fontSize: 12,
        color: darkMode ? "#86868b" : "#aeaeb2", fontFamily: FONT }}>
        No price data available
      </div>
    );
  }

  // ── Sparkline mode ──
  if (sparkline) {
    const sw = width;
    const sh = height;
    const pad = 2;
    const prices = sorted.map(d => d.price);
    const minP = Math.min(...prices);
    const maxP = Math.max(...prices);
    const range = maxP - minP || 1;

    const points = sorted.map((d, i) => {
      const x = pad + (i / Math.max(sorted.length - 1, 1)) * (sw - pad * 2);
      const y = sh - pad - ((d.price - minP) / range) * (sh - pad * 2);
      return `${x},${y}`;
    });

    const trendUp = sorted.length >= 2 && sorted[sorted.length - 1].price > sorted[0].price;
    const color = trendUp ? "#ff3b30" : "#34c759";

    return (
      <svg viewBox={`0 0 ${sw} ${sh}`} width={sw} height={sh}
        style={{ display: "block", overflow: "visible" }}>
        <polyline points={points.join(" ")} fill="none" stroke={color}
          strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
    );
  }

  // ── Full chart ──
  const margin = { top: title ? 36 : 16, right: 16, bottom: 40, left: 56 };
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;

  const prices = sorted.map(d => d.price);
  const minP = Math.min(...prices);
  const maxP = Math.max(...prices);
  const pricePad = (maxP - minP) * 0.15 || maxP * 0.1 || 1;
  const yMin = Math.max(0, minP - pricePad);
  const yMax = maxP + pricePad;
  const yRange = yMax - yMin || 1;

  const minDate = sorted[0].date.getTime();
  const maxDate = sorted[sorted.length - 1].date.getTime();
  const dateRange = maxDate - minDate || 1;

  const toX = (date) => margin.left + ((date.getTime() - minDate) / dateRange) * plotW;
  const toY = (price) => margin.top + plotH - ((price - yMin) / yRange) * plotH;

  // Build path
  const linePath = sorted.map((d, i) => `${i === 0 ? "M" : "L"}${toX(d.date)},${toY(d.price)}`).join(" ");
  const areaPath = linePath +
    ` L${toX(sorted[sorted.length - 1].date)},${margin.top + plotH}` +
    ` L${toX(sorted[0].date)},${margin.top + plotH} Z`;

  // Grid lines (4-5 horizontal)
  const gridCount = 4;
  const gridLines = [];
  for (let i = 0; i <= gridCount; i++) {
    const val = yMin + (yRange / gridCount) * i;
    gridLines.push({ y: toY(val), label: `$${val.toFixed(val >= 100 ? 0 : val >= 1 ? 2 : 4)}` });
  }

  // X-axis labels (up to 6)
  const xLabelCount = Math.min(sorted.length, 6);
  const xLabels = [];
  for (let i = 0; i < xLabelCount; i++) {
    const idx = Math.round((i / Math.max(xLabelCount - 1, 1)) * (sorted.length - 1));
    const d = sorted[idx];
    xLabels.push({
      x: toX(d.date),
      label: d.date.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    });
  }

  // Tooltip data
  const tooltip = hoverIdx !== null && sorted[hoverIdx] ? sorted[hoverIdx] : null;
  const tooltipX = tooltip ? toX(tooltip.date) : 0;
  const tooltipY = tooltip ? toY(tooltip.price) : 0;

  const bgColor = darkMode ? "#1c1c1e" : "#fff";
  const textColor = darkMode ? "#f5f5f7" : "#1d1d1f";
  const mutedColor = "#86868b";
  const gridColor = darkMode ? "#2c2c2e" : "#f0f0f2";
  const borderColor = darkMode ? "#3a3a3e" : "#e5e5ea";

  return (
    <div style={{ width: "100%", fontFamily: FONT }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height="auto"
        style={{ display: "block", overflow: "visible", background: bgColor,
          borderRadius: 10, border: `1px solid ${borderColor}` }}
        onMouseLeave={() => setHoverIdx(null)}
        onMouseMove={(e) => {
          const rect = svgRef.current?.getBoundingClientRect();
          if (!rect) return;
          const scale = width / rect.width;
          const mouseX = (e.clientX - rect.left) * scale;
          // Find nearest point
          let nearest = 0;
          let nearestDist = Infinity;
          for (let i = 0; i < sorted.length; i++) {
            const px = toX(sorted[i].date);
            const dist = Math.abs(px - mouseX);
            if (dist < nearestDist) { nearestDist = dist; nearest = i; }
          }
          setHoverIdx(nearest);
        }}
      >
        {/* Title */}
        {title && (
          <text x={margin.left} y={20} fontSize="13" fontWeight="700"
            fill={textColor} fontFamily={FONT}>{title}</text>
        )}

        {/* Grid lines */}
        {gridLines.map((g, i) => (
          <g key={i}>
            <line x1={margin.left} y1={g.y} x2={width - margin.right} y2={g.y}
              stroke={gridColor} strokeWidth="1" />
            <text x={margin.left - 8} y={g.y + 4} fontSize="10" fontWeight="500"
              fill={mutedColor} textAnchor="end" fontFamily={FONT}>{g.label}</text>
          </g>
        ))}

        {/* Area fill */}
        <path d={areaPath} fill="rgba(0,113,227,0.1)" />

        {/* Line */}
        <path d={linePath} fill="none" stroke="#0071e3" strokeWidth="2"
          strokeLinejoin="round" strokeLinecap="round" />

        {/* Data points */}
        {sorted.map((d, i) => (
          <circle key={i} cx={toX(d.date)} cy={toY(d.price)} r={hoverIdx === i ? 5 : 3}
            fill={hoverIdx === i ? "#0071e3" : "#fff"} stroke="#0071e3" strokeWidth="2"
            style={{ transition: "r 0.15s" }} />
        ))}

        {/* X-axis labels */}
        {xLabels.map((l, i) => (
          <text key={i} x={l.x} y={height - 8} fontSize="10" fontWeight="500"
            fill={mutedColor} textAnchor="middle" fontFamily={FONT}>{l.label}</text>
        ))}

        {/* X-axis line */}
        <line x1={margin.left} y1={margin.top + plotH} x2={width - margin.right}
          y2={margin.top + plotH} stroke={borderColor} strokeWidth="1" />

        {/* Tooltip */}
        {tooltip && (() => {
          const boxW = 150;
          const boxH = 52;
          let tx = tooltipX + 10;
          let ty = tooltipY - boxH - 10;
          if (tx + boxW > width - margin.right) tx = tooltipX - boxW - 10;
          if (ty < margin.top) ty = tooltipY + 14;
          const dateStr = tooltip.date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
          return (
            <g>
              {/* Vertical guide line */}
              <line x1={tooltipX} y1={margin.top} x2={tooltipX} y2={margin.top + plotH}
                stroke="#0071e3" strokeWidth="1" strokeDasharray="3,3" opacity="0.5" />
              {/* Tooltip box */}
              <rect x={tx} y={ty} width={boxW} height={boxH} rx="6"
                fill={darkMode ? "#2c2c2e" : "#fff"} stroke={borderColor}
                strokeWidth="1" filter="url(#shadow)" />
              <text x={tx + 10} y={ty + 16} fontSize="11" fontWeight="700"
                fill={textColor} fontFamily={FONT}>
                ${tooltip.price.toFixed(tooltip.price >= 1 ? 4 : 6)}
              </text>
              <text x={tx + 10} y={ty + 30} fontSize="10" fill={mutedColor} fontFamily={FONT}>
                {dateStr}
              </text>
              <text x={tx + 10} y={ty + 44} fontSize="10" fill={mutedColor} fontFamily={FONT}>
                {[tooltip.supplier, tooltip.source].filter(Boolean).join(" · ") || ""}
              </text>
            </g>
          );
        })()}

        {/* Shadow filter for tooltip */}
        <defs>
          <filter id="shadow" x="-10%" y="-10%" width="120%" height="130%">
            <feDropShadow dx="0" dy="2" stdDeviation="4" floodOpacity="0.1" />
          </filter>
        </defs>
      </svg>
    </div>
  );
}
