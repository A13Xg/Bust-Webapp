import {
  clearInstallPromptDismissal,
  detectInstallPlatform,
  installCopy,
  isStandalone,
  markInstallPromptDismissed,
  shouldShowInstallPrompt,
} from './pwaInstall.js';

const SHOW_DELAY_MS = 1400;
let deferredInstallPrompt = null;
let rendered = false;
let showTimer = null;

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;',
  })[character]);
}

function removePrompt({ dismissed = false } = {}) {
  if (dismissed) markInstallPromptDismissed();
  document.getElementById('bust-install-overlay')?.remove();
  document.getElementById('bust-install-styles')?.remove();
  rendered = false;
}

function injectStyles() {
  if (document.getElementById('bust-install-styles')) return;
  const style = document.createElement('style');
  style.id = 'bust-install-styles';
  style.textContent = `
    #bust-install-overlay{position:fixed;inset:0;z-index:2147483646;display:grid;place-items:end center;padding:20px max(16px,env(safe-area-inset-right)) calc(20px + env(safe-area-inset-bottom)) max(16px,env(safe-area-inset-left));background:linear-gradient(180deg,transparent 0,rgba(0,0,0,.58) 45%,rgba(0,0,0,.9) 100%);font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    #bust-install-card{width:min(100%,430px);border:1px solid rgba(255,255,255,.14);border-radius:22px;padding:20px;background:rgba(14,14,16,.97);box-shadow:0 22px 80px rgba(0,0,0,.6);color:#f6f3ee;backdrop-filter:blur(18px)}
    #bust-install-card h2{margin:0 34px 8px 0;font-size:1.3rem;line-height:1.15}
    #bust-install-card p{margin:0 0 16px;color:#c8c3bc;line-height:1.45;font-size:.96rem}
    #bust-install-close{position:absolute;top:13px;right:13px;width:38px;height:38px;border:0;border-radius:50%;background:rgba(255,255,255,.08);color:#fff;font-size:24px;line-height:1;cursor:pointer}
    #bust-install-card-inner{position:relative}
    #bust-install-actions{display:flex;gap:10px;flex-wrap:wrap}
    #bust-install-actions button{min-height:46px;border-radius:13px;padding:0 16px;font:700 .95rem/1 system-ui;border:1px solid rgba(255,255,255,.14);cursor:pointer}
    #bust-install-primary{flex:1;background:#ff6a00;color:#090909;border-color:#ff6a00!important}
    #bust-install-later{background:rgba(255,255,255,.06);color:#f5f1ea}
    #bust-install-steps{display:none;margin:12px 0 0;padding:13px 14px;border-radius:14px;background:rgba(255,255,255,.055);color:#eee9e1;font-size:.93rem;line-height:1.5}
    #bust-install-steps[data-visible="true"]{display:block}
    #bust-install-steps ol{margin:0;padding-left:20px}
    #bust-install-status{min-height:18px;margin-top:10px;color:#ffb27b;font-size:.84rem}
    @media (min-width:700px){#bust-install-overlay{place-items:center;background:rgba(0,0,0,.72)}}
  `;
  document.head.append(style);
}

function instructionMarkup(mode) {
  if (mode === 'ios-instructions') {
    return '<ol><li>Tap the Share button in Safari.</li><li>Scroll and tap <strong>Add to Home Screen</strong>.</li><li>Tap <strong>Add</strong>, then open BUST from the new icon.</li></ol>';
  }
  if (mode === 'ios-browser-warning') {
    return '<ol><li>Copy or reopen this page in Safari.</li><li>Tap Safari’s Share button.</li><li>Choose <strong>Add to Home Screen</strong>.</li></ol>';
  }
  return '<ol><li>Open your browser menu.</li><li>Choose <strong>Install app</strong> or <strong>Add to Home screen</strong>.</li><li>Open BUST from the installed icon.</li></ol>';
}

async function handlePrimaryAction(mode, status, steps) {
  if (mode !== 'native') {
    steps.dataset.visible = 'true';
    status.textContent = mode === 'ios-browser-warning' ? 'Safari is required for iPhone Home Screen installation.' : '';
    return;
  }

  const promptEvent = deferredInstallPrompt;
  if (!promptEvent) {
    steps.dataset.visible = 'true';
    status.textContent = 'The browser install prompt is not available yet. Use the browser menu instead.';
    return;
  }

  deferredInstallPrompt = null;
  try {
    await promptEvent.prompt();
    const choice = await promptEvent.userChoice;
    if (choice?.outcome === 'accepted') {
      clearInstallPromptDismissal();
      removePrompt();
      return;
    }
    status.textContent = 'Installation was not completed.';
  } catch {
    status.textContent = 'The native install prompt failed. Use the browser menu instead.';
    steps.dataset.visible = 'true';
  }
}

function renderPrompt() {
  if (rendered || isStandalone()) return;
  const platform = detectInstallPlatform();
  if (!shouldShowInstallPrompt({ platform })) return;

  const copy = installCopy(platform, Boolean(deferredInstallPrompt));
  injectStyles();

  const overlay = document.createElement('div');
  overlay.id = 'bust-install-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'bust-install-title');
  overlay.innerHTML = `
    <section id="bust-install-card">
      <div id="bust-install-card-inner">
        <button id="bust-install-close" type="button" aria-label="Dismiss install prompt">×</button>
        <h2 id="bust-install-title">${escapeHtml(copy.title)}</h2>
        <p>${escapeHtml(copy.body)}</p>
        <div id="bust-install-actions">
          <button id="bust-install-primary" type="button">${escapeHtml(copy.action)}</button>
          <button id="bust-install-later" type="button">Not now</button>
        </div>
        <div id="bust-install-steps">${instructionMarkup(copy.mode)}</div>
        <div id="bust-install-status" aria-live="polite"></div>
      </div>
    </section>`;

  const close = () => removePrompt({ dismissed: true });
  overlay.querySelector('#bust-install-close').addEventListener('click', close);
  overlay.querySelector('#bust-install-later').addEventListener('click', close);
  overlay.addEventListener('click', event => {
    if (event.target === overlay) close();
  });
  overlay.querySelector('#bust-install-primary').addEventListener('click', () => {
    void handlePrimaryAction(
      copy.mode,
      overlay.querySelector('#bust-install-status'),
      overlay.querySelector('#bust-install-steps')
    );
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && document.getElementById('bust-install-overlay')) close();
  }, { once: true });

  document.body.append(overlay);
  rendered = true;
  overlay.querySelector('#bust-install-primary')?.focus({ preventScroll: true });
}

function schedulePrompt() {
  if (showTimer || rendered) return;
  showTimer = setTimeout(() => {
    showTimer = null;
    renderPrompt();
  }, SHOW_DELAY_MS);
}

window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  deferredInstallPrompt = event;
  schedulePrompt();
});

window.addEventListener('appinstalled', () => {
  deferredInstallPrompt = null;
  clearInstallPromptDismissal();
  removePrompt();
});

function start() {
  if (isStandalone()) return;
  const platform = detectInstallPlatform();
  if (!platform.mobile) return;
  const activate = () => schedulePrompt();
  window.addEventListener('pointerdown', activate, { once: true, passive: true });
  window.addEventListener('keydown', activate, { once: true });
  setTimeout(schedulePrompt, 4500);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
else start();
