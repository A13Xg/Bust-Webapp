/*
 * Achievement glyphs, shared by the trophy cabinet and the debug menu's
 * achievement picker.
 *
 * Lifted out of main.jsx so DebugMenu can render the real sprites: main.jsx
 * imports DebugMenu, so DebugMenu importing back from main.jsx would be a
 * cycle. Pure move, no behaviour change.
 *
 * Icon resolution everywhere is `item.micon || matMap[item.icon] || 'shield'`.
 */
import { useEffect, useState } from 'react';

export const TIERS = ['bronze', 'silver', 'gold', 'platinum', 'mythic'];

export const matMap = {
  Activity: 'monitoring',
  AlarmClock: 'alarm',
  Clock3: 'schedule',
  Sparkles: 'auto_awesome',
  Repeat2: 'repeat',
  Moon: 'dark_mode',
  Sun: 'light_mode',
  Sunrise: 'wb_twilight',
  Flame: 'local_fire_department',
  Snowflake: 'ac_unit',
  Gauge: 'speed',
  NotebookPen: 'edit_note',
  BadgeCheck: 'verified',
  CalendarDays: 'calendar_month',
  MapPinned: 'location_on',
  Crown: 'crown',
  Medal: 'military_tech',
  Trophy: 'trophy',
  Shield: 'shield',
};
export const iconFallback = {
  monitoring: ['Pulse Oracle', '⌁'],
  alarm: ['Dawn Bell', '⏰'],
  schedule: ['Clock Sigil', '⏱'],
  auto_awesome: ['Stardust', '✦'],
  repeat: ['Echo Loop', '↻'],
  dark_mode: ['Moonwatch', '☾'],
  light_mode: ['Sunflare', '☀'],
  wb_twilight: ['First Light', '◐'],
  local_fire_department: ['Phoenix Flame', '🔥'],
  ac_unit: ['Frost Rune', '❄'],
  speed: ['Velocity Mark', '⌁'],
  edit_note: ['Field Quill', '✎'],
  verified: ['Seal of Proof', '✓'],
  calendar_month: ['Calendar Seal', '▣'],
  location_on: ['Map Pin', '⌖'],
  crown: ['Crown Mark', '♛'],
  military_tech: ['Medal Star', '★'],
  trophy: ['Victory Cup', '🏆'],
  shield: ['Ward Shield', '⬟'],
};
export const prettyIcon = n =>
  String(n || 'shield')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
// Shared glyph-font status: MIcon renders exactly ONE span (real glyph or fallback),
// never both, so the two can't ever visually stack while font-load state settles.
let msymStatus = 'pending';
const msymListeners = new Set();
export function setMsymStatus(s) {
  msymStatus = s;
  msymListeners.forEach(fn => fn(s));
}
export function useMsymStatus() {
  const [status, setStatus] = useState(msymStatus);
  useEffect(() => {
    msymListeners.add(setStatus);
    return () => msymListeners.delete(setStatus);
  }, []);
  return status;
}
export function MIcon({ name, className = '' }) {
  const status = useMsymStatus();
  const key = name || 'shield';
  const [label, symbol] = iconFallback[key] || [prettyIcon(key), '◆'];
  return (
    <span className={`icon-stack ${className}`} title={label} aria-label={label}>
      {status === 'ready' && (
        <span className="msym material-symbols-outlined" aria-hidden="true">
          {key}
        </span>
      )}
      {status === 'failed' && (
        <span className="icon-fallback" aria-hidden="true">
          {symbol}
        </span>
      )}
    </span>
  );
}

export function BadgeIcon({ name }) {
  return <MIcon name={matMap[name] || name || 'shield'} />;
}
