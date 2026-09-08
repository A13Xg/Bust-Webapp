/*
 * Debug menu — session sandbox, grouped into tabs.
 *
 * Everything here is session-only and invisible to the crew EXCEPT the Notify
 * tab, which sends a real web push to every registered device. That one is
 * gated server-side by an allowlist and asks for confirmation first.
 *
 * Lifted out of main.jsx when it grew tabs; it was the single largest component
 * in that file and none of it is needed on the dashboard's critical path.
 */
import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

import { achievements } from './rules.js';
import { backend } from './backend.js';
import { describeTokens, renderBroadcast, unknownTokens } from './broadcastTemplate.js';
import { Lightbox } from './Lightbox.jsx';

const TABS = [
  { id: 'bust', label: 'BUST' },
  { id: 'progress', label: 'PROGRESS' },
  { id: 'notify', label: 'NOTIFY' },
  { id: 'tools', label: 'TOOLS' },
  { id: 'session', label: 'SESSION' },
];

/* ------------------------------- Notify tab ------------------------------- */

function NotifyTab({ username }) {
  const [title, setTitle] = useState('{{USER}} has busted');
  const [body, setBody] = useState('Sent by {{SENDER}} at {{TIME}} on {{DATE}}.');
  const [confirm, setConfirm] = useState(false);
  const [state, setState] = useState({ status: 'idle', message: '' });

  /* Preview uses your own name for {{USER}}, which is only exact for your own
   * device — every other recipient sees their own. Labelled as such below. */
  const context = { recipient: username, sender: username, crew: 0, sentAt: new Date(), timeZone: undefined };
  const preview = { title: renderBroadcast(title, context), body: renderBroadcast(body, context) };
  const typos = useMemo(() => unknownTokens(`${title} ${body}`), [title, body]);
  const blank = !title.trim() && !body.trim();

  async function send() {
    setConfirm(false);
    setState({ status: 'sending', message: '' });
    try {
      const result = await backend.broadcastTestNotification({ title, body });
      if (!result?.ok) {
        setState({ status: 'error', message: result?.error || result?.reason || 'Broadcast failed' });
        return;
      }
      setState({
        status: 'sent',
        message: `Delivered to ${result.delivered} of ${result.attempted} device${result.attempted === 1 ? '' : 's'}.`,
      });
    } catch (error) {
      setState({ status: 'error', message: error.message || 'Broadcast failed' });
    }
  }

  return (
    <div className="debug-panel">
      <p className="showcase-hint danger-hint">
        Unlike the rest of this menu, this sends a real push notification to <strong>every</strong> registered device,
        including your own.
      </p>

      <label className="debug-note">
        Title
        <input value={title} maxLength={120} onChange={e => setTitle(e.target.value)} />
      </label>
      <label className="debug-note">
        Body
        <textarea value={body} maxLength={300} onChange={e => setBody(e.target.value)} />
      </label>

      <div className="token-sheet">
        <span className="mf-kicker">Insertable variables</span>
        {describeTokens().map(({ token, hint }) => (
          <button
            key={token}
            type="button"
            className="token-chip"
            title={`Append ${token} to the body`}
            onClick={() => setBody(prev => `${prev}${prev && !prev.endsWith(' ') ? ' ' : ''}${token}`)}
          >
            <code>{token}</code>
            <em>{hint}</em>
          </button>
        ))}
      </div>

      <div className="broadcast-preview">
        <span className="mf-kicker">Preview</span>
        <strong>{preview.title || <i>(no title)</i>}</strong>
        <p>{preview.body || <i>(no body)</i>}</p>
        <small>
          {'{{USER}}'} shows your name here; each recipient sees their own. {'{{CREW}}'} resolves on send.
        </small>
      </div>

      {typos.length > 0 && <p className="broadcast-warn">Unrecognised, will send literally: {typos.join(', ')}</p>}
      {state.status === 'error' && <p className="broadcast-warn">{state.message}</p>}
      {state.status === 'sent' && <p className="broadcast-ok">{state.message}</p>}

      <div className="picker-actions">
        <button
          className="mf-button danger"
          disabled={blank || state.status === 'sending'}
          onClick={() => setConfirm(true)}
        >
          {state.status === 'sending' ? 'SENDING…' : 'BROADCAST TO ALL USERS'}
        </button>
      </div>

      {confirm &&
        createPortal(
          <div className="confirm-back" onClick={() => setConfirm(false)}>
            <div className="confirm-box mf-frame" onClick={e => e.stopPropagation()}>
              <h2>Send to everyone?</h2>
              <p>This pushes to every registered device on the crew. It cannot be recalled.</p>
              <div className="broadcast-preview">
                <strong>{preview.title || <i>(no title)</i>}</strong>
                <p>{preview.body || <i>(no body)</i>}</p>
              </div>
              <div className="picker-actions">
                <button className="mf-button ghost" onClick={() => setConfirm(false)}>
                  CANCEL
                </button>
                <button className="mf-button danger" onClick={send}>
                  SEND IT
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}

/* -------------------------------- Tools tab ------------------------------- */

function ToolsTab({ logoSrc }) {
  const [lightbox, setLightbox] = useState(false);
  return (
    <div className="debug-panel">
      <p className="showcase-hint">
        Unwired components, opened by hand. The lightbox is not attached to any app behaviour yet.
      </p>
      <div className="picker-actions">
        <button className="mf-button ghost" onClick={() => setLightbox(true)}>
          OPEN LIGHTBOX
        </button>
      </div>
      {lightbox && <Lightbox src={logoSrc} alt="Lightbox placeholder" onClose={() => setLightbox(false)} />}
    </div>
  );
}

/* ------------------------------- Debug menu ------------------------------- */

export function DebugMenu({ debug, username, logoSrc, onClose }) {
  const [tab, setTab] = useState('bust');
  const [form, setForm] = useState({
    note: 'Debug bust',
    temp_f: '72',
    pressure: '1013',
    city: 'Debug Bay',
    lat: '',
    long: '',
    elevation_ft: '100',
    tide_ft: '1.0',
    btc_usd: '67000',
    timestamp: new Date().toISOString().slice(0, 16),
  });
  const [pick, setPick] = useState('');
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const unlockables = useMemo(() => achievements.slice().sort((a, b) => a.name.localeCompare(b.name)), []);

  const field = (label, key, props = {}) => (
    <label>
      {label}
      <input value={form[key]} onChange={e => set(key, e.target.value)} {...props} />
    </label>
  );

  return createPortal(
    <div className="ach-detail-back" onClick={onClose}>
      <div className="debug-box mf-frame" onClick={e => e.stopPropagation()}>
        <button className="detail-close" onClick={onClose} aria-label="Close debug menu">
          <X />
        </button>
        <h2>Debug Menu</h2>

        <div className="debug-tabs" role="tablist" aria-label="Debug sections">
          {TABS.map(({ id, label }) => (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              className={tab === id ? 'active' : ''}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'bust' && (
          <div className="debug-panel">
            <p className="showcase-hint">Session-only. Nothing here writes to the database or alerts the crew.</p>
            <div className="debug-grid">
              <label>
                Time
                <input type="datetime-local" value={form.timestamp} onChange={e => set('timestamp', e.target.value)} />
              </label>
              {field('Temp °F', 'temp_f', { type: 'number' })}
              {field('Pressure hPa', 'pressure', { type: 'number' })}
              {field('Altitude ft ASL', 'elevation_ft', { type: 'number' })}
              {field('Tide ft (+high/-low)', 'tide_ft', { type: 'number', step: '0.1' })}
              {field('BTC USD', 'btc_usd', { type: 'number', step: '1' })}
              {field('City', 'city')}
              {field('Latitude', 'lat', { type: 'number' })}
              {field('Longitude', 'long', { type: 'number' })}
            </div>
            <label className="debug-note">
              Note
              <textarea value={form.note} maxLength={240} onChange={e => set('note', e.target.value)} />
            </label>
            <div className="picker-actions">
              <button className="mf-button" onClick={() => debug.onBust(form)}>
                ADD DEBUG BUST
              </button>
            </div>
          </div>
        )}

        {tab === 'progress' && (
          <div className="debug-panel">
            <p className="showcase-hint">Fake XP and unlock visuals for this session only.</p>
            <div className="debug-grid">
              <label>
                XP Override
                <input
                  type="number"
                  value={debug.xp}
                  onChange={e => debug.setXp(Math.max(0, Number(e.target.value) || 0))}
                />
              </label>
            </div>
            <div className="debug-unlock">
              <select value={pick} onChange={e => setPick(e.target.value)}>
                <option value="">Select unlock visual…</option>
                {unlockables.map(a => (
                  <option key={a.id} value={a.id}>
                    {a.name} · {a.kind} · {a.points} XP
                  </option>
                ))}
              </select>
              <button
                className="mf-button ghost"
                disabled={!pick}
                onClick={() => {
                  debug.onUnlock(pick);
                  setPick('');
                }}
              >
                TRIGGER UNLOCK
              </button>
            </div>
          </div>
        )}

        {tab === 'notify' && <NotifyTab username={username} />}
        {tab === 'tools' && <ToolsTab logoSrc={logoSrc} />}

        {tab === 'session' && (
          <div className="debug-panel">
            <p className="showcase-hint">
              {debug.counts.busts} debug busts · {debug.counts.unlocks} debug unlocks · {debug.xp} debug XP
            </p>
            <div className="picker-actions">
              <button className="mf-button ghost" onClick={debug.onResetCooldown}>
                RESET COOLDOWN OVERRIDE
              </button>
              <button className="mf-button ghost danger" onClick={debug.onClear}>
                CLEAR DEBUG SESSION
              </button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
