import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Bell, Bitcoin, ChevronUp, Gauge, LogOut, MapPin, Medal, Mountain, Pencil, Repeat2, Sparkles, Thermometer, Trophy, UsersRound, Volume2, VolumeX, Waves, X } from 'lucide-react';
import 'material-symbols/outlined.css';
import './styles.css';
import { achievements, capUnlocksPerBust, pickAnnounceableUnlock, computeAchievementUnlocks, deriveAllTimeRecords, derivePersonalStats, deriveStreaks, buildTrend, finiteNumber, levelForXp, timeBucket, twoHoursRemainingMs, todayKey } from './rules.js';
import { expansionItems } from './expansion.js';
import { TrendChart, DonutChart, HourHistogram, PriceLine, Sparkline, ScatterChart, HBarChart } from './charts.jsx';
import { backend } from './backend.js';
import * as sfx from './audio.js';
import tideStations from './tide-stations.json';
import { ErrorBoundary } from './ErrorBoundary.jsx';
import {
  detectPushPlatform,
  enablePushNotifications as armPushNotifications,
  getNotificationPermission,
  markSeenEvent,
  pushBlockedReason,
  PUSH_REASON_MESSAGE,
  registerPushServiceWorker,
  rotatePushEndpoint,
  showNotification,
  supportsWebPush,
} from './notifications.js';
import { buildBustNotification } from './notificationMessages.js';
import { btcMoodLabel, fetchBitcoinPriceUsd, formatBtcChange, formatBtcCompact, formatBtcUsd } from './bitcoin.js';
import {
  isInactivityReminderDue,
  loadInactivityReminderState,
  markInactivityReminderSent,
  nextInactivityReminderDelayMs,
  pickInactivityReminderMessage,
  reconcileInactivityReminderState,
  saveInactivityReminderState,
} from './inactivityReminder.js';
import { BadgeIcon, MIcon, matMap, setMsymStatus } from './badgeIcons.jsx';
import { useAchievementQueue } from './useAchievementQueue.js';
import { DebugMenu } from './DebugMenu.jsx';
import { checkForUpdate, CURRENT_BUILD_ID, shouldCheckNow } from './appVersion.js';
import { clampMenuToViewport } from './contextMenu.js';
import { useLongPress } from './useLongPress.js';
import { earnedRecords, comparisonRows, userMetrics } from './socialData.js';
import { acquireLocation, clearLocation, newestOwnLocation } from './location.js';

export const asset = p => import.meta.env.BASE_URL + String(p).replace(/^\//, '');
/* Arm web push. Returns a structured result so the UI can say *why* it failed
 * instead of showing a green light over a subscription that was never stored. */
function enablePushNotifications({ interactive = true, sendTest = false } = {}) {
  return armPushNotifications({ backend, workerPath: asset('sw.js'), interactive, sendTest });
}

/* Push subscriptions expire, get rotated, and get evicted without warning. Any
 * time the app is open with permission already granted we re-register the
 * current endpoint, which is what stops delivery from dying permanently. */
async function rearmPushSilently() {
  if (getNotificationPermission() !== 'granted' || !supportsWebPush()) return null;
  try {
    const outcome = await enablePushNotifications({ interactive: false });
    if (!outcome.ok) console.warn('[push] re-arm failed:', outcome.reason, outcome.detail || '');
    return outcome;
  } catch (error) {
    console.warn('[push] re-arm threw', error);
    return null;
  }
}

/* Tell the backend to fan a just-created row out to the rest of the crew. Never
 * throws into the caller: dispatch-push-backstop re-sends anything lost here. */
function announceToCrew(kind, id) {
  if (!id) return;
  Promise.resolve(backend.notifyEvent?.(kind, id)).catch(error =>
    console.warn('[push] crew announcement failed', kind, id, error?.message || error)
  );
}
function avatar(seed) { return `https://api.dicebear.com/9.x/identicon/svg?seed=${encodeURIComponent(seed || 'bust')}&backgroundColor=0a0a0b&rowColor=ff5e00,f5f0e8`; }
function within(promise,ms){let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Timed out')),ms);})]).finally(()=>clearTimeout(timer));}
function fmt(ts) { return new Date(ts).toLocaleString([], { month:'short', day:'numeric', hour:'numeric', minute:'2-digit' }); }
function rankForDay(bust, busts) { const d = new Date(bust.timestamp).toDateString(); const list = busts.filter(b=>new Date(b.timestamp).toDateString()===d).sort((a,b)=>new Date(a.timestamp)-new Date(b.timestamp)); return list.findIndex(b=>b.id===bust.id)+1 || '—'; }
function pressureLabel(p){ p=finiteNumber(p); if(p==null) return null; if(p<990) return 'Very Low'; if(p<1005) return 'Low'; if(p<1015) return 'Medium'; if(p<1025) return 'High'; return 'Very High'; }
function elevationLabel(ft){ ft=finiteNumber(ft); return ft!=null?`${Math.round(ft)}ft ASL`:'—'; }
function tideLabel(ft){ ft=finiteNumber(ft); return ft!=null?`${ft>=0?'High':'Low'} / ${Math.abs(ft).toFixed(1)}ft`:'—'; }
function nearestTideStationId(lat,long){ let best=null,bestD=Infinity; const R=3958.8,toR=x=>x*Math.PI/180; for(const [id,slat,slng] of tideStations){ const dLat=toR(slat-lat),dLon=toR(slng-long); const h=Math.sin(dLat/2)**2+Math.cos(toR(lat))*Math.cos(toR(slat))*Math.sin(dLon/2)**2; const d=2*R*Math.asin(Math.sqrt(h)); if(d<bestD){bestD=d;best=id;} } return best; }
async function fetchTideFt(lat,long,signal){
  const stationId=nearestTideStationId(lat,long);
  if(!stationId) return null;
  const response=await fetch(`https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?station=${stationId}&product=predictions&datum=MTL&time_zone=gmt&units=english&interval=6&date=today&format=json`,{signal});
  if(!response.ok)return null;
  const data=await response.json();
  const points=data?.predictions;
  if(!Array.isArray(points)||!points.length) return null;
  const now=Date.now();
  const nearest=points.reduce((best,p)=>{ const t=new Date(p.t.replace(' ','T')+'Z').getTime(); const diff=Math.abs(t-now); return diff<best.diff?{diff,v:Number(p.v)}:best; },{diff:Infinity,v:null});
  return Number.isFinite(nearest.v)?nearest.v:null;
}
function pressureBandValue(p){ p=finiteNumber(p); if(p==null) return null; if(p<990) return 0; if(p<1005) return 1; if(p<1015) return 2; if(p<1025) return 3; return 4; }
function tempBandValue(t){ t=finiteNumber(t); if(t==null) return null; if(t<32) return 0; if(t<52) return 1; if(t<72) return 2; if(t<92) return 3; return 4; }
const tierUrl = t => ['bronze','silver','gold','platinum','mythic'].includes(t) ? asset(`badges/512/${t}.png`) : null;
function AchievementCard({item,unlocked,onClick}){ return <div className={`ach-card mf-frame ${unlocked?'won':'locked'} tier-${item.tier}${onClick?' clickable':''}`} onClick={onClick} role={onClick?'button':undefined} tabIndex={onClick?0:undefined} onKeyDown={e=>{if(onClick&&(e.key==='Enter'||e.key===' ')){e.preventDefault();onClick();}}}>
  <MIcon name={item.micon||matMap[item.icon]||'shield'} className="ach-icon"/>
  <h3>{item.name}</h3>
  <p>{item.desc}</p>
  <div className="ach-foot"><span className="ach-xp">{item.points} XP</span><span className="tier-chip"><img className="tier-img" src={tierUrl(item.tier)} alt={item.tier}/><b>{item.tier}</b></span></div>
</div> }
/** Enlarged achievement card popup. Closes via X, backdrop click, or Escape. */
function AchDetail({item,unlocked,progress,onClose}){
  useEffect(()=>{ const onKey=e=>{ if(e.key==='Escape') onClose(); }; window.addEventListener('keydown',onKey); return()=>window.removeEventListener('keydown',onKey); },[onClose]);
  // Portal to <body>: ancestors with transform/backdrop-filter hijack position:fixed.
  return createPortal(<motion.div className="ach-detail-back" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} onClick={onClose}>
    <motion.div className={`ach-detail mf-frame tier-${item.tier} ${unlocked?'won':'locked'}`} initial={{scale:.85,y:14}} animate={{scale:1,y:0}} onClick={e=>e.stopPropagation()}>
      <button className="detail-close" onClick={onClose} aria-label="Close"><X/></button>
      <MIcon name={item.micon||matMap[item.icon]||'shield'} className="ach-icon xl"/>
      <h2>{item.name}</h2>
      <p>{item.desc}</p>
      {progress&&<div className="xp-bar ach-progress" title={`${progress.label} complete`}><i style={{width:`${progress.pct}%`}}/><b>{progress.label}</b></div>}
      <div className="ach-detail-meta">
        <span className="tier-chip"><img className="tier-img" src={tierUrl(item.tier)} alt={item.tier}/><b>{item.tier}</b></span>
        <span className="meta-pill">{item.points} XP</span>
        <span className="meta-pill">{(item.kind||'').toUpperCase()}</span>
        {item.category&&<span className="meta-pill">{item.category.toUpperCase()}</span>}
      </div>
      <em className={`ach-status ${unlocked?'on':''}`}>{unlocked?'UNLOCKED':'LOCKED'}</em>
    </motion.div>
  </motion.div>, document.body) }
/** Up to 3 pinned badges rendered inline beside a username. */
let SHOWCASE_MAP={};
function earnedIdSet(unlocks,userId){ return new Set(unlocks.filter(a=>a.user_id===userId).map(a=>a.achievement_type)); }
function earnedItems(unlocks,userId){ const set=earnedIdSet(unlocks,userId); return [...set].map(id=>achievements.find(x=>x.id===id)).filter(Boolean).sort((a,b)=>b.points-a.points); }
function validShowcaseIds(showcase,earnedSet){ return String(showcase||'').split(',').filter(id=>earnedSet.has(id)).slice(0,3); }
function NameBadges({userId}){ const ids=SHOWCASE_MAP[userId]||[]; if(!ids.length) return null; return <span className="name-badges">{ids.map(id=>{ const it=achievements.find(a=>a.id===id); return it?<i key={id} className={`name-badge tier-${it.tier}`} title={`${it.name} (${it.tier})`}><MIcon name={it.micon||matMap[it.icon]||'shield'}/></i>:null; })}</span> }
function createRestorationSummaryBadge(count){ return { id:`restored-${Date.now()}-${count}`, name:`${count} historical achievements restored`, tier:'platinum', points:0, icon:'Sparkles', accent:'#95d5b2', isRestorationSummary:true, restoredCount:count }; }
function progressGoal(item){ const text=`${item.desc||''} ${item.name||''}`; const n=text.match(/\b(\d[\d,]*)\b/); if(item.id==='xp_tycoon') return 2000; if(item.id==='the_collector') return 5; if(item.kind==='achievement'&&Number(item.goal||1)===1) return 1; if(/all five/i.test(text)) return 5; if(/all 7/i.test(text)) return 7; if(/everything else/i.test(text)) return achievements.length-1; return n?Number(n[1].replace(/,/g,'')):Number(item.goal)||1; }
function itemProgress(item,busts=[],user,unlocks=[]){
  const own=busts.filter(b=>b.user_id===user.id).sort((a,b)=>new Date(a.timestamp)-new Date(b.timestamp));
  const unlocked=unlocks.some(a=>a.user_id===user.id&&a.achievement_type===item.id);
  const goal=progressGoal(item);
  const cap=n=>Math.min(goal,Math.max(0,n||0));
  const distinct=fn=>new Set(own.map(fn).filter(v=>v!=null&&v!=='')).size;
  const count=fn=>own.filter(fn).length;
  const notes=own.map(b=>String(b.note||'')).filter(n=>n.trim().length);
  if(unlocked) return {value:goal,goal,pct:100,label:`${goal}/${goal}`};
  let value=0;
  if(item.track==='legacy') value={first_release:own.length,double_shift:Math.max(0,...Object.values(own.reduce((m,b)=>{const k=todayKey(b.timestamp);m[k]=(m[k]||0)+1;return m;},{}))),night_ops:count(b=>timeBucket(b.timestamp)==='Late Night'),early_bird:count(b=>timeBucket(b.timestamp)==='Early Morning'),heat_seeker:count(b=>finiteNumber(b.temp_f)!=null&&finiteNumber(b.temp_f)>85),cold_front:count(b=>finiteNumber(b.temp_f)!=null&&finiteNumber(b.temp_f)<45),high_pressure:count(b=>finiteNumber(b.pressure)!=null&&finiteNumber(b.pressure)>1020),field_reporter:count(b=>(b.note||'').trim().length>=30),hat_trick:own.length,week_warrior:own.length,cartographer:count(b=>finiteNumber(b.lat)!=null&&finiteNumber(b.long)!=null)}[item.id]||0;
  else if(item.track==='scorcher') value=count(b=>finiteNumber(b.temp_f)!=null&&finiteNumber(b.temp_f)>100);
  else if(item.track==='daypart') value=distinct(b=>['Early Morning','Morning'].includes(timeBucket(b.timestamp))?'morning':timeBucket(b.timestamp)==='Afternoon'?'noon':'night');
  else if(item.track==='marathon') value=own.length;
  else if(item.track==='weekend') value=Math.max(distinct(b=>[0,6].includes(new Date(b.timestamp).getDay())?new Date(b.timestamp).getDay():null),count(b=>[0,6].includes(new Date(b.timestamp).getDay())));
  else if(item.track==='pressure') value=count(b=>finiteNumber(b.pressure)!=null&&finiteNumber(b.pressure)>1020);
  else if(item.track==='cold') value=count(b=>finiteNumber(b.temp_f)!=null&&finiteNumber(b.temp_f)<45);
  else if(item.track==='scribe') value=count(b=>(b.note||'').trim().length>=30);
  else if(item.track==='cartographer') value=count(b=>finiteNumber(b.lat)!=null&&finiteNumber(b.long)!=null);
  else if(item.track==='streak') value=Math.max(...Object.values(own.reduce((m,b)=>{const k=todayKey(b.timestamp);m[k]=(m[k]||0)+1;return m;},{})),own.length);
  else if(item.track==='night') value=count(b=>timeBucket(b.timestamp)==='Late Night');
  else if(item.track==='expansion') value={on_the_dot:count(b=>new Date(b.timestamp).getMinutes()===0),minute_hand:count(b=>new Date(b.timestamp).getMinutes()===0),second_hand:count(b=>new Date(b.timestamp).getMinutes()===0),weather_vane:distinct(b=>pressureBandValue(b.pressure)),thermometer_breaker:distinct(b=>tempBandValue(b.temp_f)),storm_rider:count(b=>pressureBandValue(b.pressure)===0),sea_level_scout:count(b=>finiteNumber(b.elevation_ft)!=null&&finiteNumber(b.elevation_ft)<100),thin_air:count(b=>finiteNumber(b.elevation_ft)!=null&&finiteNumber(b.elevation_ft)>=5280),cloudline_climber:count(b=>finiteNumber(b.elevation_ft)!=null&&finiteNumber(b.elevation_ft)>=8000),mile_high_club:count(b=>finiteNumber(b.elevation_ft)!=null&&finiteNumber(b.elevation_ft)>=5280),altitude_sampler:distinct(b=>{const e=finiteNumber(b.elevation_ft); if(e==null) return null; if(e<100)return 0; if(e<1000)return 1; if(e<5280)return 2; if(e<8000)return 3; return 4;}),summit_circuit:count(b=>finiteNumber(b.elevation_ft)!=null&&finiteNumber(b.elevation_ft)>=8000),odometer:(()=>{const pts=own.filter(b=>finiteNumber(b.lat)!=null&&finiteNumber(b.long)!=null); let sum=0; const R=3958.8,toR=x=>x*Math.PI/180; for(let i=1;i<pts.length;i++){const a=pts[i-1],c=pts[i]; const aLat=finiteNumber(a.lat),aLong=finiteNumber(a.long),cLat=finiteNumber(c.lat),cLong=finiteNumber(c.long); if(aLat==null||aLong==null||cLat==null||cLong==null) continue; const dLat=toR(cLat-aLat),dLon=toR(cLong-aLong); const h=Math.sin(dLat/2)**2+Math.cos(toR(aLat))*Math.cos(toR(cLat))*Math.sin(dLon/2)**2; sum+=2*R*Math.asin(Math.sqrt(h));} return Math.round(sum);})(),landmark_legend:Math.max(0,...Object.values(own.reduce((m,b)=>{if(b.city)m[b.city]=(m[b.city]||0)+1;return m;},{}))),novelist:count(b=>String(b.note||'').length>=240),full_manuscript:count(b=>String(b.note||'').length>=240),shakespeare:count(b=>/\b(thee|thou|thy)\b/i.test(b.note||'')),bard_of_the_bay:count(b=>/\b(thee|thou|thy)\b/i.test(b.note||'')),emoji_dictionary:new Set(notes.join(' ').match(/\p{Extended_Pictographic}/gu)||[]).size,completionist_i:earnedIdSet(unlocks,user.id).size,completionist_ii:earnedIdSet(unlocks,user.id).size,completionist_iii:earnedIdSet(unlocks,user.id).size,xp_tycoon:[...earnedIdSet(unlocks,user.id)].map(id=>achievements.find(x=>x.id===id)?.points||0).reduce((s,p)=>s+p,0),the_collector:(()=>{const ids=earnedIdSet(unlocks,user.id); const cats=['Timing & Precision','Squad Play','Calendar','Expedition','Wordsmith']; return cats.filter(cat=>expansionItems.some(i=>i.kind==='badge'&&i.category===cat&&ids.has(i.id))).length;})()}[item.id]??0;
  return {value:cap(value),goal,pct:Math.min(100,Math.round(cap(value)/goal*100)),label:`${cap(value)}/${goal}`};
}

/** Scrollable badge picker: check up to 3, then APPLY. */
function ShowcasePicker({unlocked,initial,onApply,onClose}){
  const [sel,setSel]=useState(initial);
  useEffect(()=>{ const onKey=e=>{ if(e.key==='Escape') onClose(); }; window.addEventListener('keydown',onKey); return()=>window.removeEventListener('keydown',onKey); },[onClose]);
  return createPortal(<div className="ach-detail-back" onClick={onClose}>
    <div className="picker-box mf-frame" onClick={e=>e.stopPropagation()}>
      <button className="detail-close" onClick={onClose} aria-label="Close"><X/></button>
      <h2>Edit Showcase</h2>
      <p className="showcase-hint">Check up to 3 badges to display beside your name.</p>
      <div className="picker-list">
        {unlocked.map(b=>{ const on=sel.includes(b.id); const full=!on&&sel.length>=3;
          return <label key={b.id} className={`picker-row tier-${b.tier}${on?' on':''}${full?' full':''}`}>
            <input type="checkbox" checked={on} disabled={full} onChange={()=>setSel(on?sel.filter(x=>x!==b.id):[...sel,b.id])}/>
            <MIcon name={b.micon||matMap[b.icon]||'shield'}/>
            <span>{b.name}</span><em>{b.tier} · {b.points} XP</em>
          </label>; })}
      </div>
      <div className="picker-actions"><span className="count-pill">{sel.length}/3</span><button className="mf-button ghost" onClick={onClose}>CANCEL</button><button className="mf-button" onClick={()=>onApply(sel)}>APPLY</button></div>
    </div>
  </div>, document.body) }
/** Destructive-action modal: requires typing DELETE ACCOUNT verbatim. */
function DeleteAccountModal({onClose,onDeleted}){
  const [text,setText]=useState(''); const [busy,setBusy]=useState(false); const [err,setErr]=useState('');
  return createPortal(<div className="ach-detail-back" onClick={onClose}>
    <div className="picker-box confirm-box mf-frame" onClick={e=>e.stopPropagation()}>
      <button className="detail-close" onClick={onClose} aria-label="Close"><X/></button>
      <h2>Delete Account</h2>
      <p className="showcase-hint">This permanently erases your operator, every bust, and every achievement. There is no undo. Type <b>DELETE ACCOUNT</b> to confirm.</p>
      <input className="confirm-input" value={text} onChange={e=>setText(e.target.value)} placeholder="DELETE ACCOUNT" autoFocus/>
      <button className="mf-button danger" disabled={busy||text!=='DELETE ACCOUNT'} onClick={async()=>{ setBusy(true); setErr(''); try{ await backend.deleteAccount(); onDeleted(); }catch(e){ setErr(e.message); setBusy(false); } }}>{busy?'ERASING…':'DELETE FOREVER'}</button>
      {err&&<div className="error">{err}</div>}
    </div>
  </div>, document.body) }

function Login({ onAuthed }) {
  const [mode, setMode] = useState('login'); const [form,setForm]=useState({username:'',password:'',inviteCode:''}); const [error,setError]=useState(''); const [busy,setBusy]=useState(false);
  async function submit(e){ e.preventDefault(); setBusy(true); setError(''); try { const user = await backend[mode](form); onAuthed(user); } catch(err){ setError(err.message); } finally{ setBusy(false); }}
  return <main className="login-shell"><section className="auth-card mf-frame"><img className="login-logo" src={asset('bust-logo.png')} alt="BUST"/><p className="auth-copy">A real-time satirical pressure logging terminal for a trusted crew.</p><form onSubmit={submit}><label>Username<input value={form.username} onChange={e=>setForm({...form,username:e.target.value})} autoFocus /></label><label>Password<input type="password" value={form.password} onChange={e=>setForm({...form,password:e.target.value})} /></label>{mode==='signup'&&<label>Invite code<input value={form.inviteCode} onChange={e=>setForm({...form,inviteCode:e.target.value})} /></label>}<button className="mf-button" disabled={busy}>{busy?'TRANSMITTING…':mode==='login'?'ENTER BAY':'CREATE OPERATOR'}</button></form>{error&&<div className="error">{error}</div>}<button className="text-link" onClick={()=>setMode(mode==='login'?'signup':'login')}>{mode==='login'?'Need access? Bring the secret handshake.':'Already cleared? Login.'}</button></section></main>
}

function App(){ const [user,setUser]=useState(null); const [boot,setBoot]=useState(true); useEffect(()=>{backend.me().then(setUser).catch(()=>{}).finally(()=>setBoot(false))},[]); useEffect(()=>{ if(!supportsWebPush()) return; void registerPushServiceWorker(navigator, asset('sw.js')); },[]); if(boot) return <div className="boot">UNPACKING BUST BAY…</div>; return user?<Dashboard key={user.id} user={user} setUser={setUser}/>:<Login onAuthed={setUser}/> }

/* Two conditions the app is otherwise silent about, both of which end with the
 * user receiving nothing while believing everything is fine.
 *
 * The update bar is deliberately non-blocking: a reload mid-charge would cost a
 * bust, and the stale build still works — it is just missing fixes. A hard gate
 * would be worse than the problem.
 *
 * The permission bar only appears on a CONFIRMED denial, where a re-request can
 * still route the user to site settings. A dismissed prompt is not a denial. */
function StatusBanners({updateReady,permissionLost,onDismissUpdate,onFixPermission}){
  if(!updateReady&&!permissionLost) return null;
  return <div className="status-banners">
    {updateReady&&<div className="status-banner status-banner--update"><span>A newer build of BUST is live.</span><button onClick={()=>location.reload()}>UPDATE</button><button className="status-banner__dismiss" onClick={onDismissUpdate} aria-label="Dismiss">×</button></div>}
    {permissionLost&&<div className="status-banner status-banner--warn"><span>Notifications are blocked — you will miss crew alerts.</span><button onClick={onFixPermission}>FIX</button></div>}
  </div>;
}

function Dashboard({user,setUser}){ const [busts,setBusts]=useState([]),[users,setUsers]=useState([]),[unlocks,setUnlocks]=useState([]),[dataState,setDataState]=useState('loading'); const [debugBusts,setDebugBusts]=useState([]),[debugUnlocks,setDebugUnlocks]=useState([]),[debugXp,setDebugXp]=useState(0); const [overlay,setOverlay]=useState(null),[selected,setSelected]=useState(null),[socialUserId,setSocialUserId]=useState(null),[socialAward,setSocialAward]=useState(null),[phase,setPhase]=useState('idle'),[pendingAction,setPendingAction]=useState(()=>{try{return JSON.parse(sessionStorage.getItem(`bust_pending_${user.id}`)||'null');}catch{return null;}}),[toasts,setToasts]=useState([]),[unread,setUnread]=useState(0),[muted,setMuted]=useState(sfx.isMuted()); const bustRef=useRef([]); bustRef.current=busts; const unlocksRef=useRef([]); unlocksRef.current=unlocks; const usersRef=useRef([]); usersRef.current=users; const activeRef=useRef(true); const bustInFlight=useRef(false); const changesRef=useRef({busts:new Map(),profiles:new Map(),achievements:new Map()}); const refreshId=useRef(0); const chargeSfx=useRef(null); const seenRealtimeEvents=useRef(new Set()); const [,tick]=useState(0);
  useEffect(()=>()=>{activeRef.current=false;chargeSfx.current?.stop();},[]);
  // Stale-install and revoked-permission banners. Both are conditions the app
  // cannot otherwise report: the first is invisible by definition, and the
  // second is a setting changed outside the app that silently kills delivery.
  const [updateReady,setUpdateReady]=useState(false);
  const [permissionLost,setPermissionLost]=useState(false);
  const lastUpdateCheck=useRef(null);
  const { current: badgeToast, enqueue: enqueueBadge, dismiss: dismissBadge } = useAchievementQueue(5200);
  const remaining = twoHoursRemainingMs(user.last_bust_timestamp); const locked = remaining > 0 && phase==='idle';
  /* Mirror the unread count onto the installed app icon. Supported on Android
     and desktop Chrome/Edge and on installed iOS web apps; a no-op elsewhere,
     and never allowed to throw into render. */
  useEffect(() => {
    try {
      if (unread > 0) navigator.setAppBadge?.(unread);
      else navigator.clearAppBadge?.();
    } catch { /* permission or unsupported — the in-app counter still shows it */ }
  }, [unread]);
  /* Resolve a tapped notification to something on screen. A bust opens its
     detail card; an achievement opens the trophy cabinet. A bust this client has
     not loaded yet is fetched once rather than silently ignored. */
  const openPushTarget = useCallback(async ({ kind, sourceId } = {}) => {
    if (kind === 'achievement') { setOverlay('trophy'); return; }
    if (kind !== 'bust' || !sourceId) return;
    setUnread(0);
    const known = bustRef.current.find(b => b.id === sourceId);
    if (known) { setSelected(known); return; }
    // A notification can outlive this tab's copy of the feed, so fetch once
    // rather than dropping the tap.
    try {
      const recent = await backend.recentBusts(60);
      setBusts(prev => {
        const map = new Map(prev.map(b => [b.id, b]));
        for (const bust of recent) map.set(bust.id, bust);
        return [...map.values()].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      });
      const found = recent.find(b => b.id === sourceId);
      if (found) setSelected(found); else setOverlay('alerts');
    } catch { setOverlay('alerts'); }
  }, []);
  /* Self-healing push. Browsers rotate, expire and evict push subscriptions with
   * no warning and no error — the app just stops receiving. Re-registering the
   * current endpoint on every launch (and whenever the tab comes back to the
   * foreground) turns that permanent failure into at most one missed cycle.
   * The service worker also reports rotations it handled while we were away. */
  useEffect(() => {
    if (!supportsWebPush()) return;
    let closed = false;
    const rearm = () => { if (!closed && document.visibilityState === 'visible') void rearmPushSilently(); };
    void rearmPushSilently();
    document.addEventListener('visibilitychange', rearm);
    /* An installed PWA is not a page you refresh — iOS in particular keeps one
     * document alive for weeks — so a stale install can sit there re-running an
     * old push registration path and never see a fix. Checking on foreground
     * (rate-limited in shouldCheckNow) is what surfaces that. */
    const checkUpdate = () => {
      if (closed || document.visibilityState !== 'visible') return;
      if (!shouldCheckNow(lastUpdateCheck.current)) return;
      lastUpdateCheck.current = Date.now();
      void checkForUpdate({ url: asset('version.json') }).then(stale => {
        if (!closed && stale) setUpdateReady(true);
      });
    };
    checkUpdate();
    document.addEventListener('visibilitychange', checkUpdate);
    const onMessage = event => {
      const data = event.data || {};
      if (data.type === 'bust-push-resubscribed' && data.subscription) {
        void backend.registerPushSubscription?.(data.subscription, { userAgent: navigator.userAgent || null })
          .catch(error => console.warn('[push] resubscribe handoff failed', error));
      }
      // A push that arrived while the app is open still counts as unread news.
      if (data.type === 'bust-push' && data.payload?.kind === 'bust') setUnread(n => n + 1);
      // Tapping a crew notification should land on the thing it was about, not
      // just raise the app. The worker forwards the id it put in the payload.
      if (data.type === 'bust-notification-click') openPushTarget(data.data || {});
    };
    navigator.serviceWorker?.addEventListener('message', onMessage);
    // The ServiceWorkerContainer message queue only starts implicitly when an
    // `onmessage` property is assigned. With addEventListener alone, messages
    // the worker posts (subscription rotations, push arrivals) are queued and
    // never delivered.
    navigator.serviceWorker?.startMessages?.();
    return () => {
      closed = true;
      document.removeEventListener('visibilitychange', rearm);
      document.removeEventListener('visibilitychange', checkUpdate);
      navigator.serviceWorker?.removeEventListener('message', onMessage);
    };
  }, [openPushTarget, user.id]);
  /* Permissions can be revoked outside the app — iOS Settings, a Chrome site
   * reset, a Focus mode change — and nothing tells the page. Re-check on
   * foreground and surface it, because the alternative is a user who believes
   * notifications are on and quietly receives nothing. Only a CONFIRMED denial
   * counts: 'default' means the prompt is still answerable, and 'unsupported'
   * means this browser was never going to work and is reported elsewhere. */
  useEffect(() => {
    const check = () => {
      if (document.visibilityState !== 'visible') return;
      setPermissionLost(getNotificationPermission() === 'denied');
    };
    check();
    document.addEventListener('visibilitychange', check);
    return () => document.removeEventListener('visibilitychange', check);
  }, []);
  /* Fallback nag loop for browsers with no push support (the server can't reach
   * them, so the open tab has to do it). Push-capable browsers get reminders
   * from dispatch-inactivity-reminders instead. */
  useEffect(() => {
    if (supportsWebPush()) return;
    let closed = false;
    let reminderTimer = null;
    const run = async () => {
      if (closed || !user?.id) return;
      const now = Date.now();
      const stored = loadInactivityReminderState(localStorage, user.id);
      const reconciled = reconcileInactivityReminderState({ state: stored, latestBustAt: user.last_bust_timestamp, now });
      if (!reconciled) { saveInactivityReminderState(localStorage, user.id, null); return; }
      let nextState = reconciled;
      if (isInactivityReminderDue(reconciled, user.last_bust_timestamp, now) && getNotificationPermission() === 'granted') {
        const chosen = pickInactivityReminderMessage({ lastMessageIndex: reconciled.lastMessageIndex });
        const sent = await showNotification('BUST is waiting', { body: chosen.text, tag: `bust-inactivity-${user.id}` }, { baseUrl: asset('') });
        if (sent) {
          const sentAt = Date.now();
          nextState = markInactivityReminderSent(reconciled, { now: sentAt, messageIndex: chosen.index });
        }
      }
      saveInactivityReminderState(localStorage, user.id, nextState);
      if (!closed) reminderTimer = setTimeout(run, nextInactivityReminderDelayMs(nextState, Date.now()));
    };
    void run();
    return () => { closed = true; if (reminderTimer) clearTimeout(reminderTimer); };
  }, [user.id, user.last_bust_timestamp]);
  useEffect(()=>{ if(remaining>0){ const t=setTimeout(()=>tick(x=>x+1), remaining+300); return()=>clearTimeout(t); } },[remaining]);
  const userAchievementSet = useCallback((rows) => {
    return new Set(rows.filter(a => a.user_id === user.id).map(a => a.achievement_type));
  }, [user.id]);
  const enqueueRestoredSummary = useCallback((count) => {
    if (!count) return;
    enqueueBadge([createRestorationSummaryBadge(count)]);
  }, [enqueueBadge]);
  // Persist all earned achievements (no presentation cap) and return newly saved IDs for display.
  const persistAndShowUnlocks = useCallback(async (allNew) => {
    const before = userAchievementSet(unlocksRef.current);
    const saved = await backend.saveAchievements(allNew);
    if(!activeRef.current)return;
    const allAchievements = saved.achievements || saved;
    setUnlocks(prev => [...prev.filter(a => a.user_id !== user.id), ...allAchievements]);
    const after = userAchievementSet(allAchievements);
    const newlyPersisted = [...after].filter(id => !before.has(id));
    // One bust is worth at most one achievement push, however many it unlocked.
    // The toast below still shows the per-bust cap's full pair; the crew gets a
    // single announcement. dispatch-push-backstop enforces the same cap for the
    // rows skipped here, which it would otherwise sweep up and announce.
    const announceable = pickAnnounceableUnlock(newlyPersisted);
    const announceRow = announceable
      ? allAchievements.find(row => row.user_id === user.id && row.achievement_type === announceable)
      : null;
    if (announceRow) announceToCrew('achievement', announceRow.id);
    const displayItems = capUnlocksPerBust(newlyPersisted).map(id => achievements.find(a => a.id === id)).filter(Boolean);
    if (displayItems.length) {
      enqueueBadge(displayItems);
      sfx.play('badge', {volume:.85});
    }
  }, [enqueueBadge, user.id, userAchievementSet]);
  const mergeRecentBusts = useCallback((recent = []) => {
    if (!Array.isArray(recent) || !recent.length) return;
    setBusts(prev => {
      const map = new Map(prev.map(b => [b.id, b]));
      for (const bust of recent) map.set(bust.id, bust);
      return [...map.values()].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    });
  }, []);
  const refresh = useCallback(async () => {
    const id=++refreshId.current;
    setDataState(s=>s==='ready'?'refreshing':'loading');
    let d;
    try { d=await backend.dashboard(); } catch(error) { if(id===refreshId.current)setDataState('failed'); throw error; }
    if(id!==refreshId.current)return;
    const merge=(rows,changes)=>{const byId=new Map(rows.map(row=>[row.id,row]));for(const [key,row] of changes) { if(row)byId.set(key,row);else byId.delete(key); }return [...byId.values()];};
    setBusts(merge(d.busts,changesRef.current.busts));
    setUsers(merge(d.users,changesRef.current.profiles));
    setUnlocks(merge(d.achievements,changesRef.current.achievements));
    setDataState('ready');
    try {
      const before = userAchievementSet(d.achievements);
      const reconciled = await backend.reconcileAchievements();
      if(id!==refreshId.current)return;
      const allAchievements = reconciled.achievements || reconciled;
      setUnlocks(prev => [...prev.filter(a => a.user_id !== user.id), ...allAchievements]);
      const after = userAchievementSet(allAchievements);
      const restoredCount = [...after].filter(id => !before.has(id)).length;
      if (restoredCount > 0) enqueueRestoredSummary(restoredCount);
    } catch (e) { console.warn('[reconcile]', e.message); }
  }, [enqueueRestoredSummary, user.id, userAchievementSet]);
  useEffect(()=>{ let current=true; const requestCounter=refreshId; const reload=()=>refresh().catch(error=>console.warn('[dashboard refresh]',error)); const unsub=backend.subscribe({
      onBust: (bust, eventType='created')=>{
        changesRef.current.busts.set(bust.id,eventType==='deleted'?null:bust);
        if (eventType === 'deleted') { setBusts(prev=>prev.filter(row=>row.id!==bust.id)); setSelected(prev=>prev?.id===bust.id?null:prev); return; }
        const stableEventId = `${eventType}:${bust.id}`;
        if (!markSeenEvent(seenRealtimeEvents.current, stableEventId)) return;
        setBusts(prev=>[bust,...prev.filter(b=>b.id!==bust.id)]); setSelected(prev=>prev?.id===bust.id?{...prev,...bust}:prev); setUsers(prev=>prev.map(u=>u.id===bust.user_id?{...u,last_bust_timestamp:bust.timestamp}:u));
        if (eventType === 'created' && bust.user_id === user.id) setUser(prev => prev ? { ...prev, last_bust_timestamp: bust.timestamp } : prev);
        // Only show toast + increment unread for new busts from OTHER users; not for note edits.
        if(bust.user_id!==user.id && eventType==='created'){
          setUnread(n=>n+1);
          setToasts(t=>[{id:crypto.randomUUID(),bust},...t]);
          // Same copy the push path uses, so an alert never reads differently
          // depending on whether realtime or web push delivered it first. The
          // shared tag collapses the pair into one notification.
          // Only when the app is not on screen. If you are looking at it, the
          // in-app toast already told you, and a system banner on top of the
          // incoming web push would just be the same news twice.
          if(document.visibilityState!=='visible'){
            const copy=buildBustNotification({username:bust.username,note:bust.note,bustId:bust.id,city:bust.city});
            void showNotification(copy.title,{ body: copy.body, tag: copy.tag, renotify: false },{ baseUrl: asset('') });
          }
        }
      },
      onProfile: (p,eventType)=>{ changesRef.current.profiles.set(p.id,eventType==='deleted'?null:p); setUsers(prev=>eventType==='deleted'?prev.filter(u=>u.id!==p.id):[...prev.filter(u=>u.id!==p.id),p]); },
      onAchievement: (award,eventType)=>{ changesRef.current.achievements.set(award.id,eventType==='delete'?null:award); setUnlocks(prev=>eventType==='delete'?prev.filter(a=>a.id!==award.id):[...prev.filter(a=>a.id!==award.id),award]); },
      onStatus: async status => {
        if (status === 'SUBSCRIBED') {
          try { mergeRecentBusts(await backend.recentBusts(60)); } catch {}
          if (current) reload();
        }
      }
    }); reload(); return ()=>{current=false;requestCounter.current++;unsub();}; },[mergeRecentBusts, refresh, setUser, user.id]);
  useEffect(()=>{ if(locked&&!muted){ const h=sfx.play('drip',{loop:true,volume:.22}); const t=setTimeout(()=>h.stop(),7000); return()=>{ clearTimeout(t); h.stop(); }; } },[locked,muted]);
  useEffect(()=>{ let active=true; const probe=async()=>{try{const permission=await navigator.permissions?.query?.({name:'geolocation'});if(!active||permission?.state==='denied')return;}catch{} if(active)void acquireLocation({timeoutMs:10000});}; void probe(); return()=>{active=false;clearLocation();};},[user.id]);
  /* Each optional region lookup has its own failure boundary and one shared
     three-second metric budget. The five-second location window begins at tap. */
  async function collectContext(startedAt, actorId){
    const result={lat:null,long:null,temp_f:null,pressure:null,city:null,elevation_ft:null,tide_ft:null,btc_usd:null};
    const btcPromise=fetchBitcoinPriceUsd().catch(()=>null);
    const geo=await acquireLocation({timeoutMs:Math.max(1,Math.min(5000,startedAt+8000-Date.now()))});
    let pos=geo.coords||newestOwnLocation(bustRef.current,actorId);
    if(!pos&&Date.now()<startedAt+8000){
      const fallbackController=new AbortController();
      const fallbackTimer=setTimeout(()=>fallbackController.abort(),Math.min(2000,Math.max(0,startedAt+8000-Date.now())));
      try{pos=await backend.latestOwnLocation(actorId,fallbackController.signal);}catch{}
      clearTimeout(fallbackTimer);
    }
    if(pos){
      result.lat=pos.lat;result.long=pos.long;
      if(pos.altitude!=null)result.elevation_ft=Math.round(pos.altitude*3.28084);
      const controller=new AbortController();
      const remaining=Math.max(0,Math.min(3000,startedAt+8000-Date.now()));
      const timer=setTimeout(()=>controller.abort(),remaining);
      const read=async url=>{try{const response=await fetch(url,{signal:controller.signal});return response.ok?await response.json():null;}catch{return null;}};
      const [weather,place,tide]=await Promise.all([
        read(`https://api.open-meteo.com/v1/forecast?latitude=${pos.lat}&longitude=${pos.long}&current=temperature_2m,surface_pressure&temperature_unit=fahrenheit`),
        read(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${pos.lat}&longitude=${pos.long}&localityLanguage=en`),
        fetchTideFt(pos.lat,pos.long,controller.signal).catch(()=>null),
      ]);
      clearTimeout(timer);
      result.temp_f=finiteNumber(weather?.current?.temperature_2m);
      result.pressure=finiteNumber(weather?.current?.surface_pressure);
      if(finiteNumber(weather?.elevation)!=null)result.elevation_ft=Math.round(Number(weather.elevation)*3.28084);
      result.city=place?.city||place?.locality||place?.principalSubdivision||null;
      result.tide_ft=tide;
    }
    result.btc_usd=await Promise.race([btcPromise,new Promise(resolve=>setTimeout(()=>resolve(null),Math.max(0,startedAt+8000-Date.now())))]);
    return result;
  }
  async function startBust(){ if(locked || phase!=='idle'||pendingAction||bustInFlight.current) return; bustInFlight.current=true; const actorId=user.id, actionId=crypto.randomUUID(), startedAt=Date.now(); navigator.vibrate?.([35,45,70,65,100]); setPhase('charge'); chargeSfx.current=sfx.play('charge',{loop:true,volume:.75}); const ctx=await collectContext(startedAt,actorId); chargeSfx.current?.stop(); if(!activeRef.current)return; if(document.visibilityState==='hidden'){bustInFlight.current=false;setPhase('idle');return;} navigator.vibrate?.([180,60,220]); sfx.play('explosion',{volume:.9}); setPhase('explode'); await commitBust({...ctx,id:actionId,actorId}); }
  function clearPending(){setPendingAction(null);try{sessionStorage.removeItem(`bust_pending_${user.id}`);}catch{}}
  async function checkPending(){if(!pendingAction)return;try{const found=await within(backend.bustById(pendingAction.id,user.id),3000);if(found){clearPending();setBusts(prev=>[found,...prev.filter(row=>row.id!==found.id)]);setSelected(found);}else alert('Still unconfirmed. You can check again or retry this same event ID.');}catch(e){alert(e.message);}}
  async function commitBust(ctx){
    try{sessionStorage.setItem(`bust_pending_${user.id}`,JSON.stringify(ctx));}catch{}
    setPendingAction(ctx);
    let bust;
    try{bust=await within(backend.bust({...ctx,note:''}),10000);}
    catch(error){try{bust=await within(backend.bustById(ctx.id,ctx.actorId),3000);}catch{} if(!bust){if(/account changed/i.test(error.message)){clearPending();alert(error.message);}else alert('Bust confirmation is pending. Check its status before attempting another.');bustInFlight.current=false;setPhase('idle');return;}}
    if(!activeRef.current)return;
    clearPending();
    try{ const current=[bust,...bustRef.current]; setBusts(prev=>[bust,...prev.filter(b=>b.id!==bust.id)]);
      setUser({...user,last_bust_timestamp:bust.timestamp}); setSelected(bust);
      // Compute ALL earned achievements — no presentation cap — then persist.
      // Reconciliation runs after the bust is already committed/shown, so a failure here
      // (e.g. an unreachable Edge Function) can't be mistaken for a failed bust submission.
      announceToCrew('bust', bust.id);
      const allNew=computeAchievementUnlocks(bust.user_id,current,unlocksRef.current,{createdAt:user.created_at,userCount:usersRef.current.length});
      try{ await persistAndShowUnlocks(allNew); }catch(e){ console.error('Achievement reconciliation failed', e); }
    }catch(e){ console.error('Post-save update failed',e); }
    bustInFlight.current=false;setPhase('idle'); }
  async function saveBustNote(bust,noteText){ const updated=await backend.patchBustNote(bust.id,noteText); const current=[updated,...bustRef.current.filter(b=>b.id!==updated.id)]; setBusts(current); setSelected(prev=>prev?.id===updated.id?{...prev,...updated}:prev);
    const allNew=computeAchievementUnlocks(updated.user_id,current,unlocksRef.current,{createdAt:user.created_at,userCount:usersRef.current.length});
    try{ await persistAndShowUnlocks(allNew); }catch(e){ console.error('Achievement reconciliation failed', e); }
    return updated; }
  const effectiveBusts=useMemo(()=>[...debugBusts,...busts],[debugBusts,busts]);
  const effectiveUnlocks=useMemo(()=>[...debugUnlocks,...unlocks],[debugUnlocks,unlocks]);
  function addDebugUnlock(id){ const item=achievements.find(a=>a.id===id); if(!item) return; setDebugUnlocks(prev=>prev.some(a=>a.user_id===user.id&&a.achievement_type===id)?prev:[{id:`debug-unlock-${id}-${Date.now()}`,user_id:user.id,achievement_type:id,unlocked_at:new Date().toISOString(),debug:true},...prev]); enqueueBadge([item]); sfx.play('badge',{volume:.85}); }
  function addDebugBust(payload){ const when=payload.timestamp?new Date(payload.timestamp):new Date(); const bust={id:`debug-bust-${Date.now()}`,user_id:user.id,username:user.username,avatar_seed:user.avatar_seed,timestamp:when.toISOString(),time_bucket:timeBucket(when),note:String(payload.note||''),temp_f:payload.temp_f===''?null:Number(payload.temp_f),pressure:payload.pressure===''?null:Number(payload.pressure),lat:payload.lat===''?null:Number(payload.lat),long:payload.long===''?null:Number(payload.long),city:payload.city||'Debug Bay',elevation_ft:payload.elevation_ft===''?null:Number(payload.elevation_ft),tide_ft:payload.tide_ft===''?null:Number(payload.tide_ft),btc_usd:payload.btc_usd===''?null:Number(payload.btc_usd),debug:true}; const current=[bust,...effectiveBusts]; setDebugBusts(prev=>[bust,...prev]); setSelected(bust); const newOnes=capUnlocksPerBust(computeAchievementUnlocks(user.id,current,effectiveUnlocks,{createdAt:user.created_at,userCount:users.length})); newOnes.forEach(addDebugUnlock); }
  function clearDebug(){ dismissBadge(); setDebugBusts([]); setDebugUnlocks([]); setDebugXp(0); setSelected(prev=>prev?.debug?null:prev); }
  function resetDebugCooldown(){ setUser(u=>({...u,last_bust_timestamp:null})); setUsers(prev=>prev.map(u=>u.id===user.id?{...u,last_bust_timestamp:null}:u)); setPhase('idle'); }
  SHOWCASE_MAP=Object.fromEntries(users.map(u=>[u.id,validShowcaseIds(u.showcase,earnedIdSet(effectiveUnlocks,u.id))]));
  const analytics=useMemo(()=>buildAnalytics(effectiveBusts,users,user,effectiveUnlocks,debugXp),[effectiveBusts,users,user,effectiveUnlocks,debugXp]);
  const myLevel=useMemo(()=>debugXp?levelForXp(debugXp):derivePersonalStats(user.id,effectiveBusts,effectiveUnlocks).level,[user.id,effectiveBusts,effectiveUnlocks,debugXp]);
  const mythicIds=useMemo(()=>new Set(analytics.leaderboard.filter(u=>u.lvl.nextAt==null).map(u=>u.id)),[analytics.leaderboard]);
  return <main className={`dash ${locked?'cooldown-mode':''} ${phase==='charge'?'charging':''} ${phase==='explode'?'detonating':''}`}><GridBg/>{dataState!=='ready'&&<div className="data-status" role="status">{dataState==='failed'?'History unavailable — retry by reopening the app.':dataState==='refreshing'?'Refreshing history…':'Loading complete history…'}</div>}{pendingAction&&phase==='idle'&&<div className="pending-save" role="status">Bust confirmation pending. <button onClick={checkPending}>CHECK STATUS</button><button onClick={()=>commitBust(pendingAction)}>RETRY SAME EVENT</button></div>}{locked&&<CooldownGoop/>}<StatusBanners updateReady={updateReady} permissionLost={permissionLost} onDismissUpdate={()=>setUpdateReady(false)} onFixPermission={()=>{void enablePushNotifications({interactive:true}).then(()=>setPermissionLost(getNotificationPermission()==='denied'))}}/><header className="top-bar"><div className="top-identity"><button className="profile-chip" onClick={()=>setOverlay('profile')}><img src={avatar(user.avatar_seed)}/><span className={myLevel.title==='MasterBaiter'?'rank-mythic':''}>{user.username}</span></button><button className="icon-btn friends-action" aria-label="Friends list" title="Friends list" onClick={()=>setOverlay('friends')}><UsersRound/></button></div><img className="brand-mark" src={asset('bust-logo.png')} alt="" aria-hidden="true"/><div className="top-actions"><button className="icon-btn" title={muted?'Unmute SFX':'Mute SFX'} onClick={()=>setMuted(sfx.toggleMuted())}>{muted?<VolumeX/>:<Volume2/>}</button><button className="icon-btn" onClick={()=>{setOverlay('alerts');setUnread(0)}}><Bell/>{unread>0&&<b>{unread}</b>}</button><button className="icon-btn trophy-action" onClick={()=>setOverlay('trophy')}><Trophy/><small>{new Set(effectiveUnlocks.filter(a=>a.user_id===user.id).map(a=>a.achievement_type)).size}</small></button></div></header><section className="button-stage">{locked?<CooldownScene/>:<BustButton phase={phase} onClick={startBust}/>}</section><button className="drawer-handle" onClick={()=>setOverlay('analytics')}><ChevronUp/> ANALYTICS BAY</button>{overlay&&<div className="dashboard-scrim" aria-hidden="true"/>}<Toasts toasts={toasts} setToasts={setToasts} onOpen={setSelected} mythicIds={mythicIds}/><AnimatePresence>{badgeToast&&<BadgeToast key="badge-toast" badge={badgeToast}/>} {overlay&&<Overlay key={`overlay-${overlay}`} title={overlayTitle(overlay)} onClose={()=>setOverlay(null)} showScrollTop={['profile','analytics','trophy'].includes(overlay)}>{overlay==='profile'&&<Profile user={user} setUser={setUser} busts={effectiveBusts} unlocks={effectiveUnlocks} users={users} onOpen={setSelected} mythicIds={mythicIds} debug={{xp:debugXp,setXp:setDebugXp,onBust:addDebugBust,onUnlock:addDebugUnlock,onClear:clearDebug,onResetCooldown:resetDebugCooldown,counts:{busts:debugBusts.length,unlocks:debugUnlocks.length}}}/>} {overlay==='alerts'&&<Alerts busts={effectiveBusts} onOpen={setSelected} mythicIds={mythicIds}/>} {overlay==='analytics'&&<Analytics data={analytics} busts={effectiveBusts} onOpen={setSelected} mythicIds={mythicIds}/>} {overlay==='trophy'&&<TrophyCabinet unlocks={effectiveUnlocks} busts={effectiveBusts} user={user}/>} {overlay==='friends'&&<FriendsRoster users={users} viewerId={user.id} unlocks={unlocks} onSelect={setSocialUserId}/>}</Overlay>} {selected&&<Detail key={`detail-${selected.id}`} bust={selected} all={effectiveBusts} currentUserId={user.id} onSaveNote={saveBustNote} onClose={()=>setSelected(null)} onOpenUser={setSocialUserId} mythicIds={mythicIds}/>}</AnimatePresence>{socialUserId&&<SocialProfile subject={users.find(u=>u.id===socialUserId)} viewer={user} busts={busts} unlocks={unlocks} onClose={()=>setSocialUserId(null)} onOpenBust={b=>{setSocialUserId(null);setSelected(b);}} onOpenAward={setSocialAward} covered={Boolean(socialAward)}/>}<AnimatePresence>{socialAward&&<AchDetail item={socialAward} unlocked progress={itemProgress(socialAward,busts,users.find(u=>u.id===socialUserId)||user,unlocks)} onClose={()=>setSocialAward(null)}/>}</AnimatePresence>{phase==='explode'&&<Explosion/>}</main> }
function GridBg(){ return <div className="grid-bg"/> }
function BustButton({phase,onClick}){ return <motion.button className="bust-button" disabled={phase!=='idle'} onClick={onClick} animate={phase==='charge'?{scale:[1,1.07,.96,1.09,1],rotate:[0,-3,3,-5,5,0]}:{}} transition={{duration:.18,repeat:phase==='charge'?Infinity:0}}><span>{phase==='charge'?'Edging…':'BUST'}</span>{phase==='charge'&&<><i/><i/><i/><i/></>}</motion.button> }
function Explosion(){ const drops=Array.from({length:110}); const ropes=Array.from({length:18}); const shards=Array.from({length:30}); return <div className="explosion"><div className="blast-flash"/>{ropes.map((_,i)=><b className="goop-rope" key={`r${i}`} style={{'--l':`${Math.random()*100}%`,'--w':`${22+Math.random()*80}px`,'--h':`${38+Math.random()*70}vh`,'--d':`${Math.random()*.55}s`}}/>)}{drops.map((_,i)=><span className="milk-drop" key={`d${i}`} style={{'--x':`${Math.random()*150-75}vw`,'--y':`${Math.random()*120-60}vh`,'--s':`${7+Math.random()*28}px`,'--d':`${Math.random()*1.1}s`}}/>)}{shards.map((_,i)=><i className="button-shard" key={`s${i}`} style={{'--x':`${Math.random()*120-60}vw`,'--y':`${Math.random()*100-50}vh`,'--r':`${Math.random()*900-450}deg`,'--d':`${Math.random()*.6}s`}}/>)}<div className="milk-sheet"/><div className="screen-splatter"/></div> }
function CooldownGoop(){ return <div className="cooldown-goop" aria-hidden="true"><span/><span/><span/><span/><span/><span/><span/><span/></div> }
function NoteModal({initial='',onSave,onClose}){ const [note,setNote]=useState(initial); const [busy,setBusy]=useState(false); const [err,setErr]=useState(''); const [center,setCenter]=useState({left:'50%',top:'50%'}); useEffect(()=>{ const update=()=>{ const vv=window.visualViewport; setCenter(vv?{left:`${vv.offsetLeft+vv.width/2}px`,top:`${vv.offsetTop+vv.height/2}px`}:{left:'50%',top:'50%'}); }; update(); window.visualViewport?.addEventListener('resize',update); window.visualViewport?.addEventListener('scroll',update); window.addEventListener('resize',update); return()=>{ window.visualViewport?.removeEventListener('resize',update); window.visualViewport?.removeEventListener('scroll',update); window.removeEventListener('resize',update); }; },[]); useEffect(()=>{ const onKey=e=>{ if(e.key==='Escape') onClose(); }; window.addEventListener('keydown',onKey); return()=>window.removeEventListener('keydown',onKey); },[onClose]); return createPortal(<motion.div className="note-back" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} onClick={onClose}><motion.div className="note-pop mf-frame" style={center} initial={{opacity:0,scale:.9}} animate={{opacity:1,scale:1}} exit={{opacity:0,scale:.92}} onClick={e=>e.stopPropagation()}><button className="detail-close" onClick={onClose} aria-label="Close note editor"><X/></button><h2>CAPTURE BUST NOTE</h2><textarea value={note} maxLength={240} onChange={e=>setNote(e.target.value)} placeholder="Optional field report…" autoFocus/><small className="note-count">{note.length}/240</small><div className="note-actions"><button className="mf-button ghost" disabled={busy} onClick={onClose}>CANCEL</button><button className="mf-button" disabled={busy} onClick={async()=>{ setBusy(true); setErr(''); try{ await onSave(note); onClose(); }catch(e){ setErr(e.message); setBusy(false); } }}>{busy?'SAVING…':'SAVE NOTE'}</button></div>{err&&<div className="error">{err}</div>}</motion.div></motion.div>,document.body) }
function CooldownScene(){ return <div className="cooldown-scene" aria-label="BUST cooldown scene"><div className="iso"><div className="fallen">Busted</div></div></div> }
const recordEmoji={Crown:'👑',Snowflake:'❄️',Gauge:'📈',AlarmClock:'⏰',Flame:'🔥',Repeat2:'🔁',Moon:'🌙',NotebookPen:'📝',Bitcoin:'🪙',BitcoinDown:'📉'};
function RecordIcon({name}){ return <span className="record-emoji" aria-hidden="true">{recordEmoji[name]||'🏆'}</span> }
function BadgeMedal({icon,accent,tier}){ const url=tier?tierUrl(tier):null; return <div className={`badge-medal${url?` tier-plated`:''}`} style={{'--badge':accent,...(url?{backgroundImage:`url(${url})`}:{})}}><BadgeIcon name={icon}/></div> }
function BadgeToast({badge}){ if(!badge) return null; return <motion.div className="badge-toast mf-frame" initial={{opacity:0,y:-22,scale:.92}} animate={{opacity:1,y:0,scale:1}} exit={{opacity:0,y:-22}}><BadgeMedal icon={badge.micon||badge.icon} accent={badge.accent} tier={badge.tier}/><div><span>{badge.isRestorationSummary?'HISTORICAL RECONCILIATION':badge.isRestored?'ACHIEVEMENT RESTORED':'ACHIEVEMENT UNLOCKED'}</span><h2>{badge.isRestorationSummary?`${badge.restoredCount} historical achievements restored`:badge.name}</h2><p>{badge.isRestorationSummary?'View your Trophy Cabinet to inspect restored unlocks.':`${badge.tier.toUpperCase()} · ${badge.points} XP`}</p></div></motion.div> }
function Overlay({title,onClose,children,showScrollTop=false}){ const ref=useRef(null); return <motion.section ref={ref} className="overlay" initial={{y:'100%'}} animate={{y:0}} exit={{y:'100%'}}><button className="close" onClick={onClose}><X/></button><div className="overlay-head"><h1>{title}</h1></div>{children}{showScrollTop&&<button type="button" className="scroll-top" aria-label="Back to top" title="Back to top" onClick={()=>ref.current?.scrollTo({top:0,behavior:'smooth'})}><ChevronUp/></button>}</motion.section> }
function Detail({bust,all,currentUserId,onSaveNote,onClose,onOpenUser,mythicIds}){ const [editing,setEditing]=useState(false); const own=bust.user_id===currentUserId; const temp=finiteNumber(bust.temp_f); const pressure=finiteNumber(bust.pressure); const prevBtc=useMemo(()=>{ const mine=all.filter(b=>b.user_id===bust.user_id&&finiteNumber(b.btc_usd)!=null&&new Date(b.timestamp)<new Date(bust.timestamp)).sort((a,b)=>new Date(b.timestamp)-new Date(a.timestamp)); return finiteNumber(mine[0]?.btc_usd); },[all,bust.user_id,bust.timestamp]); const btcValue=formatBtcUsd(bust.btc_usd); return <motion.div className="detail-back" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}}><div className="detail mf-frame"><button className="detail-close" onClick={onClose} aria-label="Close detail"><X/></button><button type="button" className="detail-user" onClick={()=>onOpenUser(bust.user_id)} aria-label={`View ${bust.username}'s profile`}><img src={avatar(bust.avatar_seed)}/><strong className={mythicIds?.has(bust.user_id)?'rank-mythic':''}>{bust.username}</strong><NameBadges userId={bust.user_id}/></button><p>{fmt(bust.timestamp)} · {bust.time_bucket}</p>{bust.note?<blockquote>{bust.note}</blockquote>:<p className="detail-empty-note">No field note yet.</p>}{own&&<button type="button" className="mf-button ghost add-note-btn" onClick={()=>setEditing(true)}><Pencil/> Add Note</button>}<div className="metric-grid"><Metric icon={<Thermometer/>} label="TEMP" value={temp!=null?`${Math.round(temp)}°F`:'—'}/><Metric icon={<Gauge/>} label="PRESSURE" value={pressureLabel(bust.pressure)||'—'} sub={pressure!=null?`${Math.round(pressure)} hPa`:null}/><Metric icon={<Waves/>} label="TIDE" value={tideLabel(bust.tide_ft)}/><Metric icon={<Bitcoin/>} label="BITCOIN" value={btcValue||'—'} sub={btcValue?(formatBtcChange(bust.btc_usd,prevBtc)||btcMoodLabel(bust.btc_usd)):null}/><Metric icon={<MapPin/>} label="LOCATION" value={bust.city||'Unknown'}/><Metric icon={<Mountain/>} label="ALTITUDE" value={elevationLabel(bust.elevation_ft)}/><Metric icon={<Medal/>} label="DAY RANK" value={`#${rankForDay(bust,all)}`}/></div></div>{editing&&<NoteModal initial={bust.note||''} onClose={()=>setEditing(false)} onSave={note=>onSaveNote(bust,note)}/>}</motion.div> }
function Metric({icon,label,value,sub}){return <div className="metric">{icon}<small>{label}</small><strong>{value}</strong>{sub&&<em className="metric-sub">{sub}</em>}</div>}
/** Location + notification permission re-request controls (profile). Browsers only re-prompt when state is 'prompt'; DENIED requires the browser's site settings. */
function PermissionControls(){
  const [notif,setNotif]=useState(getNotificationPermission());
  const [geo,setGeo]=useState('unknown');
  const [busy,setBusy]=useState(false);
  const [status,setStatus]=useState(()=>{ const blocked=pushBlockedReason(detectPushPlatform()); return blocked?PUSH_REASON_MESSAGE[blocked]:null; });
  useEffect(()=>{
    navigator.permissions?.query({name:'geolocation'}).then(r=>{ setGeo(r.state); r.onchange=()=>setGeo(r.state); }).catch(()=>{});
    const syncNotif=()=>setNotif(getNotificationPermission());
    syncNotif();
    window.addEventListener('focus', syncNotif);
    return ()=>window.removeEventListener('focus', syncNotif);
  },[]);
  async function askNotif(){
    setBusy(true);
    try{
      const outcome=await enablePushNotifications();
      setNotif(outcome.ok?'granted':(outcome.permission||getNotificationPermission()));
      setStatus(outcome.ok?'Push armed. Try SEND TEST PING.':(outcome.detail?`${outcome.message} (${outcome.detail})`:outcome.message));
    }catch(e){ setStatus(String(e?.message||e)); }
    finally{ setBusy(false); }
  }
  /* Round-trips a real push through VAPID signing, the OS push service, and the
   * service worker. If this lands, every other notification path will too. */
  async function sendTestPing(){
    setBusy(true);
    setStatus('Sending…');
    try{
      const outcome=await enablePushNotifications({ sendTest:true });
      if(!outcome.ok){ setStatus(outcome.detail?`${outcome.message} (${outcome.detail})`:outcome.message); return; }
      const res=outcome.server;
      if(res?.test?.delivered>0){ setStatus('Test push accepted by your push service. It should arrive within a few seconds.'); return; }
      if(res?.test?.pruned>0){ setStatus('Your previous push subscription expired and was removed. Refresh the page, then try again.'); return; }
      setStatus(res?.test?.failures?.[0]||'The test push was not accepted by your push service. Check browser and OS notification settings, then try again.');
    }catch(e){ setStatus(String(e?.message||e)); }
    finally{ setBusy(false); }
  }
  async function askGeo(){ const result=await acquireLocation({timeoutMs:10000,useCache:false});setGeo(result.outcome); }
  const label=v=>({granted:'ON',denied:'BLOCKED',prompt:'ASK',default:'ASK',unknown:'ASK',unsupported:'N/A'}[v]||v);
  return <div className="perm-row">
    <span className="perm-title">DEVICE PERMISSIONS</span>
    <div>
      <button type="button" className="mf-button ghost" onClick={askGeo}><MapPin/> FIND MY LAIR · {label(geo)}</button>
      <button type="button" className="mf-button ghost" disabled={busy} onClick={askNotif}><Bell/> PING ME, COACH · {label(notif)}</button>
      <button type="button" className="mf-button ghost" disabled={busy||notif==='unsupported'} onClick={sendTestPing}><Bell/> SEND TEST PING</button>
    </div>
    {status&&<small style={{color:'#ffb27b'}}>{status}</small>}
    {(geo==='denied'||notif==='denied')&&<small>A blocked permission can only be re-enabled from your browser's site settings (padlock icon in the address bar).</small>}
  </div> }
/*
 * The hidden debug context menu.
 *
 * Portalled to <body> on purpose: `.overlay` sets `backdrop-filter`, which makes
 * it a containing block for fixed-position descendants, so nesting this inside
 * it made left/top resolve against the overlay's scrolled box instead of the
 * viewport — the menu opened offset by however far the profile was scrolled.
 * It is measured first, then clamped, so it can never open off screen either.
 */
function DebugContextMenu({at,onClose,onOpenDebug}){
  const ref=useRef(null); const [pos,setPos]=useState(null);
  useEffect(()=>{
    const box=ref.current?.getBoundingClientRect();
    setPos(clampMenuToViewport(at.x,at.y,{width:box?.width||0,height:box?.height||0},{width:window.innerWidth,height:window.innerHeight}));
  },[at]);
  useEffect(()=>{
    const onKey=e=>{ if(e.key==='Escape') onClose(); };
    window.addEventListener('keydown',onKey);
    window.addEventListener('resize',onClose);
    // Capture phase: the menu is fixed to the viewport, so any scroll behind it
    // would leave it pointing at nothing.
    window.addEventListener('scroll',onClose,true);
    return ()=>{ window.removeEventListener('keydown',onKey); window.removeEventListener('resize',onClose); window.removeEventListener('scroll',onClose,true); };
  },[onClose]);
  return createPortal(<><div className="debug-context-scrim" onClick={onClose} onContextMenu={e=>{e.preventDefault();onClose();}}/><div ref={ref} className="debug-context" role="menu" style={{left:pos?pos.left:0,top:pos?pos.top:0,visibility:pos?'visible':'hidden'}}><button role="menuitem" onClick={onOpenDebug}>Debug Menu</button><button role="menuitem" onClick={onClose}>Close</button></div></>,document.body) }

function Profile({user,setUser,busts,unlocks,users,onOpen,debug,mythicIds}){
  const [tagline,setTagline]=useState(user.tagline||''); const [saving,setSaving]=useState(false); const [saved,setSaved]=useState(false); const [showPicker,setShowPicker]=useState(false); const [confirmDel,setConfirmDel]=useState(false); const [ctx,setCtx]=useState(null); const [showDebug,setShowDebug]=useState(false); const debugPress=useLongPress(point=>setCtx(point));
  const stats=useMemo(()=>derivePersonalStats(user.id,busts,unlocks),[user.id,busts,unlocks]);
  const own=useMemo(()=>busts.filter(b=>b.user_id===user.id),[busts,user.id]);
  const trend=useMemo(()=>buildTrend(own,30),[own]);
  const rank=useMemo(()=>{const counts=users.map(u=>({id:u.id,count:busts.filter(b=>b.user_id===u.id).length})).sort((a,b)=>b.count-a.count);const i=counts.findIndex(c=>c.id===user.id);return i>=0&&counts[i].count>0?i+1:null;},[users,busts,user.id]);
  const myBadges=useMemo(()=>earnedItems(unlocks,user.id),[unlocks,user.id]);
  const earnedSet=useMemo(()=>earnedIdSet(unlocks,user.id),[unlocks,user.id]);
  const pinned=validShowcaseIds(user.showcase,earnedSet);
  async function save(patch){ setSaving(true); try{ const u=await backend.patchProfile(patch); setUser({...user,...u}); setSaved(true); setTimeout(()=>setSaved(false),1800);}catch(e){alert(e.message);}finally{setSaving(false);} }
  const lvl=debug?.xp?levelForXp(debug.xp):stats.level;
  return <div className="profile-page">
    <section className="profile-hero mf-frame">
      <div className="profile-id">
        <div className="avatar-stack"><img src={avatar(user.avatar_seed)}/><button className="reroll" title="Re-roll avatar" onClick={()=>save({avatar_seed:`${user.username}-${Date.now()}`})} disabled={saving}><Repeat2/></button></div>
        <div>
          <span className="mf-kicker">LVL {lvl.level} · {lvl.title.toUpperCase()}</span>
          <h2><span className={lvl.title==='MasterBaiter'?'rank-mythic':''}>{user.username}</span><NameBadges userId={user.id}/></h2>
          <p>Operator since {new Date(user.created_at).toLocaleDateString()} {rank?`· Group rank #${rank}`:''}</p>
          <div className="xp-bar" title={lvl.nextTitle?`${lvl.points} XP · next: ${lvl.nextTitle} at ${lvl.nextAt}`:`${lvl.points} XP · max rank`}><i style={{width:`${lvl.pct}%`}}/><b>{lvl.points} XP{lvl.nextAt?` / ${lvl.nextAt}`:''}</b></div>
        </div>
      </div>
      <label className="tagline-edit">OPERATOR TAGLINE
        <div><input value={tagline} maxLength={80} placeholder="State your motto…" onChange={e=>setTagline(e.target.value)}/><button className="mf-button" disabled={saving||tagline===(user.tagline||'')} onClick={()=>save({tagline})}>{saved?'SAVED':'SAVE'}</button></div>
      </label>
      <PermissionControls/>
    </section>
    <section className="stat-strip profile-stats">
      {[
        {label:'LIFETIME',value:stats.total,hint:'total busts'},
        {label:'STREAK',value:stats.streaks.current?`${stats.streaks.current}d`:'0',hint:`longest ${stats.streaks.longest}d`},
        {label:'PER WEEK',value:stats.perWeek,hint:'average pace'},
        {label:'PRIME WINDOW',value:stats.favoriteBucket,hint:'favorite bucket'},
        {label:'AVG TEMP',value:stats.avgTemp!=null?`${stats.avgTemp}°F`:'—',hint:'at time of bust'},
        {label:'FIELD NOTES',value:stats.notes,hint:'reports filed'}
      ].map(s=><div className="stat mf-frame" key={s.label}><span>{s.label}</span><strong>{s.value}</strong><small>{s.hint}</small></div>)}
    </section>
    <section className="analytics-grid">
      <div className="mf-frame module"><h2>Personal 30-Day Trend</h2><p>Your daily output over the last month.</p><TrendChart data={trend}/></div>
      <div className="mf-frame module"><h2>Your Dayparts</h2><p>When you do your best work.</p>{stats.total?<DonutChart data={Object.entries(stats.bucketBreakdown).map(([label,value])=>({label,value}))}/>:<EmptyState text="No events logged yet."/>}</div>
    </section>
    <h2 className="section-title">Badge Showcase <small className="count-pill">{pinned.length}/3 pinned</small><button type="button" className="mf-button ghost edit-showcase" disabled={!myBadges.length} onClick={()=>setShowPicker(true)}>EDIT</button></h2>
    {pinned.length?<div className="showcase-row">{pinned.map(id=>{const b=achievements.find(x=>x.id===id);return b?<div className="showcase-badge mf-frame selected" key={b.id} style={{'--badge':b.accent}} title={b.desc}><BadgeMedal icon={b.micon||b.icon} accent={b.accent} tier={b.tier}/><span>{b.name}</span><small>★ PINNED</small></div>:null})}</div>:<p className="showcase-hint">{myBadges.length?'Nothing pinned yet — hit EDIT to pick up to 3 badges.':'Unlock a badge first, then pin it here.'}</p>}
    {showPicker&&<ShowcasePicker unlocked={myBadges} initial={pinned} onClose={()=>setShowPicker(false)} onApply={ids=>{ setShowPicker(false); if(ids.join(',')!==(user.showcase||'')) save({showcase:ids.join(',')}); }}/>}
    <h2 className="section-title">Recent Activity</h2>
    <div className="feed two-col">{own.length?own.slice(0,10).map(b=><BustCard key={b.id} b={b} onOpen={onOpen} mythicIds={mythicIds}/>):<EmptyState text="Your ledger is empty. The button awaits."/>}</div>
    <div className="logout-row"><button className="mf-button ghost" onClick={async()=>{await backend.logout();setUser(null)}}><LogOut/> LOG OUT</button><button className="mf-button ghost danger no-callout" {...debugPress.handlers} onContextMenu={e=>{ e.preventDefault(); setCtx({x:e.clientX,y:e.clientY}); }} onClick={()=>{ if(debugPress.consumeClick()) return; setConfirmDel(true); }}>DELETE ACCOUNT</button></div>
    {ctx&&<DebugContextMenu at={ctx} onClose={()=>setCtx(null)} onOpenDebug={()=>{setCtx(null);setShowDebug(true);}}/>}
    {showDebug&&debug&&<DebugMenu debug={debug} username={user.username} users={users} logoSrc={asset('bust-logo.png')} onClose={()=>setShowDebug(false)} enablePush={enablePushNotifications} rotateEndpoint={()=>rotatePushEndpoint({backend, workerPath: asset('sw.js')})} buildId={CURRENT_BUILD_ID} versionUrl={asset('version.json')}/>}
    {confirmDel&&<DeleteAccountModal onClose={()=>setConfirmDel(false)} onDeleted={()=>setUser(null)}/>}
  </div> }
function Alerts({busts,onOpen,mythicIds}){ return <div className="feed two-col">{busts.map(b=><BustCard key={b.id} b={b} onOpen={onOpen} mythicIds={mythicIds}/>)}</div> }
function BustCard({b,onOpen,mythicIds}){ return <button className="bust-card mf-frame" onClick={()=>onOpen(b)}><img src={avatar(b.avatar_seed)}/><div><strong><span className={mythicIds?.has(b.user_id)?'rank-mythic':''}>{b.username}</span><NameBadges userId={b.user_id}/></strong><span>{fmt(b.timestamp)} · {b.time_bucket}</span><p>{b.note || 'Pressure spike recorded.'}</p></div></button> }
function Analytics({data,busts,onOpen,mythicIds}){ const today=busts.filter(b=>todayKey(b.timestamp)===todayKey()); return <div className="analytics"><div className="stat-strip">{data.stats.map(s=><div className="stat mf-frame" key={s.label}><span>{s.label}</span><strong>{s.value}</strong><small>{s.hint}</small></div>)}</div><section className="analytics-grid"><div className="mf-frame module leaderboard-module"><h2>Leaderboard</h2><p>Ranked avatar tiles with satirical titles and all-time volume.</p>{data.leaderboard.length?data.leaderboard.map((u,i)=><div className="leader" key={u.id}><span>#{i+1}</span><img src={avatar(u.avatar_seed)}/><b><span className={mythicIds?.has(u.id)?'rank-mythic':''}>{u.username}</span><NameBadges userId={u.id}/>{u.streak>1&&<i className="streak-pill" title="current daily streak">{u.streak}d 🔥</i>}</b><Sparkline data={u.spark}/><em>{u.count} busts <i className="lvl-chip">LVL {u.lvl.level}{u.lvl.level>=10?` · ${u.lvl.points} XP`:''}</i> <span className="lvl-rank-name">{u.lvl.title}</span>{u.tagline?` · "${u.tagline}"`:''}</em></div>):<EmptyState text="No operators have logged yet."/>}</div><div className="mf-frame module"><h2>30-Day Trend</h2><p>Group volume, rolling month.</p><TrendChart data={data.trend}/></div><div className="mf-frame module"><h2>Daypart Share</h2><p>Which windows carry the group.</p>{Object.keys(data.buckets).length?<DonutChart data={Object.entries(data.buckets).map(([label,value])=>({label,value}))}/>:<EmptyState text="Awaiting events."/>}</div><div className="mf-frame module"><h2>Hour Histogram</h2><p>Raw hour-of-day distribution.</p><HourHistogram counts={data.hourHist}/></div><div className="mf-frame module chart-module"><h2>Weekly Volume</h2><p>Day-over-day ledger intensity.</p><div className="bars">{data.week.map(d=><div key={d.label}><i style={{height:`${Math.max(8,d.count*22)}px`}}/><strong>{d.count}</strong><span>{d.label}</span></div>)}</div></div><div className="mf-frame module chart-module"><h2>Heatmap</h2><p>24-hour activity by day of week.</p><div className="heat-wrap"><div className="heat-axis">{['S','M','T','W','T','F','S'].map((d,i)=><b key={i}>{d}</b>)}</div><div className="heat">{data.heat.map((v,i)=><span key={i} style={{opacity:.12+Math.min(v,5)*.18}} title={`${v} events`}/>)}</div></div></div><div className="mf-frame module chart-module"><h2>Environment Scatter</h2><p>Temperature versus barometric pressure.</p>{data.scatterPts.length?<ScatterChart points={data.scatterPts}/>:<EmptyState text="Awaiting environment data."/>}</div><div className="mf-frame module chart-module"><h2>Bitcoin at Bust</h2><p>Spot price stamped on each of the last 60 priced events.</p>{data.btcSeries.length>1?<PriceLine points={data.btcSeries} format={v=>formatBtcCompact(v)||'—'}/>:<EmptyState text="Not enough priced busts yet."/>}</div><div className="mf-frame module"><h2>Operator Contribution</h2><p>Each operator's share of all-time group volume.</p>{data.perUser.length?<HBarChart items={data.perUser.map(u=>({...u,value:`${u.value} · ${u.pct}%`}))}/>:<EmptyState text="No busts logged yet."/>}</div><div className="mf-frame module"><h2>XP Rankings</h2><p>Cumulative experience across achievements unlocked.</p>{data.xpRanking.length?<HBarChart items={data.xpRanking}/>:<EmptyState text="No achievements unlocked yet."/>}</div></section><section className="records-grid">{data.records.map(r=><div className="record-card mf-frame" key={r.id}><RecordIcon name={r.icon}/><span>{r.label}</span><strong>{r.value}</strong><p>{r.detail}</p></div>)}</section><h2 className="section-title">Today's Feed</h2><div className="feed two-col">{today.length?today.map(b=><BustCard key={b.id} b={b} onOpen={onOpen} mythicIds={mythicIds}/>):<EmptyState text="No busts in the current 24-hour window."/>}</div></div> }
function FriendsRoster({users,viewerId,unlocks,onSelect}) {
  const others=users.filter(person=>person.id!==viewerId).sort((a,b)=>a.username.localeCompare(b.username));
  return <div className="friends-roster">{others.length?others.map(person=><button type="button" className="friend-row mf-frame" key={person.id} onClick={()=>onSelect(person.id)}><img src={avatar(person.avatar_seed)} alt=""/><span><strong>{person.username}</strong><small>{person.tagline||'Crew member'}</small></span><b>{earnedRecords(unlocks,person.id).length} earned</b></button>):<EmptyState text="No other operators yet."/>}</div>;
}
function SocialProfile({subject,viewer,busts,unlocks,onClose,onOpenBust,onOpenAward,covered=false}) {
  const [compare,setCompare]=useState(false);
  const metrics=userMetrics(subject?.id,busts,unlocks);
  const mine=earnedRecords(unlocks,viewer.id);
  const rows=subject?.id===viewer.id?[]:comparisonRows(unlocks,viewer.id,subject?.id);
  const rank=[...new Set(busts.map(b=>b.user_id))].map(id=>({id,count:busts.filter(b=>b.user_id===id).length})).sort((a,b)=>b.count-a.count).findIndex(entry=>entry.id===subject?.id)+1;
  useEffect(()=>{if(covered)return;const key=e=>{if(e.key==='Escape')onClose();};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[covered,onClose]);
  return createPortal(<div className="social-profile-back" onClick={onClose}><section className="social-profile mf-frame" role="dialog" aria-modal="true" aria-label={subject?`${subject.username}'s profile`:'Unavailable profile'} onClick={e=>e.stopPropagation()}><button className="detail-close" onClick={onClose} aria-label="Back to previous view"><X/></button>{subject?<><div className="social-identity"><img src={avatar(subject.avatar_seed)} alt=""/><div><span className="mf-kicker">CREW PROFILE</span><h2>{subject.username}</h2><p>{subject.tagline||'Operator'} · Local-time charts</p></div></div><div className="social-stat-grid">{[
    ['LIFETIME',metrics.stats.total],['STREAK',`${metrics.stats.streaks.current}d / ${metrics.stats.streaks.longest}d`],['PER WEEK',metrics.stats.perWeek],['FIRST',metrics.stats.firstBust?fmt(metrics.stats.firstBust):'—'],['LATEST',metrics.stats.lastBust?fmt(metrics.stats.lastBust):'—'],['GROUP RANK',rank?`#${rank}`:'—'],['XP / LEVEL',`${metrics.stats.level.points}${metrics.xpIncomplete?'+ known':''} / ${metrics.stats.level.level}`],['EARNED',metrics.earned.length],['NOTES',metrics.stats.notes]
  ].map(([label,value])=><div className="social-stat" key={label}><small>{label}</small><strong>{value}</strong></div>)}</div><div className="social-measures">{Object.entries(metrics.measurements).map(([key,m])=><div key={key}><small>{key.replace('_',' ').toUpperCase()}</small><strong>{m.count?`${m.average.toFixed(1)} ${m.unit}`:'Unavailable'}</strong><span>{m.count?`${m.min.toFixed(1)}–${m.max.toFixed(1)} · ${m.count} samples`:'No samples'}</span></div>)}</div><div className="analytics-grid"><div className="mf-frame module"><h2>30-Day Trend</h2><TrendChart data={metrics.trend}/></div><div className="mf-frame module"><h2>Recorded Dayparts</h2>{metrics.stats.total?<DonutChart data={Object.entries(metrics.stats.bucketBreakdown).map(([label,value])=>({label,value}))}/>:<EmptyState text="No events yet."/>}</div></div><h3>Earned achievements, badges & trophies</h3><div className="social-awards">{metrics.earned.map(record=><button key={record.achievement_type} type="button" className={`earned-row tier-${record.item.tier}`} onClick={()=>onOpenAward(record.item)}><MIcon name={record.item.micon||matMap[record.item.icon]||'shield'}/><span>{record.item.name}</span><small>{record.item.tier}</small></button>)}</div>{subject.id!==viewer.id&&<><button className="comparison-toggle" type="button" aria-expanded={compare} onClick={()=>setCompare(v=>!v)}>COMPARISON · YOU {mine.length} / {subject.username.toUpperCase()} {metrics.earned.length} {compare?'▲':'▼'}</button>{compare&&<div className="comparison-list">{rows.map(row=><div key={row.id}><span>{row.item.name}</span><small>{row.item.kind} · {row.item.tier}</small><b>{row.viewerEarned?'✓':'—'} YOU</b><b>{row.subjectEarned?'✓':'—'} THEM</b></div>)}</div>}</>}<h3>Recent Activity</h3><div className="feed two-col">{[...metrics.own].sort((a,b)=>Date.parse(b.timestamp)-Date.parse(a.timestamp)).slice(0,10).map(b=><BustCard key={b.id} b={b} onOpen={onOpenBust}/>)}</div></>:<EmptyState text="This operator is no longer available."/>}</section></div>,document.body);
}
function TrophyCabinet({unlocks,busts,user}){
  const [detail,setDetail]=useState(null);
  const [expanded,setExpanded]=useState(false);
  const history=earnedRecords(unlocks,user.id);
  const set=new Set(history.map(a=>a.achievement_type));
  const catalog=achievements;
  const badges=catalog.filter(i=>i.kind!=='achievement');
  const achs=catalog.filter(i=>i.kind==='achievement');
  const won=list=>list.filter(i=>set.has(i.id)).length;
  const xp=[...set].map(id=>achievements.find(x=>x.id===id)?.points||0).reduce((s2,p2)=>s2+p2,0);
  const sortU=(a,b)=>(set.has(b.id)?1:0)-(set.has(a.id)?1:0);
  return <div className="achievement-hall">
    <div className="trophy-summary mf-frame"><Trophy/><div><span>ACHIEVEMENT HALL</span><strong>{history.length}/{catalog.length} unlocked · {xp} known XP{history.some(record=>record.item.points==null)?' (incomplete)':''}</strong></div></div>
    <section className="earned-history"><button type="button" className="comparison-toggle" aria-expanded={expanded} onClick={()=>setExpanded(v=>!v)}>EARNED HISTORY · {history.length} {expanded?'▲':'▼'}</button>{expanded&&<div className="earned-history-list"><small>Dates show when awards were recorded; historical conditions may have been met earlier.</small>{history.length?history.map(record=><button type="button" key={record.achievement_type} className={`earned-row tier-${record.item.tier}`} onClick={()=>setDetail(record.item)}><MIcon name={record.item.micon||matMap[record.item.icon]||'shield'}/><span>{record.item.name}</span><small>{record.item.tier}</small><time>{Number.isFinite(Date.parse(record.unlocked_at))?new Date(record.unlocked_at).toLocaleString():'Unknown'}</time></button>):<EmptyState text="No earned awards yet."/>}</div>}</section>
    <h2 className="section-title">Badges <small className="count-pill">{won(badges)}/{badges.length}</small></h2>
    <div className="ach-grid">{[...badges].sort(sortU).map(i=><AchievementCard key={i.id} item={i} unlocked={set.has(i.id)} onClick={()=>setDetail(i)}/>)}</div>
    <h2 className="section-title ach-title">Achievements <small className="count-pill">{won(achs)}/{achs.length}</small></h2>
    <div className="ach-grid">{[...achs].sort(sortU).map(i=><AchievementCard key={i.id} item={i} unlocked={set.has(i.id)} onClick={()=>setDetail(i)}/>)}</div>
    <AnimatePresence>{detail&&<AchDetail key="ach-detail" item={detail} unlocked={set.has(detail.id)} progress={itemProgress(detail,busts,user,unlocks)} onClose={()=>setDetail(null)}/>}</AnimatePresence>
  </div> }
function EmptyState({text}){ return <div className="empty-state"><Sparkles/><span>{text}</span></div> }
function Toasts({toasts,setToasts,onOpen,mythicIds}){ return <div className="toasts">{toasts.map(t=><div className="toast mf-frame" key={t.id} onClick={()=>onOpen(t.bust)}><button onClick={(e)=>{e.stopPropagation();setToasts(x=>x.filter(y=>y.id!==t.id))}}>×</button><b><span className={mythicIds?.has(t.bust.user_id)?'rank-mythic':''}>{t.bust.username}</span> BUSTED</b><span>{t.bust.note||'Open detail card.'}</span></div>)}</div> }
function overlayTitle(o){return {profile:'OPERATOR PROFILE',alerts:'ALERT FEED',analytics:'ANALYTICS DRAWER',trophy:'TROPHY CABINET',friends:'CREW ROSTER'}[o]}
function buildAnalytics(busts,users,user,unlocks=[],debugXp=0){ const xpFor=id=>(id===user.id&&debugXp)?debugXp:unlocks.filter(a=>a.user_id===id).map(a=>achievements.find(x=>x.id===a.achievement_type)?.points||0).reduce((s,p)=>s+p,0); const counts=users.map(u=>({...u,count:busts.filter(b=>b.user_id===u.id).length,lvl:levelForXp(xpFor(u.id))})).sort((a,b)=>b.count-a.count); const today=busts.filter(b=>todayKey(b.timestamp)===todayKey()).length; const rank=counts.findIndex(u=>u.id===user.id)+1; const stats=[{label:'GROUP BUSTS',value:busts.length,hint:'all-time ledger'},{label:'ACTIVE PLAYERS',value:users.length,hint:'registered operators'},{label:'TODAY',value:today,hint:'current local day'},{label:'YOUR RANK',value:rank>0?'#'+rank:'—',hint:'daily pressure index'}]; const week=Array.from({length:7}).map((_,i)=>{const d=new Date();d.setDate(d.getDate()-(6-i));return {label:d.toLocaleDateString([],{weekday:'short'}),count:busts.filter(b=>new Date(b.timestamp).toDateString()===d.toDateString()).length}}); const heat=Array.from({length:24*7},(_,i)=>busts.filter(b=>new Date(b.timestamp).getDay()*24+new Date(b.timestamp).getHours()===i).length); const temps=busts.map(b=>({b,temp:finiteNumber(b.temp_f),pressure:finiteNumber(b.pressure)})).filter(x=>x.temp!=null&&x.pressure!=null); const scatterPts=temps.map(({b,temp,pressure})=>({x:temp,y:pressure,label:`${b.username||'?'} — ${Math.round(temp)}°F, ${Math.round(pressure)} hPa`})); const btcSeries=[...busts].filter(b=>finiteNumber(b.btc_usd)!=null).sort((a,b)=>new Date(a.timestamp)-new Date(b.timestamp)).slice(-60).map(b=>({label:`${b.username||'?'} · ${fmt(b.timestamp)}`,value:finiteNumber(b.btc_usd)})); const records=deriveAllTimeRecords(busts);
 const trend=buildTrend(busts,30);
 const buckets={}; busts.forEach(b=>{const k=b.time_bucket;buckets[k]=(buckets[k]||0)+1;});
 const hourHist=Array.from({length:24},(_,h)=>busts.filter(b=>new Date(b.timestamp).getHours()===h).length);
 const leaderboard=counts.map(u=>{const own=busts.filter(b=>b.user_id===u.id);return {...u,spark:buildTrend(own,14).map(d=>d.count),streak:deriveStreaks(own).current};});
 const total=busts.length||1;
 const perUser=counts.filter(u=>u.count>0).map(u=>({label:u.username,value:`${u.count} bust${u.count===1?'':'s'}`,pct:Math.round(u.count/total*100)}));
 const maxXp=Math.max(1,...counts.map(u=>u.lvl.points));
 const xpRanking=counts.filter(u=>u.lvl.points>0).map(u=>({label:u.username,value:`${u.lvl.points} XP`,pct:Math.round(u.lvl.points/maxXp*100)}));
 return {stats,leaderboard,week,heat,scatterPts,btcSeries,records,trend,buckets,hourHist,perUser,xpRanking}; }
// Material Symbols renders its ligature NAMES as plain text until the font is ready —
// the font is bundled locally (material-symbols package), so this resolves almost instantly.
// If it somehow fails, icons stay hidden rather than ever showing raw codes like "ac_unit".
(async () => {
  for (let i = 0; i < 5; i++) {
    try {
      await document.fonts.load('24px "Material Symbols Outlined"');
      if (document.fonts.check('24px "Material Symbols Outlined"')) { document.documentElement.classList.add('msym-ready'); setMsymStatus('ready'); return; }
    } catch { /* retry */ }
    await new Promise(r => setTimeout(r, 1200));
  }
  document.documentElement.classList.add('msym-failed');
  setMsymStatus('failed');
})();
createRoot(document.getElementById('root')).render(<ErrorBoundary><App/></ErrorBoundary>);
