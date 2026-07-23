import React from 'react';

/* Reusable SVG chart primitives — tabular numerals, clean axes, orange/milk palette. */

const ORANGE = '#ff5e00';
const ORANGE2 = '#ff8a2a';
const MILK = '#fff8e7';
const MUTED = 'rgba(245,240,232,.45)';
const LINE = 'rgba(255,255,255,.12)';

/** Area + line trend chart (e.g. 30-day volume). data: [{label, count}] */
export function TrendChart({ data = [], height = 180 }) {
  const w = 600, h = height, padX = 6, padY = 16;
  const max = Math.max(1, ...data.map(d => d.count));
  const step = data.length > 1 ? (w - padX * 2) / (data.length - 1) : 0;
  const pt = (d, i) => [padX + i * step, h - padY - (d.count / max) * (h - padY * 2)];
  const pts = data.map(pt);
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = pts.length ? `${line} L${pts[pts.length - 1][0]},${h - padY} L${pts[0][0]},${h - padY} Z` : '';
  return (
    <svg className="chart" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label="Volume trend">
      <defs>
        <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={ORANGE} stopOpacity=".5" />
          <stop offset="100%" stopColor={ORANGE} stopOpacity=".02" />
        </linearGradient>
      </defs>
      {[0.25, 0.5, 0.75].map(f => <line key={f} x1={padX} x2={w - padX} y1={h - padY - f * (h - padY * 2)} y2={h - padY - f * (h - padY * 2)} stroke={LINE} strokeDasharray="3 5" />)}
      <line x1={padX} x2={w - padX} y1={h - padY} y2={h - padY} stroke={LINE} />
      {area && <path d={area} fill="url(#trendFill)" />}
      {line && <path d={line} fill="none" stroke={ORANGE2} strokeWidth="2.5" strokeLinejoin="round" />}
      {pts.map(([x, y], i) => data[i].count > 0 && <circle key={i} cx={x} cy={y} r="4.5" fill={MILK} stroke={ORANGE} strokeWidth="1.5" style={{cursor:'pointer'}}><title>{`${data[i].label}: ${data[i].count} bust${data[i].count===1?'':'s'}`}</title></circle>)}
      <text x={padX} y={12} fill={MUTED} fontSize="11" fontWeight="900">{max} PEAK</text>
    </svg>
  );
}

/** Donut of categorical shares. data: [{label, value, color?}] */
export function DonutChart({ data = [], size = 200 }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  const cx = size / 2, cy = size / 2, r = size / 2 - 14, thick = 26;
  const palette = [ORANGE, '#ffd166', '#c77dff', '#7bdff2', '#57cc99', '#8ab4ff'];
  let angle = -Math.PI / 2;
  const arcs = data.filter(d => d.value > 0).map((d, i) => {
    const frac = d.value / total;
    const a0 = angle, a1 = angle + frac * Math.PI * 2 - 0.03;
    angle += frac * Math.PI * 2;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const p = a => [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
    const [x0, y0] = p(a0), [x1, y1] = p(a1);
    return { d, path: `M${x0},${y0} A${r},${r} 0 ${large} 1 ${x1},${y1}`, color: d.color || palette[i % palette.length] };
  });
  return (
    <div className="donut-wrap">
      <svg viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Share breakdown">
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={LINE} strokeWidth={thick} />
        {arcs.map((a, i) => <path key={i} d={a.path} fill="none" stroke={a.color} strokeWidth={thick} strokeLinecap="butt" />)}
        <text x={cx} y={cy - 4} textAnchor="middle" fill={MILK} fontSize="30" fontWeight="900">{total}</text>
        <text x={cx} y={cy + 18} textAnchor="middle" fill={MUTED} fontSize="10" fontWeight="900" letterSpacing="2">EVENTS</text>
      </svg>
      <ul className="donut-legend">
        {arcs.map((a, i) => <li key={i}><i style={{ background: a.color }} /> <b>{a.d.label}</b> <span>{a.d.value} · {Math.round(a.d.value / total * 100)}%</span></li>)}
      </ul>
    </div>
  );
}

/** 24-hour histogram. counts: number[24] */
export function HourHistogram({ counts = [], height = 150 }) {
  const w = 600, h = height, padY = 20;
  const max = Math.max(1, ...counts);
  const bw = w / 24;
  return (
    <svg className="chart" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label="Hour of day histogram">
      <line x1="0" x2={w} y1={h - padY} y2={h - padY} stroke={LINE} />
      {counts.map((c, i) => {
        const bh = (c / max) * (h - padY - 8);
        return <rect key={i} x={i * bw + 2} y={h - padY - bh} width={bw - 4} height={Math.max(c > 0 ? 3 : 0, bh)} fill={c === max && max > 0 ? MILK : ORANGE} opacity={c === max ? 1 : 0.5 + (c / max) * 0.5} rx="1.5"><title>{`${i}:00–${i}:59 — ${c} bust${c===1?'':'s'}`}</title></rect>;
      })}
      {[0, 6, 12, 18, 23].map(hr => <text key={hr} x={hr * bw + bw / 2} y={h - 5} textAnchor="middle" fill={MUTED} fontSize="10" fontWeight="900">{hr}h</text>)}
    </svg>
  );
}

/** Tiny inline sparkline. data: number[] */
export function Sparkline({ data = [], width = 90, height = 26, color = ORANGE2 }) {
  const max = Math.max(1, ...data);
  const step = data.length > 1 ? width / (data.length - 1) : 0;
  const line = data.map((v, i) => `${i ? 'L' : 'M'}${(i * step).toFixed(1)},${(height - 3 - (v / max) * (height - 6)).toFixed(1)}`).join(' ');
  return (
    <svg className="sparkline" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/** Radial gauge 0-100. */
export function Gauge({ pct = 0, label = '', size = 120 }) {
  const r = size / 2 - 10, c = Math.PI * r; // half circle
  return (
    <svg viewBox={`0 0 ${size} ${size / 2 + 16}`} width={size} role="img" aria-label={label}>
      <path d={`M10,${size / 2} A${r},${r} 0 0 1 ${size - 10},${size / 2}`} fill="none" stroke={LINE} strokeWidth="10" strokeLinecap="round" />
      <path d={`M10,${size / 2} A${r},${r} 0 0 1 ${size - 10},${size / 2}`} fill="none" stroke={ORANGE} strokeWidth="10" strokeLinecap="round" strokeDasharray={`${(pct / 100) * c} ${c}`} />
      <text x={size / 2} y={size / 2 - 2} textAnchor="middle" fill={MILK} fontSize="20" fontWeight="900">{Math.round(pct)}%</text>
      <text x={size / 2} y={size / 2 + 13} textAnchor="middle" fill={MUTED} fontSize="9" fontWeight="900" letterSpacing="1.5">{label}</text>
    </svg>
  );
}

/** Horizontal bar chart for ranked comparisons. items: [{label, value, pct, color?}] */
export function HBarChart({ items = [], height = 32, maxLabel = 120 }) {
  const palette = [ORANGE, '#ffd166', '#c77dff', '#7bdff2', '#57cc99', '#8ab4ff'];
  if (!items.length) return <div className="empty-state"><span>No data yet.</span></div>;
  return (
    <ul className="hbar-list">
      {items.map((item, i) => (
        <li key={i} className="hbar-row">
          <span className="hbar-label" style={{ minWidth: maxLabel }}>{item.label}</span>
          <div className="hbar-track">
            <div
              className="hbar-fill"
              style={{
                width: `${Math.max(1, item.pct)}%`,
                background: item.color || palette[i % palette.length],
                height,
              }}
            />
          </div>
          <span className="hbar-value">{item.value}</span>
        </li>
      ))}
    </ul>
  );
}

export function ScatterChart({ points = [], height = 240 }) {
  const [tip, setTip] = React.useState(null);
  const w = 600, h = height, padL = 52, padR = 14, padT = 12, padB = 34;
  if (!points.length) {
    return <div className="empty-state"><span>No temperature/pressure data yet.</span></div>;
  }
  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  let x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  if (x0 === x1) { x0 -= 5; x1 += 5; }
  if (y0 === y1) { y0 -= 5; y1 += 5; }
  const xpad = (x1 - x0) * 0.08, ypad = (y1 - y0) * 0.08;
  x0 -= xpad; x1 += xpad; y0 -= ypad; y1 += ypad;
  const px = v => padL + (v - x0) / (x1 - x0) * (w - padL - padR);
  const py = v => h - padB - (v - y0) / (y1 - y0) * (h - padT - padB);
  const ticks = (a, b, n = 4) => Array.from({ length: n + 1 }).map((_, i) => a + (b - a) * i / n);
  return (
    <div className="scatter-wrap">
      <svg className="chart" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label="Temperature vs pressure scatter">
        {ticks(y0, y1).map((t, i) => <g key={`y${i}`}>
          <line x1={padL} x2={w - padR} y1={py(t)} y2={py(t)} stroke="rgba(255,255,255,.08)" strokeDasharray="3 5" />
          <text x={padL - 6} y={py(t) + 4} textAnchor="end" fill="rgba(245,240,232,.5)" fontSize="10" fontWeight="900">{Math.round(t)}</text>
        </g>)}
        {ticks(x0, x1).map((t, i) => <text key={`x${i}`} x={px(t)} y={h - padB + 16} textAnchor="middle" fill="rgba(245,240,232,.5)" fontSize="10" fontWeight="900">{Math.round(t)}</text>)}
        <line x1={padL} x2={padL} y1={padT} y2={h - padB} stroke="rgba(255,255,255,.2)" />
        <line x1={padL} x2={w - padR} y1={h - padB} y2={h - padB} stroke="rgba(255,255,255,.2)" />
        <text x={w - padR} y={h - 4} textAnchor="end" fill="rgba(245,240,232,.5)" fontSize="10" fontWeight="900" letterSpacing="1.5">TEMP °F</text>
        <text x={12} y={padT + 4} fill="rgba(245,240,232,.5)" fontSize="10" fontWeight="900" letterSpacing="1.5" transform={`rotate(-90 12 ${padT + 4})`} textAnchor="end">PRESSURE hPa</text>
        {points.map((p, i) => (
          <circle key={i} cx={px(p.x)} cy={py(p.y)} r="6" fill="#ff5e00" stroke="#fff8e7" strokeWidth="1.2" style={{ cursor: 'pointer' }}
            onMouseEnter={() => setTip({ left: px(p.x) / w * 100, top: py(p.y) / h * 100, label: p.label })}
            onMouseLeave={() => setTip(null)}>
            <title>{p.label}</title>
          </circle>
        ))}
      </svg>
      {tip && <div className="scatter-tip" style={{ left: `${tip.left}%`, top: `${tip.top}%` }}>{tip.label}</div>}
    </div>
  );
}
