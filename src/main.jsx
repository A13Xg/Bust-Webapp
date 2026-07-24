import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Bell, ChevronUp, Gauge, LogOut, MapPin, Medal, Mountain, Pencil, Repeat2, Sparkles, Thermometer, Trophy, Volume2, VolumeX, Waves, X } from 'lucide-react';
import 'material-symbols/outlined.css';
import './styles.css';
import { achievements, capUnlocksPerBust, computeAchievementUnlocks, deriveAllTimeRecords, derivePersonalStats, deriveStreaks, buildTrend, finiteNumber, levelForXp, timeBucket, twoHoursRemainingMs, todayKey } from './rules.js';
import { expansionItems } from './expansion.js';
import { TrendChart, DonutChart, HourHistogram, Sparkline, ScatterChart, HBarChart } from './charts.jsx';
import { backend } from './backend.js';
import * as sfx from './audio.js';
import tideStations from './tide-stations.json';
import { ErrorBoundary } from './ErrorBoundary.jsx';
import { closePermissionPrompt, getNotificationPermission, markSeenEvent, requestNotificationPermission, sendBrowserNotification } from './notifications.js';
import { buildInactivityReminderMessage, isInactivityReminderDue, loadInactivityReminderState, markInactivityReminderSent, nextInactivityReminderDelayMs, reconcileInactivityReminderState, saveInactivityReminderState } from './inactivityReminder.js';
import { useAchievementQueue } from './useAchievementQueue.js';

export const asset = p => import.meta.env.BASE_URL + String(p).replace(/^\//, '');
function avatar(seed) { return `https://api.dicebear.com/9.x/identicon/svg?seed=${encodeURIComponent(seed || 'bust')}&backgroundColor=0a0a0b&rowColor=ff5e00,f5f0e8`; }
function fmt(ts) { return new Date(ts).toLocaleString([], { month:'short', day:'numeric', hour:'numeric', minute:'2-digit' }); }
function rankForDay(bust, busts) { const d = new Date(bust.timestamp).toDateString(); const list = busts.filter(b=>new Date(b.timestamp).toDateString()===d).sort((a,b)=>new Date(a.timestamp)-new Date(b.timestamp)); return list.findIndex(b=>b.id===bust.id)+1 || '—'; }
function pressureLabel(p){ p=finiteNumber(p); if(p==null) return null; if(p<990) return 'Very Low'; if(p<1005) return 'Low'; if(p<1015) return 'Medium'; if(p<1025) return 'High'; return 'Very High'; }
function elevationLabel(ft){ ft=finiteNumber(ft); return ft!=null?`${Math.round(ft)}ft ASL`:'—'; }
function tideLabel(ft){ ft=finiteNumber(ft); return ft!=null?`${ft>=0?'High':'Low'} / ${Math.abs(ft).toFixed(1)}ft`:'—'; }
function nearestTideStationId(lat,long){ let best=null,bestD=Infinity; const R=3958.8,toR=x=>x*Math.PI/180; for(const [id,slat,slng] of tideStations){ const dLat=toR(slat-lat),dLon=toR(slng-long); const h=Math.sin(dLat/2)**2+Math.cos(toR(lat))*Math.cos(toR(slat))*Math.sin(dLon/2)**2; const d=2*R*Math.asin(Math.sqrt(h)); if(d<bestD){bestD=d;best=id;} } return best; }
async function fetchTideFt(lat,long){
  const stationId=nearestTideStationId(lat,long);
  if(!stationId) return null;
  const data=await fetch(`https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?station=${stationId}&product=predictions&datum=MTL&time_zone=gmt&units=english&interval=6&date=today&format=json`).then(r=>r.json());
  const points=data?.predictions;
  if(!Array.isArray(points)||!points.length) return null;
  const now=Date.now();
  const nearest=points.reduce((best,p)=>{ const t=new Date(p.t.replace(' ','T')+'Z').getTime(); const diff=Math.abs(t-now); return diff<best.diff?{diff,v:Number(p.v)}:best; },{diff:Infinity,v:null});
  return Number.isFinite(nearest.v)?nearest.v:null;
}
function pressureBandValue(p){ p=finiteNumber(p); if(p==null) return null; if(p<990) return 0; if(p<1005) return 1; if(p<1015) return 2; if(p<1025) return 3; return 4; }
function tempBandValue(t){ t=finiteNumber(t); if(t==null) return null; if(t<32) return 0; if(t<52) return 1; if(t<72) return 2; if(t<92) return 3; return 4; }
const tierUrl = t => ['bronze','silver','gold','platinum','mythic'].includes(t) ? asset(`badges/512/${t}.png`) : null;
const matMap={Activity:'monitoring',AlarmClock:'alarm',Clock3:'schedule',Sparkles:'auto_awesome',Repeat2:'repeat',Moon:'dark_mode',Sun:'light_mode',Sunrise:'wb_twilight',Flame:'local_fire_department',Snowflake:'ac_unit',Gauge:'speed',NotebookPen:'edit_note',BadgeCheck:'verified',CalendarDays:'calendar_month',MapPinned:'location_on',Crown:'crown',Medal:'military_tech',Trophy:'trophy',Shield:'shield'};
const iconFallback={monitoring:['Pulse Oracle','⌁'],alarm:['Dawn Bell','⏰'],schedule:['Clock Sigil','⏱'],auto_awesome:['Stardust','✦'],repeat:['Echo Loop','↻'],dark_mode:['Moonwatch','☾'],light_mode:['Sunflare','☀'],wb_twilight:['First Light','◐'],local_fire_department:['Phoenix Flame','🔥'],ac_unit:['Frost Rune','❄'],speed:['Velocity Mark','⌁'],edit_note:['Field Quill','✎'],verified:['Seal of Proof','✓'],calendar_month:['Calendar Seal','▣'],location_on:['Map Pin','⌖'],crown:['Crown Mark','♛'],military_tech:['Medal Star','★'],trophy:['Victory Cup','🏆'],shield:['Ward Shield','⬟']};
const prettyIcon=n=>String(n||'shield').replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase());
// Shared glyph-font status: MIcon renders exactly ONE span (real glyph or fallback),
// never both, so the two can't ever visually stack while font-load state settles.
let msymStatus='pending'; const msymListeners=new Set();
function setMsymStatus(s){ msymStatus=s; msymListeners.forEach(fn=>fn(s)); }
function useMsymStatus(){ const [status,setStatus]=useState(msymStatus); useEffect(()=>{ msymListeners.add(setStatus); return ()=>msymListeners.delete(setStatus); },[]); return status; }
function MIcon({name,className=''}){ const status=useMsymStatus(); const key=name||'shield'; const [label,symbol]=iconFallback[key]||[prettyIcon(key),'◆']; return <span className={`icon-stack ${className}`} title={label} aria-label={label}>{status==='ready'&&<span className="msym material-symbols-outlined" aria-hidden="true">{key}</span>}{status==='failed'&&<span className="icon-fallback" aria-hidden="true">{symbol}</span>}</span> }
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
  const md=b=>{const d=new Date(b.timestamp);return `${d.getMonth()+1}-${d.getDate()}`;};
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

/** Shown immediately after login when location or notifications aren't granted.
 *  Location permission is requested on open; notification permission requires an
 *  explicit button click. OKAY dismisses locally without reloading. */
function PermissionGate(){
  const [show,setShow]=useState(false);
  const [notif,setNotif]=useState(getNotificationPermission());
  const [geo,setGeo]=useState('checking');
  useEffect(()=>{ let alive=true; (async()=>{
      let g='prompt';
      try{ const r=await navigator.permissions.query({name:'geolocation'}); g=r.state; r.onchange=()=>{ if(alive) setGeo(r.state); }; }catch{}
  const n=getNotificationPermission();
      if(!alive) return;
      setGeo(g);
      setNotif(n);
      // sessionStorage flag guarantees the gate appears at most once per session.
      // OKAY sets that flag and closes locally without forcing a page reload.
      const alreadyPrompted=sessionStorage.getItem('bust_perm_prompted')==='1';
      if(!alreadyPrompted && (g!=='granted' || (n!=='granted'&&n!=='unsupported'))) setShow(true);
    })(); return()=>{ alive=false; }; },[]);
  useEffect(()=>{ if(!show) return;
    // Location: request automatically (low-friction, needed for bust context).
    navigator.geolocation?.getCurrentPosition(
      p=>{ localStorage.setItem('bust_geo',JSON.stringify({lat:p.coords.latitude,long:p.coords.longitude,altitude:p.coords.altitude,at:Date.now()})); setGeo('granted'); },
      ()=>setGeo(g=>g==='granted'?g:'denied'),{timeout:20000});
  },[show]);
  async function askNotifications(){ setNotif(await requestNotificationPermission()); }
  if(!show) return null;
  const lbl=v=>({granted:'ENABLED',denied:'BLOCKED',default:'WAITING…',prompt:'NOT YET',checking:'…',unsupported:'N/A'}[v]||v);
  return createPortal(<div className="ach-detail-back"><div className="picker-box confirm-box mf-frame">
    <h2>Enable Permissions</h2>
    <p className="showcase-hint">BUST stamps each event with your location + weather and pings you when the crew fires.</p>
    <div className="perm-status">
      <span className={geo==='granted'?'ok':''}><MapPin/> FIND MY LAIR · {lbl(geo)}</span>
      <span className={notif==='granted'?'ok':''}><Bell/> PING ME, COACH · {lbl(notif)}</span>
    </div>
    {notif!=='granted'&&notif!=='unsupported'&&<button className="mf-button ghost" onClick={askNotifications} style={{marginBottom:'8px'}}>ENABLE NOTIFICATIONS</button>}
    {(geo==='denied'||notif==='denied')&&<small className="showcase-hint">Blocked? Click the padlock in the address bar to re-enable, then hit OKAY.</small>}
    <div className="picker-actions"><button className="mf-button" onClick={()=>closePermissionPrompt(sessionStorage, ()=>setShow(false))}>OKAY</button></div>
  </div></div>,document.body) }

function Login({ onAuthed }) {
  const [mode, setMode] = useState('login'); const [form,setForm]=useState({username:'',password:'',inviteCode:''}); const [error,setError]=useState(''); const [busy,setBusy]=useState(false);
  async function submit(e){ e.preventDefault(); setBusy(true); setError(''); try { const user = await backend[mode](form); onAuthed(user); } catch(err){ setError(err.message); } finally{ setBusy(false); }}
  return <main className="login-shell"><section className="auth-card mf-frame"><img className="login-logo" src={asset('bust-logo.png')} alt="BUST"/><p className="auth-copy">A real-time satirical pressure logging terminal for a trusted crew.</p><form onSubmit={submit}><label>Username<input value={form.username} onChange={e=>setForm({...form,username:e.target.value})} autoFocus /></label><label>Password<input type="password" value={form.password} onChange={e=>setForm({...form,password:e.target.value})} /></label>{mode==='signup'&&<label>Invite code<input value={form.inviteCode} onChange={e=>setForm({...form,inviteCode:e.target.value})} /></label>}<button className="mf-button" disabled={busy}>{busy?'TRANSMITTING…':mode==='login'?'ENTER BAY':'CREATE OPERATOR'}</button></form>{error&&<div className="error">{error}</div>}<button className="text-link" onClick={()=>setMode(mode==='login'?'signup':'login')}>{mode==='login'?'Need access? Bring the secret handshake.':'Already cleared? Login.'}</button></section></main>
}

function App(){ const [user,setUser]=useState(null); const [boot,setBoot]=useState(true); useEffect(()=>{backend.me().then(setUser).catch(()=>{}).finally(()=>setBoot(false))},[]); if(boot) return <div className="boot">UNPACKING BUST BAY…</div>; return user?<Dashboard user={user} setUser={setUser}/>:<Login onAuthed={setUser}/> }

function Dashboard({user,setUser}){ const [busts,setBusts]=useState([]),[users,setUsers]=useState([]),[unlocks,setUnlocks]=useState([]); const [debugBusts,setDebugBusts]=useState([]),[debugUnlocks,setDebugUnlocks]=useState([]),[debugXp,setDebugXp]=useState(0); const [overlay,setOverlay]=useState(null),[selected,setSelected]=useState(null),[phase,setPhase]=useState('idle'),[pendingCtx,setPendingCtx]=useState(null),[toasts,setToasts]=useState([]),[unread,setUnread]=useState(0),[muted,setMuted]=useState(sfx.isMuted()); const bustRef=useRef([]); bustRef.current=busts; const unlocksRef=useRef([]); unlocksRef.current=unlocks; const usersRef=useRef([]); usersRef.current=users; const chargeSfx=useRef(null); const seenRealtimeEvents=useRef(new Set()); const [,tick]=useState(0);
  const { current: badgeToast, enqueue: enqueueBadge, dismiss: dismissBadge } = useAchievementQueue(5200);
  const remaining = twoHoursRemainingMs(user.last_bust_timestamp); const locked = remaining > 0 && phase==='idle';
  useEffect(() => {
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
        const sent = await sendBrowserNotification('BUST Inactivity Reminder', { body: buildInactivityReminderMessage(), tag: `bust-inactivity-${user.id}` });
        if (sent) {
          const sentAt = Date.now();
          nextState = markInactivityReminderSent(reconciled, { now: sentAt });
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
    if (!allNew.length) return;
    const before = userAchievementSet(unlocksRef.current);
    const saved = await backend.saveAchievements(allNew);
    const allAchievements = saved.achievements || saved;
    setUnlocks(allAchievements);
    const after = userAchievementSet(allAchievements);
    const newlyPersisted = allNew.filter(id => after.has(id) && !before.has(id));
    const displayItems = capUnlocksPerBust(newlyPersisted).map(id => achievements.find(a => a.id === id)).filter(Boolean);
    if (displayItems.length) {
      enqueueBadge(displayItems);
      sfx.play('badge', {volume:.85});
    }
  }, [enqueueBadge, userAchievementSet]);
  const mergeRecentBusts = useCallback((recent = []) => {
    if (!Array.isArray(recent) || !recent.length) return;
    setBusts(prev => {
      const map = new Map(prev.map(b => [b.id, b]));
      for (const bust of recent) map.set(bust.id, bust);
      return [...map.values()].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    });
  }, []);
  const refresh = useCallback(async () => {
    const d = await backend.dashboard();
    setBusts(d.busts);
    setUsers(d.users);
    setUnlocks(d.achievements);
    try {
      const before = userAchievementSet(d.achievements);
      const reconciled = await backend.reconcileAchievements();
      const allAchievements = reconciled.achievements || reconciled;
      setUnlocks(allAchievements);
      const after = userAchievementSet(allAchievements);
      const restoredCount = [...after].filter(id => !before.has(id)).length;
      if (restoredCount > 0) enqueueRestoredSummary(restoredCount);
    } catch (e) { console.warn('[reconcile]', e.message); }
  }, [enqueueRestoredSummary, userAchievementSet]);
  useEffect(()=>{ refresh().catch(console.error); const unsub=backend.subscribe({
      onBust: (bust, eventType='created')=>{
        const stableEventId = `${eventType}:${bust.id}`;
        if (!markSeenEvent(seenRealtimeEvents.current, stableEventId)) return;
        setBusts(prev=>[bust,...prev.filter(b=>b.id!==bust.id)]); setSelected(prev=>prev?.id===bust.id?{...prev,...bust}:prev); setUsers(prev=>prev.map(u=>u.id===bust.user_id?{...u,last_bust_timestamp:bust.timestamp}:u));
        if (eventType === 'created' && bust.user_id === user.id) setUser(prev => prev ? { ...prev, last_bust_timestamp: bust.timestamp } : prev);
        // Only show toast + increment unread for new busts from OTHER users; not for note edits.
        if(bust.user_id!==user.id && eventType==='created'){ setUnread(n=>n+1); setToasts(t=>[{id:crypto.randomUUID(),bust},...t]); void sendBrowserNotification(`${bust.username} logged a BUST`, { body: bust.note || 'Pressure event received.', tag: `bust-${bust.id}` }); }
      },
      onProfile: p=>{ setUsers(prev=>prev.map(u=>u.id===p.id?{...u,...p}:u)); },
      onStatus: async status => {
        if (status === 'SUBSCRIBED') {
          try { mergeRecentBusts(await backend.recentBusts(60)); } catch {}
        }
      }
    }); return unsub; },[mergeRecentBusts, refresh, user.id]);
  useEffect(()=>{ if(locked&&!muted){ const h=sfx.play('drip',{loop:true,volume:.22}); const t=setTimeout(()=>h.stop(),60000); return()=>{ clearTimeout(t); h.stop(); }; } },[locked,muted]);
  async function collectContext(){ let lat=null,long=null,temp_f=null,pressure=null,city=null,elevation_ft=null,tide_ft=null; try{ const cached=JSON.parse(localStorage.getItem('bust_geo')||'null'); const pos=cached && Date.now()-cached.at<86400000 ? cached : await new Promise((res,rej)=>navigator.geolocation.getCurrentPosition(p=>res({lat:p.coords.latitude,long:p.coords.longitude,altitude:p.coords.altitude,at:Date.now()}),rej,{timeout:6000})); localStorage.setItem('bust_geo',JSON.stringify(pos)); lat=pos.lat; long=pos.long; const w=await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${long}&current=temperature_2m,surface_pressure&temperature_unit=fahrenheit`).then(r=>r.json()); temp_f=w.current?.temperature_2m ?? null; pressure=w.current?.surface_pressure ?? null; if(w.elevation!=null&&Number.isFinite(Number(w.elevation))) elevation_ft=Math.round(Number(w.elevation)*3.28084); else if(pos.altitude!=null&&Number.isFinite(Number(pos.altitude))) elevation_ft=Math.round(Number(pos.altitude)*3.28084); try{ const g=await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${long}&localityLanguage=en`).then(r=>r.json()); city=g.city||g.locality||g.principalSubdivision||null; }catch{} try{ tide_ft=await fetchTideFt(lat,long); }catch{} }catch{} return {lat,long,temp_f,pressure,city,elevation_ft,tide_ft}; }
  async function startBust(){ if(locked || phase!=='idle') return; navigator.vibrate?.([35,45,70,65,100]); setPhase('charge'); chargeSfx.current=sfx.play('charge',{loop:true,volume:.75}); const ctx=await collectContext(); setPendingCtx(ctx); setTimeout(()=>{navigator.vibrate?.([180,60,220,80,300]); chargeSfx.current?.stop(); sfx.play('explosion',{volume:.9}); setPhase('explode');},1400); setTimeout(()=>commitBust(ctx),5900); }
  async function commitBust(ctx=pendingCtx){ try{ const bust=await backend.bust({...ctx,note:''}); const current=[bust,...bustRef.current]; setBusts(prev=>[bust,...prev.filter(b=>b.id!==bust.id)]);
      // Compute ALL earned achievements — no presentation cap — then persist.
      const allNew=computeAchievementUnlocks(bust.user_id,current,unlocksRef.current,{createdAt:user.created_at,userCount:usersRef.current.length});
      await persistAndShowUnlocks(allNew);
      setUser({...user,last_bust_timestamp:bust.timestamp}); setSelected(bust); }catch(e){ alert(e.message); }
    setPendingCtx(null); setPhase('idle'); }
  async function saveBustNote(bust,noteText){ const updated=await backend.patchBustNote(bust.id,noteText); const current=[updated,...bustRef.current.filter(b=>b.id!==updated.id)]; setBusts(current); setSelected(prev=>prev?.id===updated.id?{...prev,...updated}:prev);
    const allNew=computeAchievementUnlocks(updated.user_id,current,unlocksRef.current,{createdAt:user.created_at,userCount:usersRef.current.length});
    await persistAndShowUnlocks(allNew);
    return updated; }
  const effectiveBusts=useMemo(()=>[...debugBusts,...busts],[debugBusts,busts]);
  const effectiveUnlocks=useMemo(()=>[...debugUnlocks,...unlocks],[debugUnlocks,unlocks]);
  function addDebugUnlock(id){ const item=achievements.find(a=>a.id===id); if(!item) return; setDebugUnlocks(prev=>prev.some(a=>a.user_id===user.id&&a.achievement_type===id)?prev:[{id:`debug-unlock-${id}-${Date.now()}`,user_id:user.id,achievement_type:id,unlocked_at:new Date().toISOString(),debug:true},...prev]); enqueueBadge([item]); sfx.play('badge',{volume:.85}); }
  function addDebugBust(payload){ const when=payload.timestamp?new Date(payload.timestamp):new Date(); const bust={id:`debug-bust-${Date.now()}`,user_id:user.id,username:user.username,avatar_seed:user.avatar_seed,timestamp:when.toISOString(),time_bucket:timeBucket(when),note:String(payload.note||''),temp_f:payload.temp_f===''?null:Number(payload.temp_f),pressure:payload.pressure===''?null:Number(payload.pressure),lat:payload.lat===''?null:Number(payload.lat),long:payload.long===''?null:Number(payload.long),city:payload.city||'Debug Bay',elevation_ft:payload.elevation_ft===''?null:Number(payload.elevation_ft),tide_ft:payload.tide_ft===''?null:Number(payload.tide_ft),debug:true}; const current=[bust,...effectiveBusts]; setDebugBusts(prev=>[bust,...prev]); setSelected(bust); const newOnes=capUnlocksPerBust(computeAchievementUnlocks(user.id,current,effectiveUnlocks,{createdAt:user.created_at,userCount:users.length})); newOnes.forEach(addDebugUnlock); }
  function clearDebug(){ dismissBadge(); setDebugBusts([]); setDebugUnlocks([]); setDebugXp(0); setSelected(prev=>prev?.debug?null:prev); }
  function resetDebugCooldown(){ setUser(u=>({...u,last_bust_timestamp:null})); setUsers(prev=>prev.map(u=>u.id===user.id?{...u,last_bust_timestamp:null}:u)); setPhase('idle'); }
  SHOWCASE_MAP=Object.fromEntries(users.map(u=>[u.id,validShowcaseIds(u.showcase,earnedIdSet(effectiveUnlocks,u.id))]));
  const analytics=useMemo(()=>buildAnalytics(effectiveBusts,users,user,effectiveUnlocks,debugXp),[effectiveBusts,users,user,effectiveUnlocks,debugXp]);
  const myLevel=useMemo(()=>debugXp?levelForXp(debugXp):derivePersonalStats(user.id,effectiveBusts,effectiveUnlocks).level,[user.id,effectiveBusts,effectiveUnlocks,debugXp]);
  const mythicIds=useMemo(()=>new Set(analytics.leaderboard.filter(u=>u.lvl.nextAt==null).map(u=>u.id)),[analytics.leaderboard]);
  return <main className={`dash ${locked?'cooldown-mode':''} ${phase==='charge'?'charging':''} ${phase==='explode'?'detonating':''}`}><GridBg/><PermissionGate/>{locked&&<CooldownGoop/>}<header className="top-bar"><button className="profile-chip" onClick={()=>setOverlay('profile')}><img src={avatar(user.avatar_seed)}/><span className={myLevel.title==='MasterBaiter'?'rank-mythic':''}>{user.username}</span></button><img className="brand-mark" src={asset('bust-logo.png')} alt="" aria-hidden="true"/><div className="top-actions"><button className="icon-btn" title={muted?'Unmute SFX':'Mute SFX'} onClick={()=>setMuted(sfx.toggleMuted())}>{muted?<VolumeX/>:<Volume2/>}</button><button className="icon-btn" onClick={()=>{setOverlay('alerts');setUnread(0)}}><Bell/>{unread>0&&<b>{unread}</b>}</button><button className="icon-btn trophy-action" onClick={()=>setOverlay('trophy')}><Trophy/><small>{new Set(effectiveUnlocks.filter(a=>a.user_id===user.id).map(a=>a.achievement_type)).size}</small></button></div></header><section className="button-stage">{locked?<CooldownScene/>:<BustButton phase={phase} onClick={startBust}/>}</section><button className="drawer-handle" onClick={()=>setOverlay('analytics')}><ChevronUp/> ANALYTICS BAY</button><Toasts toasts={toasts} setToasts={setToasts} onOpen={setSelected} mythicIds={mythicIds}/><AnimatePresence>{badgeToast&&<BadgeToast key="badge-toast" badge={badgeToast}/>} {overlay&&<Overlay key={`overlay-${overlay}`} title={overlayTitle(overlay)} onClose={()=>setOverlay(null)} showScrollTop={['profile','analytics','trophy'].includes(overlay)}>{overlay==='profile'&&<Profile user={user} setUser={setUser} busts={effectiveBusts} unlocks={effectiveUnlocks} users={users} onOpen={setSelected} mythicIds={mythicIds} debug={{xp:debugXp,setXp:setDebugXp,onBust:addDebugBust,onUnlock:addDebugUnlock,onClear:clearDebug,onResetCooldown:resetDebugCooldown,counts:{busts:debugBusts.length,unlocks:debugUnlocks.length}}}/>} {overlay==='alerts'&&<Alerts busts={effectiveBusts} onOpen={setSelected} mythicIds={mythicIds}/>} {overlay==='analytics'&&<Analytics data={analytics} busts={effectiveBusts} onOpen={setSelected} mythicIds={mythicIds}/>} {overlay==='trophy'&&<TrophyCabinet unlocks={effectiveUnlocks} busts={effectiveBusts} user={user}/>}</Overlay>} {selected&&<Detail key={`detail-${selected.id}`} bust={selected} all={effectiveBusts} currentUserId={user.id} onSaveNote={saveBustNote} onClose={()=>setSelected(null)} mythicIds={mythicIds}/>}</AnimatePresence>{phase==='explode'&&<Explosion/>}</main> }
function GridBg(){ return <div className="grid-bg"/> }
function BustButton({phase,onClick}){ return <motion.button className="bust-button" disabled={phase!=='idle'} onClick={onClick} animate={phase==='charge'?{scale:[1,1.07,.96,1.09,1],rotate:[0,-3,3,-5,5,0]}:{}} transition={{duration:.18,repeat:phase==='charge'?Infinity:0}}><span>{phase==='charge'?'Edging…':'BUST'}</span>{phase==='charge'&&<><i/><i/><i/><i/></>}</motion.button> }
function Explosion(){ const drops=Array.from({length:110}); const ropes=Array.from({length:18}); const shards=Array.from({length:30}); return <div className="explosion"><div className="blast-flash"/>{ropes.map((_,i)=><b className="goop-rope" key={`r${i}`} style={{'--l':`${Math.random()*100}%`,'--w':`${22+Math.random()*80}px`,'--h':`${38+Math.random()*70}vh`,'--d':`${Math.random()*.55}s`}}/>)}{drops.map((_,i)=><span className="milk-drop" key={`d${i}`} style={{'--x':`${Math.random()*150-75}vw`,'--y':`${Math.random()*120-60}vh`,'--s':`${7+Math.random()*28}px`,'--d':`${Math.random()*1.1}s`}}/>)}{shards.map((_,i)=><i className="button-shard" key={`s${i}`} style={{'--x':`${Math.random()*120-60}vw`,'--y':`${Math.random()*100-50}vh`,'--r':`${Math.random()*900-450}deg`,'--d':`${Math.random()*.6}s`}}/>)}<div className="milk-sheet"/><div className="screen-splatter"/></div> }
function CooldownGoop(){ return <div className="cooldown-goop" aria-hidden="true"><span/><span/><span/><span/><span/><span/><span/><span/></div> }
function NoteModal({initial='',onSave,onClose}){ const [note,setNote]=useState(initial); const [busy,setBusy]=useState(false); const [err,setErr]=useState(''); const [center,setCenter]=useState({left:'50%',top:'50%'}); useEffect(()=>{ const update=()=>{ const vv=window.visualViewport; setCenter(vv?{left:`${vv.offsetLeft+vv.width/2}px`,top:`${vv.offsetTop+vv.height/2}px`}:{left:'50%',top:'50%'}); }; update(); window.visualViewport?.addEventListener('resize',update); window.visualViewport?.addEventListener('scroll',update); window.addEventListener('resize',update); return()=>{ window.visualViewport?.removeEventListener('resize',update); window.visualViewport?.removeEventListener('scroll',update); window.removeEventListener('resize',update); }; },[]); useEffect(()=>{ const onKey=e=>{ if(e.key==='Escape') onClose(); }; window.addEventListener('keydown',onKey); return()=>window.removeEventListener('keydown',onKey); },[onClose]); return createPortal(<motion.div className="note-back" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} onClick={onClose}><motion.div className="note-pop mf-frame" style={center} initial={{opacity:0,scale:.9}} animate={{opacity:1,scale:1}} exit={{opacity:0,scale:.92}} onClick={e=>e.stopPropagation()}><button className="detail-close" onClick={onClose} aria-label="Close note editor"><X/></button><h2>CAPTURE BUST NOTE</h2><textarea value={note} maxLength={240} onChange={e=>setNote(e.target.value)} placeholder="Optional field report…" autoFocus/><small className="note-count">{note.length}/240</small><div className="note-actions"><button className="mf-button ghost" disabled={busy} onClick={onClose}>CANCEL</button><button className="mf-button" disabled={busy} onClick={async()=>{ setBusy(true); setErr(''); try{ await onSave(note); onClose(); }catch(e){ setErr(e.message); setBusy(false); } }}>{busy?'SAVING…':'SAVE NOTE'}</button></div>{err&&<div className="error">{err}</div>}</motion.div></motion.div>,document.body) }
function CooldownScene(){ return <div className="cooldown-scene" aria-label="BUST cooldown scene"><div className="iso"><div className="fallen">Busted</div></div></div> }
const recordEmoji={Crown:'👑',Snowflake:'❄️',Gauge:'📈',AlarmClock:'⏰',Flame:'🔥',Repeat2:'🔁',Moon:'🌙',NotebookPen:'📝'};
function RecordIcon({name}){ return <span className="record-emoji" aria-hidden="true">{recordEmoji[name]||'🏆'}</span> }
function BadgeIcon({name}){ return <MIcon name={matMap[name]||name||'shield'}/> }
function BadgeMedal({icon,accent,tier}){ const url=tier?tierUrl(tier):null; return <div className={`badge-medal${url?` tier-plated`:''}`} style={{'--badge':accent,...(url?{backgroundImage:`url(${url})`}:{})}}><BadgeIcon name={icon}/></div> }
function BadgeToast({badge}){ if(!badge) return null; return <motion.div className="badge-toast mf-frame" initial={{opacity:0,y:-22,scale:.92}} animate={{opacity:1,y:0,scale:1}} exit={{opacity:0,y:-22}}><BadgeMedal icon={badge.micon||badge.icon} accent={badge.accent} tier={badge.tier}/><div><span>{badge.isRestorationSummary?'HISTORICAL RECONCILIATION':badge.isRestored?'ACHIEVEMENT RESTORED':'ACHIEVEMENT UNLOCKED'}</span><h2>{badge.isRestorationSummary?`${badge.restoredCount} historical achievements restored`:badge.name}</h2><p>{badge.isRestorationSummary?'View your Trophy Cabinet to inspect restored unlocks.':`${badge.tier.toUpperCase()} · ${badge.points} XP`}</p></div></motion.div> }
function Overlay({title,onClose,children,showScrollTop=false}){ const ref=useRef(null); return <motion.section ref={ref} className="overlay" initial={{y:'100%'}} animate={{y:0}} exit={{y:'100%'}}><button className="close" onClick={onClose}><X/></button><div className="overlay-head"><h1>{title}</h1></div>{children}{showScrollTop&&<button type="button" className="scroll-top" aria-label="Back to top" title="Back to top" onClick={()=>ref.current?.scrollTo({top:0,behavior:'smooth'})}><ChevronUp/></button>}</motion.section> }
function Detail({bust,all,currentUserId,onSaveNote,onClose,mythicIds}){ const [editing,setEditing]=useState(false); const own=bust.user_id===currentUserId; const temp=finiteNumber(bust.temp_f); const pressure=finiteNumber(bust.pressure); return <motion.div className="detail-back" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}}><div className="detail mf-frame"><button className="detail-close" onClick={onClose} aria-label="Close detail"><X/></button><img src={avatar(bust.avatar_seed)}/><h2><span className={mythicIds?.has(bust.user_id)?'rank-mythic':''}>{bust.username}</span><NameBadges userId={bust.user_id}/></h2><p>{fmt(bust.timestamp)} · {bust.time_bucket}</p>{bust.note?<blockquote>{bust.note}</blockquote>:<p className="detail-empty-note">No field note yet.</p>}{own&&<button type="button" className="mf-button ghost add-note-btn" onClick={()=>setEditing(true)}><Pencil/> Add Note</button>}<div className="metric-grid"><Metric icon={<Thermometer/>} label="TEMP" value={temp!=null?`${Math.round(temp)}°F`:'—'}/><Metric icon={<Gauge/>} label="PRESSURE" value={pressureLabel(bust.pressure)||'—'} sub={pressure!=null?`${Math.round(pressure)} hPa`:null}/><Metric icon={<Waves/>} label="TIDE" value={tideLabel(bust.tide_ft)}/><Metric icon={<MapPin/>} label="LOCATION" value={bust.city||'Unknown'}/><Metric icon={<Mountain/>} label="ALTITUDE" value={elevationLabel(bust.elevation_ft)}/><Metric icon={<Medal/>} label="DAY RANK" value={`#${rankForDay(bust,all)}`}/></div></div>{editing&&<NoteModal initial={bust.note||''} onClose={()=>setEditing(false)} onSave={note=>onSaveNote(bust,note)}/>}</motion.div> }
function Metric({icon,label,value,sub}){return <div className="metric">{icon}<small>{label}</small><strong>{value}</strong>{sub&&<em className="metric-sub">{sub}</em>}</div>}
/** Location + notification permission re-request controls (profile). Browsers only re-prompt when state is 'prompt'; DENIED requires the browser's site settings. */
function PermissionControls(){
  const [notif,setNotif]=useState(getNotificationPermission());
  const [geo,setGeo]=useState('unknown');
  useEffect(()=>{
    navigator.permissions?.query({name:'geolocation'}).then(r=>{ setGeo(r.state); r.onchange=()=>setGeo(r.state); }).catch(()=>{});
    const syncNotif=()=>setNotif(getNotificationPermission());
    syncNotif();
    window.addEventListener('focus', syncNotif);
    return ()=>window.removeEventListener('focus', syncNotif);
  },[]);
  async function askNotif(){ setNotif(await requestNotificationPermission()); }
  function askGeo(){ if(!navigator.geolocation){ setGeo('unsupported'); return; } localStorage.removeItem('bust_geo'); navigator.geolocation.getCurrentPosition(
    p=>{ localStorage.setItem('bust_geo',JSON.stringify({lat:p.coords.latitude,long:p.coords.longitude,altitude:p.coords.altitude,at:Date.now()})); setGeo('granted'); },
    ()=>setGeo('denied'),{timeout:8000}); }
  const label=v=>({granted:'ON',denied:'BLOCKED',prompt:'ASK',default:'ASK',unknown:'ASK',unsupported:'N/A'}[v]||v);
  return <div className="perm-row">
    <span className="perm-title">DEVICE PERMISSIONS</span>
    <div>
      <button type="button" className="mf-button ghost" onClick={askGeo}><MapPin/> FIND MY LAIR · {label(geo)}</button>
      <button type="button" className="mf-button ghost" onClick={askNotif}><Bell/> PING ME, COACH · {label(notif)}</button>
    </div>
    {(geo==='denied'||notif==='denied')&&<small>A blocked permission can only be re-enabled from your browser's site settings (padlock icon in the address bar).</small>}
  </div> }
function DebugMenu({debug,onClose}){ const [form,setForm]=useState({note:'Debug bust',temp_f:'72',pressure:'1013',city:'Debug Bay',lat:'',long:'',elevation_ft:'100',tide_ft:'1.0',timestamp:new Date().toISOString().slice(0,16)}); const [pick,setPick]=useState(''); const set=(k,v)=>setForm(f=>({...f,[k]:v})); const unlockables=achievements.slice().sort((a,b)=>a.name.localeCompare(b.name)); return createPortal(<div className="ach-detail-back" onClick={onClose}><div className="debug-box mf-frame" onClick={e=>e.stopPropagation()}><button className="detail-close" onClick={onClose} aria-label="Close debug menu"><X/></button><h2>Debug Menu</h2><p className="showcase-hint">Session-only sandbox. Nothing here writes to the database or alerts the crew.</p><div className="debug-grid"><label>XP Override<input type="number" value={debug.xp} onChange={e=>debug.setXp(Math.max(0,Number(e.target.value)||0))}/></label><label>Time<input type="datetime-local" value={form.timestamp} onChange={e=>set('timestamp',e.target.value)}/></label><label>Temp °F<input type="number" value={form.temp_f} onChange={e=>set('temp_f',e.target.value)}/></label><label>Pressure hPa<input type="number" value={form.pressure} onChange={e=>set('pressure',e.target.value)}/></label><label>Altitude ft ASL<input type="number" value={form.elevation_ft} onChange={e=>set('elevation_ft',e.target.value)}/></label><label>Tide ft (+high/-low)<input type="number" step="0.1" value={form.tide_ft} onChange={e=>set('tide_ft',e.target.value)}/></label><label>City<input value={form.city} onChange={e=>set('city',e.target.value)}/></label><label>Latitude<input type="number" value={form.lat} onChange={e=>set('lat',e.target.value)}/></label><label>Longitude<input type="number" value={form.long} onChange={e=>set('long',e.target.value)}/></label></div><label className="debug-note">Note<textarea value={form.note} maxLength={240} onChange={e=>set('note',e.target.value)}/></label><div className="picker-actions"><button className="mf-button" onClick={()=>debug.onBust(form)}>ADD DEBUG BUST</button></div><div className="debug-unlock"><select value={pick} onChange={e=>setPick(e.target.value)}><option value="">Select unlock visual…</option>{unlockables.map(a=><option key={a.id} value={a.id}>{a.name} · {a.kind} · {a.points} XP</option>)}</select><button className="mf-button ghost" disabled={!pick} onClick={()=>{debug.onUnlock(pick);setPick('');}}>TRIGGER UNLOCK</button></div><div className="debug-footer"><span>{debug.counts.busts} debug busts · {debug.counts.unlocks} debug unlocks · {debug.xp} debug XP</span><button className="mf-button ghost" onClick={debug.onResetCooldown}>RESET COOLDOWN OVERRIDE</button><button className="mf-button ghost danger" onClick={debug.onClear}>CLEAR DEBUG SESSION</button></div></div></div>,document.body) }
function Profile({user,setUser,busts,unlocks,users,onOpen,debug,mythicIds}){
  const [tagline,setTagline]=useState(user.tagline||''); const [saving,setSaving]=useState(false); const [saved,setSaved]=useState(false); const [showPicker,setShowPicker]=useState(false); const [confirmDel,setConfirmDel]=useState(false); const [ctx,setCtx]=useState(null); const [showDebug,setShowDebug]=useState(false);
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
    <div className="logout-row"><button className="mf-button ghost" onClick={async()=>{await backend.logout();setUser(null)}}><LogOut/> LOG OUT</button><button className="mf-button ghost danger" onContextMenu={e=>{ e.preventDefault(); setCtx({x:e.clientX,y:e.clientY}); }} onClick={()=>setConfirmDel(true)}>DELETE ACCOUNT</button></div>
    {ctx&&<div className="debug-context" style={{left:ctx.x,top:ctx.y}}><button onClick={()=>{setCtx(null);setShowDebug(true);}}>Debug Menu</button><button onClick={()=>setCtx(null)}>Close</button></div>}
    {showDebug&&debug&&<DebugMenu debug={debug} onClose={()=>setShowDebug(false)}/>}
    {confirmDel&&<DeleteAccountModal onClose={()=>setConfirmDel(false)} onDeleted={()=>setUser(null)}/>}
  </div> }
function Alerts({busts,onOpen,mythicIds}){ return <div className="feed two-col">{busts.map(b=><BustCard key={b.id} b={b} onOpen={onOpen} mythicIds={mythicIds}/>)}</div> }
function BustCard({b,onOpen,mythicIds}){ return <button className="bust-card mf-frame" onClick={()=>onOpen(b)}><img src={avatar(b.avatar_seed)}/><div><strong><span className={mythicIds?.has(b.user_id)?'rank-mythic':''}>{b.username}</span><NameBadges userId={b.user_id}/></strong><span>{fmt(b.timestamp)} · {b.time_bucket}</span><p>{b.note || 'Pressure spike recorded.'}</p></div></button> }
function Analytics({data,busts,onOpen,mythicIds}){ const today=busts.filter(b=>todayKey(b.timestamp)===todayKey()); return <div className="analytics"><div className="stat-strip">{data.stats.map(s=><div className="stat mf-frame" key={s.label}><span>{s.label}</span><strong>{s.value}</strong><small>{s.hint}</small></div>)}</div><section className="analytics-grid"><div className="mf-frame module leaderboard-module"><h2>Leaderboard</h2><p>Ranked avatar tiles with satirical titles and all-time volume.</p>{data.leaderboard.length?data.leaderboard.map((u,i)=><div className="leader" key={u.id}><span>#{i+1}</span><img src={avatar(u.avatar_seed)}/><b><span className={mythicIds?.has(u.id)?'rank-mythic':''}>{u.username}</span><NameBadges userId={u.id}/>{u.streak>1&&<i className="streak-pill" title="current daily streak">{u.streak}d 🔥</i>}</b><Sparkline data={u.spark}/><em>{u.count} busts <i className="lvl-chip">LVL {u.lvl.level}{u.lvl.level>=10?` · ${u.lvl.points} XP`:''}</i> <span className="lvl-rank-name">{u.lvl.title}</span>{u.tagline?` · "${u.tagline}"`:''}</em></div>):<EmptyState text="No operators have logged yet."/>}</div><div className="mf-frame module"><h2>30-Day Trend</h2><p>Group volume, rolling month.</p><TrendChart data={data.trend}/></div><div className="mf-frame module"><h2>Daypart Share</h2><p>Which windows carry the group.</p>{Object.keys(data.buckets).length?<DonutChart data={Object.entries(data.buckets).map(([label,value])=>({label,value}))}/>:<EmptyState text="Awaiting events."/>}</div><div className="mf-frame module"><h2>Hour Histogram</h2><p>Raw hour-of-day distribution.</p><HourHistogram counts={data.hourHist}/></div><div className="mf-frame module chart-module"><h2>Weekly Volume</h2><p>Day-over-day ledger intensity.</p><div className="bars">{data.week.map(d=><div key={d.label}><i style={{height:`${Math.max(8,d.count*22)}px`}}/><strong>{d.count}</strong><span>{d.label}</span></div>)}</div></div><div className="mf-frame module chart-module"><h2>Heatmap</h2><p>24-hour activity by day of week.</p><div className="heat-wrap"><div className="heat-axis">{['S','M','T','W','T','F','S'].map((d,i)=><b key={i}>{d}</b>)}</div><div className="heat">{data.heat.map((v,i)=><span key={i} style={{opacity:.12+Math.min(v,5)*.18}} title={`${v} events`}/>)}</div></div></div><div className="mf-frame module chart-module"><h2>Environment Scatter</h2><p>Temperature versus barometric pressure.</p>{data.scatterPts.length?<ScatterChart points={data.scatterPts}/>:<EmptyState text="Awaiting environment data."/>}</div><div className="mf-frame module"><h2>Operator Contribution</h2><p>Each operator's share of all-time group volume.</p>{data.perUser.length?<HBarChart items={data.perUser.map(u=>({...u,value:`${u.value} · ${u.pct}%`}))}/>:<EmptyState text="No busts logged yet."/>}</div><div className="mf-frame module"><h2>XP Rankings</h2><p>Cumulative experience across achievements unlocked.</p>{data.xpRanking.length?<HBarChart items={data.xpRanking}/>:<EmptyState text="No achievements unlocked yet."/>}</div></section><section className="records-grid">{data.records.map(r=><div className="record-card mf-frame" key={r.id}><RecordIcon name={r.icon}/><span>{r.label}</span><strong>{r.value}</strong><p>{r.detail}</p></div>)}</section><h2 className="section-title">Today's Feed</h2><div className="feed two-col">{today.length?today.map(b=><BustCard key={b.id} b={b} onOpen={onOpen} mythicIds={mythicIds}/>):<EmptyState text="No busts in the current 24-hour window."/>}</div></div> }
function TrophyCabinet({unlocks,busts,user}){
  const [detail,setDetail]=useState(null);
  const set=new Set(unlocks.filter(a=>a.user_id===user.id).map(a=>a.achievement_type));
  const catalog=achievements;
  const badges=catalog.filter(i=>i.kind!=='achievement');
  const achs=catalog.filter(i=>i.kind==='achievement');
  const won=list=>list.filter(i=>set.has(i.id)).length;
  const xp=[...set].map(id=>achievements.find(x=>x.id===id)?.points||0).reduce((s2,p2)=>s2+p2,0);
  const sortU=(a,b)=>(set.has(b.id)?1:0)-(set.has(a.id)?1:0);
  return <div className="achievement-hall">
    <div className="trophy-summary mf-frame"><Trophy/><div><span>ACHIEVEMENT HALL</span><strong>{won(badges)+won(achs)}/{catalog.length} unlocked · {xp} XP</strong></div></div>
    <h2 className="section-title">Badges <small className="count-pill">{won(badges)}/{badges.length}</small></h2>
    <div className="ach-grid">{[...badges].sort(sortU).map(i=><AchievementCard key={i.id} item={i} unlocked={set.has(i.id)} onClick={()=>setDetail(i)}/>)}</div>
    <h2 className="section-title ach-title">Achievements <small className="count-pill">{won(achs)}/{achs.length}</small></h2>
    <div className="ach-grid">{[...achs].sort(sortU).map(i=><AchievementCard key={i.id} item={i} unlocked={set.has(i.id)} onClick={()=>setDetail(i)}/>)}</div>
    <AnimatePresence>{detail&&<AchDetail key="ach-detail" item={detail} unlocked={set.has(detail.id)} progress={itemProgress(detail,busts,user,unlocks)} onClose={()=>setDetail(null)}/>}</AnimatePresence>
  </div> }
function EmptyState({text}){ return <div className="empty-state"><Sparkles/><span>{text}</span></div> }
function Toasts({toasts,setToasts,onOpen,mythicIds}){ return <div className="toasts">{toasts.map(t=><div className="toast mf-frame" key={t.id} onClick={()=>onOpen(t.bust)}><button onClick={(e)=>{e.stopPropagation();setToasts(x=>x.filter(y=>y.id!==t.id))}}>×</button><b><span className={mythicIds?.has(t.bust.user_id)?'rank-mythic':''}>{t.bust.username}</span> BUSTED</b><span>{t.bust.note||'Open detail card.'}</span></div>)}</div> }
function overlayTitle(o){return {profile:'OPERATOR PROFILE',alerts:'ALERT FEED',analytics:'ANALYTICS DRAWER',trophy:'TROPHY CABINET'}[o]}
function buildAnalytics(busts,users,user,unlocks=[],debugXp=0){ const xpFor=id=>(id===user.id&&debugXp)?debugXp:unlocks.filter(a=>a.user_id===id).map(a=>achievements.find(x=>x.id===a.achievement_type)?.points||0).reduce((s,p)=>s+p,0); const counts=users.map(u=>({...u,count:busts.filter(b=>b.user_id===u.id).length,lvl:levelForXp(xpFor(u.id))})).sort((a,b)=>b.count-a.count); const today=busts.filter(b=>todayKey(b.timestamp)===todayKey()).length; const rank=counts.findIndex(u=>u.id===user.id)+1; const stats=[{label:'GROUP BUSTS',value:busts.length,hint:'all-time ledger'},{label:'ACTIVE PLAYERS',value:users.length,hint:'registered operators'},{label:'TODAY',value:today,hint:'current local day'},{label:'YOUR RANK',value:rank>0?'#'+rank:'—',hint:'daily pressure index'}]; const week=Array.from({length:7}).map((_,i)=>{const d=new Date();d.setDate(d.getDate()-(6-i));return {label:d.toLocaleDateString([],{weekday:'short'}),count:busts.filter(b=>new Date(b.timestamp).toDateString()===d.toDateString()).length}}); const heat=Array.from({length:24*7},(_,i)=>busts.filter(b=>new Date(b.timestamp).getDay()*24+new Date(b.timestamp).getHours()===i).length); const temps=busts.map(b=>({b,temp:finiteNumber(b.temp_f),pressure:finiteNumber(b.pressure)})).filter(x=>x.temp!=null&&x.pressure!=null); const scatterPts=temps.map(({b,temp,pressure})=>({x:temp,y:pressure,label:`${b.username||'?'} — ${Math.round(temp)}°F, ${Math.round(pressure)} hPa`})); const records=deriveAllTimeRecords(busts);
 const trend=buildTrend(busts,30);
 const buckets={}; busts.forEach(b=>{const k=b.time_bucket||timeBucket(b.timestamp);buckets[k]=(buckets[k]||0)+1;});
 const hourHist=Array.from({length:24},(_,h)=>busts.filter(b=>new Date(b.timestamp).getHours()===h).length);
 const leaderboard=counts.map(u=>{const own=busts.filter(b=>b.user_id===u.id);return {...u,spark:buildTrend(own,14).map(d=>d.count),streak:deriveStreaks(own).current};});
 const total=busts.length||1;
 const perUser=counts.filter(u=>u.count>0).map(u=>({label:u.username,value:`${u.count} bust${u.count===1?'':'s'}`,pct:Math.round(u.count/total*100)}));
 const maxXp=Math.max(1,...counts.map(u=>u.lvl.points));
 const xpRanking=counts.filter(u=>u.lvl.points>0).map(u=>({label:u.username,value:`${u.lvl.points} XP`,pct:Math.round(u.lvl.points/maxXp*100)}));
 return {stats,leaderboard,week,heat,scatterPts,records,trend,buckets,hourHist,perUser,xpRanking}; }
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
