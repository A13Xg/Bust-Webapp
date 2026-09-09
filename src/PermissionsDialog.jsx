/*
 * First-login Permissions dialog.
 *
 * Three phases in one window that stretches between them (framer-motion's
 * `layout` animates the height change):
 *
 *   WHY    - why the app wants these, in a pulsing orange box. OKAY.
 *   CHOOSE - what to turn on, plus "don't ask me again". ACCEPT.
 *   STATUS - location is requested first, then notifications, one after the
 *            other, and each reports what happened. OKAY.
 *
 * Install is deliberately the LAST thing that happens, after STATUS is
 * dismissed — an install prompt must never be competing for attention with a
 * native permission prompt. It also means prompt() gets a fresh user gesture
 * from the final OKAY, which Chromium requires and which it would not have had
 * behind two awaited permission dialogs.
 *
 * No close button: the only ways out are ACCEPT (with everything unchecked, if
 * that is what you want) and the final OKAY.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { Bell, MapPin, RotateCw, Smartphone, X } from 'lucide-react';

import { markSeenThisSession, setOptedOut } from './permissionPrefs.js';
import {
  OUTCOME,
  classifyNotificationPermission,
  isRetryable,
  outcomeHint,
  outcomeLabel,
  requestLocation,
  storeCoords,
} from './permissionRequests.js';

const WHY_COPY =
  'BUST stamps every event with where and when it happened, and pings you the moment the crew fires. ' +
  'Location and notifications are what make those two things work.';
const MAX_PERMISSION_ATTEMPTS = 3;
const PERMISSION_ATTEMPT_TIMEOUT_MS = 6000;
const PUSH_ATTEMPT_TIMEOUT_MS = PERMISSION_ATTEMPT_TIMEOUT_MS / 2;
const OKAY_UNLOCK_DELAY_MS = 3000;

async function completeWithin(task, timeoutMs = PERMISSION_ATTEMPT_TIMEOUT_MS) {
  let timer = null;
  try {
    return await Promise.race([
      Promise.resolve().then(task),
      new Promise(resolve => {
        timer = setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function StatusRow({ icon, label, outcome, busy, onRetry, installRequired = false, manualAllowRequired = false }) {
  const failed = outcome !== OUTCOME.granted && outcome !== 'idle' && !busy;
  const hint = failed ? outcomeHint(outcome) : null;
  return (
    <div className={`perm-row ${outcome === OUTCOME.granted ? 'ok' : failed ? 'bad' : ''}`}>
      <span className="perm-row-icon">{icon}</span>
      <span className="perm-row-label">{label}</span>
      <span className="perm-row-state">
        {busy ? outcomeLabel('pending') : outcome === 'idle' ? outcomeLabel('idle') : outcomeLabel(outcome)}
        {failed && outcome !== OUTCOME.granted && <X className="perm-row-x" />}
      </span>
      {hint && <small className="perm-row-hint">{hint}</small>}
      {installRequired && outcome === OUTCOME.unsupported && (
        <strong className="perm-row-install-required">Must Install App</strong>
      )}
      {manualAllowRequired && outcome === OUTCOME.timeout && (
        <strong className="perm-row-install-required">Try Manual Allowing</strong>
      )}
      {failed && isRetryable(outcome) && (
        <button type="button" className="mf-button ghost perm-retry" onClick={onRetry}>
          <RotateCw /> RETRY
        </button>
      )}
    </div>
  );
}

export function PermissionsDialog({
  onDone,
  enablePush,
  getNotificationPermission,
  install = globalThis.window?.bustInstall,
  requestLocationFn = requestLocation,
}) {
  const [phase, setPhase] = useState('why');
  const [choices, setChoices] = useState({ notifications: true, location: true, install: true });
  const [dontAsk, setDontAsk] = useState(false);
  const [results, setResults] = useState({ location: 'idle', notifications: 'idle' });
  const [busy, setBusy] = useState(null);
  const [okayReady, setOkayReady] = useState(false);
  const wantInstall = useRef(true);
  const okayTimer = useRef(null);

  useEffect(() => () => clearTimeout(okayTimer.current), []);

  const toggle = key => setChoices(prev => ({ ...prev, [key]: !prev[key] }));

  const askLocation = useCallback(async () => {
    setBusy('location');
    let outcome = OUTCOME.timeout;
    for (let attempt = 0; attempt < MAX_PERMISSION_ATTEMPTS; attempt += 1) {
      const result = await completeWithin(requestLocationFn);
      outcome = result?.outcome || OUTCOME.timeout;
      if (result?.coords) storeCoords(result.coords);
      if (!isRetryable(outcome)) break;
    }
    setResults(prev => ({ ...prev, location: outcome }));
    setBusy(null);
    return outcome;
  }, [requestLocationFn]);

  const askNotifications = useCallback(async () => {
    setBusy('notifications');
    let outcome = OUTCOME.timeout;
    for (let attempt = 0; attempt < MAX_PERMISSION_ATTEMPTS; attempt += 1) {
      try {
        const result = await completeWithin(enablePush, PUSH_ATTEMPT_TIMEOUT_MS);
        outcome =
          result == null
            ? OUTCOME.timeout
            : result.ok
              ? OUTCOME.granted
              : classifyNotificationPermission(result.permission || getNotificationPermission?.());
      } catch {
        outcome = classifyNotificationPermission(getNotificationPermission?.());
      }
      if (!isRetryable(outcome)) break;
    }
    setResults(prev => ({ ...prev, notifications: outcome }));
    setBusy(null);
    return outcome;
  }, [enablePush, getNotificationPermission]);

  /* Sequential on purpose: two native prompts at once and the browser stacks
   * them, or silently drops the second. */
  async function accept() {
    setOptedOut(dontAsk);
    if (dontAsk) markSeenThisSession();
    wantInstall.current = choices.install;

    if (!choices.location && !choices.notifications) {
      void finish(choices.install);
      return;
    }

    setPhase('status');
    const finalOutcomes = [];
    if (choices.location) finalOutcomes.push(await askLocation());
    if (choices.notifications) finalOutcomes.push(await askNotifications());
    if (finalOutcomes.some(isRetryable)) {
      okayTimer.current = setTimeout(() => setOkayReady(true), OKAY_UNLOCK_DELAY_MS);
    } else {
      setOkayReady(true);
    }
  }

  /*
   * `show()` is invoked synchronously from the click handler so the native
   * install prompt still has a user gesture to spend; awaiting it afterwards
   * only delays closing until the prompt resolves.
   *
   * A synchronous throw in here used to escape before onDone(), and since this
   * dialog has no close button that stranded the user with no way out. Hence
   * the finally.
   */
  async function finish(shouldInstall = wantInstall.current) {
    let guide = null;
    try {
      if (shouldInstall) {
        const result = await install?.show?.();
        guide = result?.guide || null;
      }
    } catch (error) {
      console.warn('[install] failed', error);
    } finally {
      onDone({ guide });
    }
  }

  return createPortal(
    <div className="ach-detail-back perm-back">
      <motion.div layout transition={{ type: 'spring', stiffness: 260, damping: 30 }} className="perm-box mf-frame">
        <motion.h2 layout="position">Permissions</motion.h2>

        {phase === 'why' && (
          <motion.div layout className="perm-phase">
            <div className="perm-why">
              <p>{WHY_COPY}</p>
            </div>
            <div className="picker-actions">
              <button className="mf-button" onClick={() => setPhase('choose')}>
                OKAY
              </button>
            </div>
          </motion.div>
        )}

        {phase === 'choose' && (
          <motion.div layout className="perm-phase">
            <label className="perm-check">
              <input type="checkbox" checked={choices.notifications} onChange={() => toggle('notifications')} />
              <Bell />
              <span>Allow Notifications</span>
            </label>
            <label className="perm-check">
              <input type="checkbox" checked={choices.location} onChange={() => toggle('location')} />
              <MapPin />
              <span>Allow Location Access</span>
            </label>
            <label className="perm-check perm-check-hero">
              <input type="checkbox" checked={choices.install} onChange={() => toggle('install')} />
              <Smartphone />
              <span>Install App</span>
            </label>

            <label className="perm-check perm-check-quiet">
              <input type="checkbox" checked={dontAsk} onChange={() => setDontAsk(v => !v)} />
              <span>Don’t ask me again</span>
            </label>

            <div className="picker-actions">
              <button className="mf-button" onClick={accept}>
                ACCEPT
              </button>
            </div>
          </motion.div>
        )}

        {phase === 'status' && (
          <motion.div layout className="perm-phase">
            {choices.location && (
              <StatusRow
                icon={<MapPin />}
                label="Location"
                outcome={results.location}
                busy={busy === 'location'}
                onRetry={askLocation}
              />
            )}
            {choices.notifications && (
              <StatusRow
                icon={<Bell />}
                label="Notifications"
                outcome={results.notifications}
                busy={busy === 'notifications'}
                onRetry={askNotifications}
                installRequired
                manualAllowRequired
              />
            )}
            <div className="picker-actions">
              <button className="mf-button" disabled={Boolean(busy) || !okayReady} onClick={() => void finish()}>
                OKAY
              </button>
            </div>
          </motion.div>
        )}
      </motion.div>
    </div>,
    document.body
  );
}
