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
import { MIcon, matMap } from './badgeIcons.jsx';
import { Lightbox } from './Lightbox.jsx';

const TABS = [
  { id: 'bust', label: 'BUST' },
  { id: 'progress', label: 'PROGRESS' },
  { id: 'notify', label: 'NOTIFY' },
  { id: 'accounts', label: 'ACCOUNTS' },
  { id: 'tools', label: 'TOOLS' },
  { id: 'session', label: 'SESSION' },
];

/* --------------------------- Achievement picker --------------------------- */

/*
 * 132 achievements is too many to remember ids for, so the {{ACHIEVEMENT:…}}
 * token gets a browser. Sprites resolve exactly the way the trophy cabinet
 * resolves them, and are tinted by the tier's own --tier colour, so a row here
 * looks like the badge it will name.
 */
function AchievementPicker({ onPick, onClose }) {
  const [query, setQuery] = useState('');
  const rows = useMemo(() => {
    const sorted = achievements.slice().sort((a, b) => a.name.localeCompare(b.name));
    const needle = query.trim().toLowerCase();
    if (!needle) return sorted;
    return sorted.filter(
      item =>
        item.name.toLowerCase().includes(needle) ||
        item.id.toLowerCase().includes(needle) ||
        item.tier.toLowerCase().includes(needle)
    );
  }, [query]);

  return createPortal(
    <div className="confirm-back" onClick={onClose}>
      <div className="ach-picker mf-frame" onClick={e => e.stopPropagation()}>
        <button className="detail-close" onClick={onClose} aria-label="Close achievement list">
          <X />
        </button>
        <h2>Achievements</h2>
        <input
          className="ach-picker-filter"
          autoFocus
          placeholder="Filter by name, id or tier…"
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
        <div className="ach-picker-list">
          {rows.map(item => (
            <button
              key={item.id}
              type="button"
              className={`ach-picker-row tier-${item.tier}`}
              onClick={() => onPick(item.id)}
            >
              <span className="ach-picker-sprite">
                <MIcon name={item.micon || matMap[item.icon] || 'shield'} />
              </span>
              <span className="ach-picker-name">{item.name}</span>
              <span className="tier-chip">{item.tier}</span>
              <code>{item.id}</code>
            </button>
          ))}
          {rows.length === 0 && <p className="showcase-hint">Nothing matches “{query}”.</p>}
        </div>
      </div>
    </div>,
    document.body
  );
}

/* ------------------------------- Notify tab ------------------------------- */

function NotifyTab({ username, users }) {
  const [title, setTitle] = useState('{{USER}} has busted');
  const [body, setBody] = useState('Sent by {{SENDER}} at {{TIME}} on {{DATE}}.');
  const [confirm, setConfirm] = useState(false);
  const [picker, setPicker] = useState(false);
  const [singleUser, setSingleUser] = useState(true);
  const [recipientQuery, setRecipientQuery] = useState('');
  const [recipientIds, setRecipientIds] = useState(() => {
    const currentUser = (users || []).find(user => user.username.toLowerCase() === username.toLowerCase());
    return currentUser ? [currentUser.id] : [];
  });
  const [state, setState] = useState({ status: 'idle', message: '' });

  const roster = useMemo(
    () => (users || []).slice().sort((a, b) => String(a.username).localeCompare(String(b.username))),
    [users]
  );
  const matchingRecipients = roster.filter(user => user.username.toLowerCase().includes(recipientQuery.trim().toLowerCase()));
  const selectedNames = roster.filter(user => recipientIds.includes(user.id)).map(user => user.username);

  /* Preview uses your own name for {{USER}}, which is only exact for your own
   * device — every other recipient sees their own. Labelled as such below. */
  const context = { recipient: username, sender: username, crew: 0, sentAt: new Date(), timeZone: undefined };
  const preview = { title: renderBroadcast(title, context), body: renderBroadcast(body, context) };
  const typos = useMemo(() => unknownTokens(`${title} ${body}`), [title, body]);
  const blank = !title.trim() && !body.trim();
  const appendToken = token => setBody(prev => `${prev}${prev && !prev.endsWith(' ') ? ' ' : ''}${token}`);

  async function send() {
    setConfirm(false);
    setState({ status: 'sending', message: '' });
    try {
      const result = await backend.broadcastTestNotification({ title, body, userIds: singleUser ? recipientIds : null });
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
        Unlike the rest of this menu, this sends a real push notification to{' '}
        <strong>{singleUser ? 'the selected users' : 'every registered device'}</strong>, including your own when selected.
      </p>

      <label className="debug-note">
        Title
        <input value={title} maxLength={120} onChange={e => setTitle(e.target.value)} />
      </label>
      <label className="debug-note">
        Body
        <textarea value={body} maxLength={300} onChange={e => setBody(e.target.value)} />
      </label>

      <div className={`recipient-picker${singleUser ? '' : ' disabled'}`}>
        <label className="recipient-toggle">
          <input type="checkbox" checked={singleUser} onChange={e => setSingleUser(e.target.checked)} />
          Send to selected users
        </label>
        <input
          type="search"
          disabled={!singleUser}
          value={recipientQuery}
          placeholder="Filter usernames"
          onChange={e => setRecipientQuery(e.target.value)}
        />
        <div className="recipient-list" aria-label="Recipients">
          {matchingRecipients.map(user => (
            <label key={user.id}>
              <input
                type="checkbox"
                disabled={!singleUser}
                checked={recipientIds.includes(user.id)}
                onChange={e => setRecipientIds(ids => e.target.checked ? [...ids, user.id] : ids.filter(id => id !== user.id))}
              />
              {user.username}
            </label>
          ))}
        </div>
        {singleUser && <small>{selectedNames.length ? selectedNames.join(', ') : 'Select at least one user.'}</small>}
      </div>

      <div className="token-sheet">
        <span className="mf-kicker">Insertable variables</span>
        {describeTokens().map(({ token, hint }) => (
          <span key={token} className="token-slot">
            <button
              type="button"
              className="token-chip"
              title={`Append ${token} to the body`}
              onClick={() => appendToken(token)}
            >
              <code>{token}</code>
              <em>{hint}</em>
            </button>
            {token.startsWith('{{ACHIEVEMENT') && (
              <button
                type="button"
                className="token-info"
                title="Browse every achievement"
                aria-label="Browse every achievement"
                onClick={() => setPicker(true)}
              >
                i
              </button>
            )}
          </span>
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
          disabled={blank || state.status === 'sending' || (singleUser && !recipientIds.length)}
          onClick={() => setConfirm(true)}
        >
          {state.status === 'sending' ? 'SENDING…' : singleUser ? 'SEND TO SELECTED USERS' : 'BROADCAST TO ALL USERS'}
        </button>
      </div>

      {picker && (
        <AchievementPicker
          onClose={() => setPicker(false)}
          onPick={id => {
            appendToken(`{{ACHIEVEMENT:${id}}}`);
            setPicker(false);
          }}
        />
      )}

      {confirm &&
        createPortal(
          <div className="confirm-back" onClick={() => setConfirm(false)}>
            <div className="confirm-box mf-frame" onClick={e => e.stopPropagation()}>
              <h2>{singleUser ? 'Send to selected users?' : 'Send to everyone?'}</h2>
              <p>{singleUser ? `This pushes to ${selectedNames.join(', ')}. It cannot be recalled.` : 'This pushes to every registered device on the crew. It cannot be recalled.'}</p>
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

/* ------------------------------ Accounts tab ------------------------------ */

/*
 * Force-set another account's password. This is account takeover, and it is
 * gated by the same allowlist as the broadcast — see _shared/adminAuth.ts. The
 * service-role key that performs it never reaches the browser; all that leaves
 * here is a user id and a new password over an authenticated call.
 */
function AccountsTab({ users }) {
  const [target, setTarget] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [state, setState] = useState({ status: 'idle', message: '' });

  const roster = useMemo(
    () => (users || []).slice().sort((a, b) => String(a.username).localeCompare(String(b.username))),
    [users]
  );
  const chosen = roster.find(user => user.id === target);
  const tooShort = password.length > 0 && password.length < 6;
  const ready = Boolean(target) && password.length >= 6;

  async function apply() {
    setConfirm(false);
    setState({ status: 'working', message: '' });
    try {
      const result = await backend.adminSetPassword({ userId: target, password });
      if (!result?.ok) {
        setState({ status: 'error', message: result?.error || result?.reason || 'Password update failed' });
        return;
      }
      setState({ status: 'done', message: `Password updated for ${result.username || chosen?.username}.` });
      setPassword('');
    } catch (error) {
      setState({ status: 'error', message: error.message || 'Password update failed' });
    }
  }

  return (
    <div className="debug-panel">
      <p className="showcase-hint danger-hint">
        Sets an account&rsquo;s password without knowing the old one. The owner is <strong>not</strong> told, and their
        existing sessions keep working until they sign out.
      </p>

      <label className="debug-note">
        Account
        <select value={target} onChange={e => setTarget(e.target.value)}>
          <option value="">Select an operator&hellip;</option>
          {roster.map(user => (
            <option key={user.id} value={user.id}>
              {user.username}
            </option>
          ))}
        </select>
      </label>

      <label className="debug-note">
        New password
        <input
          type="text"
          value={password}
          maxLength={200}
          autoComplete="off"
          placeholder="At least 6 characters"
          onChange={e => setPassword(e.target.value)}
        />
      </label>

      {tooShort && <p className="broadcast-warn">Password must be at least 6 characters.</p>}
      {state.status === 'error' && <p className="broadcast-warn">{state.message}</p>}
      {state.status === 'done' && <p className="broadcast-ok">{state.message}</p>}

      <div className="picker-actions">
        <button
          className="mf-button danger"
          disabled={!ready || state.status === 'working'}
          onClick={() => setConfirm(true)}
        >
          {state.status === 'working' ? 'UPDATING…' : 'FORCE PASSWORD RESET'}
        </button>
      </div>

      {confirm &&
        createPortal(
          <div className="confirm-back" onClick={() => setConfirm(false)}>
            <div className="confirm-box mf-frame" onClick={e => e.stopPropagation()}>
              <h2>Reset {chosen?.username}&rsquo;s password?</h2>
              <p>
                They will only be able to sign in with the new password. They are not notified, and cannot recover the
                old one.
              </p>
              <div className="picker-actions">
                <button className="mf-button ghost" onClick={() => setConfirm(false)}>
                  CANCEL
                </button>
                <button className="mf-button danger" onClick={apply}>
                  DO IT
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}

/* ------------------------------- Debug menu ------------------------------- */

export function DebugMenu({ debug, username, users, logoSrc, onClose }) {
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

        {tab === 'notify' && <NotifyTab username={username} users={users} />}
        {tab === 'accounts' && <AccountsTab users={users} />}
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
