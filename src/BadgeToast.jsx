import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { BadgeIcon } from './badgeIcons.jsx';
import { haptic } from './haptics.js';
const tierUrl = tier =>
  ['bronze', 'silver', 'gold', 'platinum', 'mythic'].includes(tier)
    ? `${import.meta.env.BASE_URL}badges/512/${tier}.png`
    : null;
export function BadgeMedal({ icon, accent, tier }) {
  const url = tier ? tierUrl(tier) : null;
  return (
    <div
      className={`badge-medal${url ? ` tier-plated` : ''}`}
      style={{ '--badge': accent, ...(url ? { backgroundImage: `url(${url})` } : {}) }}
    >
      <BadgeIcon name={icon} />
    </div>
  );
}
export function BadgeToast({ badge }) {
  const reduced = useReducedMotion();
  useEffect(() => {
    if (badge && !badge.isRestored && !badge.isRestorationSummary) haptic('achievement');
  }, [badge]);
  if (!badge) return null;
  return createPortal(
    <div className="badge-toast-anchor">
      <motion.div
        className="badge-toast mf-frame"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        style={{ '--award-color': badge.accent || '#ff8a2a' }}
        initial={{ opacity: 0, y: reduced ? 0 : -12 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: reduced ? 0 : -12 }}
      >
        {!badge.isRestored && !badge.isRestorationSummary && (
          <div className="award-sparkles" aria-hidden="true">
            {Array.from({ length: 10 }, (_, i) => (
              <i
                key={i}
                style={{
                  '--spark-x': `${8 + i * 9}%`,
                  '--spark-delay': `${(i % 4) * 0.08}s`,
                  '--spark-drift': `${(i % 2 ? 1 : -1) * (8 + i)}px`,
                }}
              />
            ))}
          </div>
        )}
        <BadgeMedal icon={badge.micon || badge.icon} accent={badge.accent} tier={badge.tier} />
        <div className="badge-toast-copy">
          <span>
            {badge.isRestorationSummary
              ? 'HISTORICAL RECONCILIATION'
              : badge.isRestored
                ? 'ACHIEVEMENT RESTORED'
                : 'ACHIEVEMENT UNLOCKED'}
          </span>
          <h2>{badge.isRestorationSummary ? `${badge.restoredCount} historical achievements restored` : badge.name}</h2>
          <p>
            {badge.isRestorationSummary
              ? 'View your Trophy Cabinet to inspect restored unlocks.'
              : `${badge.tier.toUpperCase()} · ${badge.points} XP`}
          </p>
        </div>
      </motion.div>
    </div>,
    document.body
  );
}
