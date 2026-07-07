import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Bell, ChevronUp, Gauge, LogOut, MapPin, Medal, Repeat2, Sparkles, Thermometer, Trophy, Volume2, VolumeX, X } from 'lucide-react';
import 'material-symbols/outlined.css';
import './styles.css';
import { achievements, capUnlocksPerBust, computeAchievementUnlocks, deriveAllTimeRecords, derivePersonalStats, deriveStreaks, buildTrend, progressionCatalog, timeBucket, twoHoursRemainingMs, todayKey } from './rules.js';
import { expansionItems } from './expansion.js';
import { TrendChart, DonutChart, HourHistogram, Sparkline, ScatterChart } from './charts.jsx';
import { backend } from './backend.js';
import * as sfx from './audio.js';

export const asset = p => import.meta.env.BASE_URL + String(p).replace(/^\//, '');
function avatar(seed) { return `https://api.dicebear.com/9.x/identicon/svg?seed=${encodeURIComponent(seed || 'bust')}&backgroundColor=0a0a0b&rowColor=ff5e00,f5f0e8`; }
function fmt(ts) { return new Date(ts).toLocaleString([], { month:'short', day:'numeric', hour:'numeric', minute:'2-digit' }); }
function rankForDay(bust, busts) { const d = new Date(bust.timestamp).toDateString(); const list = busts.filter(b=>new Date(b.timestamp).toDateString()===d).sort((a,b)=>new Date(a.timestamp)-new Date(b.timestamp)); return list.findIndex(b=>b.id===bust.id)+1 || '—'; }
function pressureLabel(p){ p=Number(p); if(!Number.isFinite(p)) return null; if(p<990) return 'Very Low'; if(p<1005) return 'Low'; if(p<1015) return 'Medium'; if(p<1025) return 'High'; return 'Very High'; }
const tierUrl = t => ['bronze','silver','gold','platinum','mythic'].includes(t) ? asset(`badges/512/${t}.png`) : null;
const matMap={Activity:'monitoring',AlarmClock:'alarm',Clock3:'schedule',Sparkles:'auto_awesome',Repeat2:'repeat',Moon:'dark_mode',Sun:'light_mode',Sunrise:'wb_twilight',Flame:'local_fire_department',Snowflake:'ac_unit',Gauge:'speed',NotebookPen:'edit_note',BadgeCheck:'verified',CalendarDays:'calendar_month',MapPinned:'location_on',Crown:'crown',Medal:'military_tech',Trophy:'trophy',Shield:'shield'};
function MIcon({name,className=''}){ return <span className={`msym material-symbols-outlined ${className}`} aria-hidden="true">{name}</span> }
function AchievementCard({item,unlocked,onClick}){ return <div className={`ach-card mf-frame ${unlocked?'won':'locked'} tier-${item.tier}${onClick?' clickable':''}`} onClick={onClick} role={onClick?'button':undefined} tabIndex={onClick?0:undefined} onKeyDown={e=>{if(onClick&&(e.key==='Enter'||e.key===' ')){e.preventDefault();onClick();}}}>
  <MIcon name={item.micon||matMap[item.icon]||'shield'} className="ach-icon"/>
  <h3>{item.name}</h3>
  <p>{item.desc}</p>
  <div className="ach-foot"><span className="ach-xp">{item.points} XP</span><span className="tier-chip"><img className="tier-img" src={tierUrl(item.tier)} alt={item.tier}/><b>{item.tier}</b></span></div>
</div> }
/** Enlarged achievement card popup. Closes via X, backdrop click, or Escape. */
function AchDetail({item,unlocked,onClose}){
  useEffect(()=>{ const onKey=e=>{ if(e.key==='Escape') onClose(); }; window.addEventListener('keydown',onKey); return()=>window.removeEventListener('keydown',onKey); },[onClose]);
  // Portal to <body>: ancestors with transform/backdrop-filter hijack position:fixed.
  return createPortal(<motion.div className="ach-detail-back" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} onClick={onClose}>
    <motion.div className={`ach-detail mf-frame tier-${item.tier} ${unlocked?'won':'locked'}`} initial={{scale:.85,y:14}} animate={{scale:1,y:0}} onClick={e=>e.stopPropagation()}>
      <button className="detail-close" onClick={onClose} aria-label="Close"><X/></button>
      <MIcon name={item.micon||matMap[item.icon]||'shield'} className="ach-icon xl"/>
      <h2>{item.name}</h2>
      <p>{item.desc}</p>
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
function NameBadges({userId}){ const ids=SHOWCASE_MAP[userId]||[]; if(!ids.length) return null; return <span className="name-badges">{ids.map(id=>{ const it=achievements.find(a=>a.id===id); return it?<i key={id} className={`name-badge tier-${it.tier}`} title={`${it.name} (${it.tier})`}><MIcon name={it.micon||matMap[it.icon]||'shield'}/></i>:null; })}</span> }

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
 *  Fires the browser permission prompts on open; SKIP dismisses, OKAY reloads. */
function PermissionGate(){
  const [show,setShow]=useState(false);
  const [notif,setNotif]=useState(typeof Notification!=='undefined'?Notification.permission:'unsupported');
  const [geo,setGeo]=useState('checking');
  useEffect(()=>{ let alive=true; (async()=>{
      let g='prompt';
      try{ const r=await navigator.permissions.query({name:'geolocation'}); g=r.state; r.onchange=()=>{ if(alive) setGeo(r.state); }; }catch{}
      if(!alive) return;
      setGeo(g);
      const n=typeof Notification!=='undefined'?Notification.permission:'unsupported';
      if(g!=='granted' || (n!=='granted'&&n!=='unsupported')) setShow(true);
    })(); return()=>{ alive=false; }; },[]);
  useEffect(()=>{ if(!show) return; // trigger the real browser prompts as soon as the popup appears
    if(typeof Notification!=='undefined'&&Notification.permission==='default') Notification.requestPermission().then(setNotif).catch(()=>{});
    navigator.geolocation?.getCurrentPosition(
      p=>{ localStorage.setItem('bust_geo',JSON.stringify({lat:p.coords.latitude,long:p.coords.longitude,at:Date.now()})); setGeo('granted'); },
      ()=>setGeo(g=>g==='granted'?g:'denied'),{timeout:20000});
  },[show]);
  if(!show) return null;
  const lbl=v=>({granted:'ENABLED',denied:'BLOCKED',default:'WAITING…',prompt:'WAITING…',checking:'…',unsupported:'N/A'}[v]||v);
  return createPortal(<div className="ach-detail-back"><div className="picker-box confirm-box mf-frame">
    <h2>Enable Permissions</h2>
    <p className="showcase-hint">BUST stamps each event with your location + weather and pings you when the crew fires. Allow the browser prompts above, then hit OKAY.</p>
    <div className="perm-status">
      <span className={geo==='granted'?'ok':''}><MIcon name="location_on"/> LOCATION · {lbl(geo)}</span>
      <span className={notif==='granted'?'ok':''}><MIcon name="notifications"/> NOTIFICATIONS · {lbl(notif)}</span>
    </div>
    {(geo==='denied'||notif==='denied')&&<small className="showcase-hint">Blocked? Click the padlock in the address bar to re-enable, then hit OKAY.</small>}
    <div className="picker-actions"><button className="mf-button ghost" onClick={()=>setShow(false)}>SKIP</button><button className="mf-button" onClick={()=>location.reload()}>OKAY</button></div>
  </div></div>,document.body) }

function Login({ onAuthed }) {
  const [mode, setMode] = useState('login'); const [form,setForm]=useState({username:'',password:'',inviteCode:''}); const [error,setError]=useState(''); const [busy,setBusy]=useState(false);
  async function submit(e){ e.preventDefault(); setBusy(true); setError(''); try { const user = await backend[mode](form); onAuthed(user); } catch(err){ setError(err.message); } finally{ setBusy(false); }}
  return <main className="login-shell"><section className="auth-card mf-frame"><img className="login-logo" src={asset('bust-logo.png')} alt="BUST"/><p className="auth-copy">A real-time satirical pressure logging terminal for a trusted crew.</p><form onSubmit={submit}><label>Username<input value={form.username} onChange={e=>setForm({...form,username:e.target.value})} autoFocus /></label><label>Password<input type="password" value={form.password} onChange={e=>setForm({...form,password:e.target.value})} /></label>{mode==='signup'&&<label>invite-code<input value={form.inviteCode} onChange={e=>setForm({...form,inviteCode:e.target.value})} /></label>}<button className="mf-button" disabled={busy}>{busy?'TRANSMITTING…':mode==='login'?'ENTER BAY':'CREATE OPERATOR'}</button></form>{error&&<div className="error">{error}</div>}<button className="text-link" onClick={()=>setMode(mode==='login'?'signup':'login')}>{mode==='login'?'Need access? Register with invite-code.':'Already cleared? Login.'}</button></section></main>
}

function App(){ const [user,setUser]=useState(null); const [boot,setBoot]=useState(true); useEffect(()=>{backend.me().then(setUser).catch(()=>{}).finally(()=>setBoot(false))},[]); if(boot) return <div className="boot">UNPACKING BUST BAY…</div>; return user?<Dashboard user={user} setUser={setUser}/>:<Login onAuthed={setUser}/> }

function Dashboard({user,setUser}){ const [busts,setBusts]=useState([]),[users,setUsers]=useState([]),[unlocks,setUnlocks]=useState([]); const [overlay,setOverlay]=useState(null),[selected,setSelected]=useState(null),[phase,setPhase]=useState('idle'),[note,setNote]=useState(''),[pendingCtx,setPendingCtx]=useState(null),[toasts,setToasts]=useState([]),[unread,setUnread]=useState(0),[badgeToast,setBadgeToast]=useState(null),[muted,setMuted]=useState(sfx.isMuted()); const bustRef=useRef([]); bustRef.current=busts; const chargeSfx=useRef(null); const [,tick]=useState(0);
  const remaining = twoHoursRemainingMs(user.last_bust_timestamp); const locked = remaining > 0 && phase==='idle';
  useEffect(()=>{ if(remaining>0){ const t=setTimeout(()=>tick(x=>x+1), remaining+300); return()=>clearTimeout(t); } },[remaining]);
  async function refresh(){ const d=await backend.dashboard(); setBusts(d.busts); setUsers(d.users); setUnlocks(d.achievements); }
  useEffect(()=>{ refresh().catch(console.error); const unsub=backend.subscribe({
      onBust: bust=>{ setBusts(prev=>[bust,...prev.filter(b=>b.id!==bust.id)]); setUsers(prev=>prev.map(u=>u.id===bust.user_id?{...u,last_bust_timestamp:bust.timestamp}:u)); if(bust.user_id!==user.id){ setUnread(n=>n+1); setToasts(t=>[{id:crypto.randomUUID(),bust},...t]); if(Notification?.permission==='granted') new Notification(`${bust.username} logged a BUST`, { body: bust.note || 'Pressure event received.' }); } },
      onProfile: p=>{ setUsers(prev=>prev.map(u=>u.id===p.id?{...u,...p}:u)); }
    }); return unsub; },[]);
  useEffect(()=>{ if(locked&&!muted){ const h=sfx.play('drip',{loop:true,volume:.22}); const t=setTimeout(()=>h.stop(),60000); return()=>{ clearTimeout(t); h.stop(); }; } },[locked,muted]);
  async function collectContext(){ let lat=null,long=null,temp_f=null,pressure=null,city=null; try{ const cached=JSON.parse(localStorage.getItem('bust_geo')||'null'); const pos=cached && Date.now()-cached.at<86400000 ? cached : await new Promise((res,rej)=>navigator.geolocation.getCurrentPosition(p=>res({lat:p.coords.latitude,long:p.coords.longitude,at:Date.now()}),rej,{timeout:6000})); localStorage.setItem('bust_geo',JSON.stringify(pos)); lat=pos.lat; long=pos.long; const w=await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${long}&current=temperature_2m,surface_pressure&temperature_unit=fahrenheit`).then(r=>r.json()); temp_f=w.current?.temperature_2m ?? null; pressure=w.current?.surface_pressure ?? null; try{ const g=await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${long}&localityLanguage=en`).then(r=>r.json()); city=g.city||g.locality||g.principalSubdivision||null; }catch{} }catch{} return {lat,long,temp_f,pressure,city}; }
  async function startBust(){ if(locked || phase!=='idle') return; navigator.vibrate?.([35,45,70,65,100]); setPhase('charge'); chargeSfx.current=sfx.play('charge',{loop:true,volume:.75}); setPendingCtx(await collectContext()); setTimeout(()=>{navigator.vibrate?.([180,60,220,80,300]); chargeSfx.current?.stop(); sfx.play('explosion',{volume:.9}); setPhase('explode');},1400); setTimeout(()=>setPhase('note'),5900); }
  async function commitBust(finalNote){ const noteText=typeof finalNote==='string'?finalNote:note; try{ const bust=await backend.bust({note:noteText,...pendingCtx}); const current=[bust,...bustRef.current]; setBusts(prev=>[bust,...prev.filter(b=>b.id!==bust.id)]); const newOnes=capUnlocksPerBust(computeAchievementUnlocks(bust.user_id,current,unlocks,{createdAt:user.created_at,userCount:users.length})); if(newOnes.length){ const saved=await backend.saveAchievements(newOnes); setUnlocks(saved); const featured=achievements.find(a=>a.id===newOnes[0]); setBadgeToast(featured); sfx.play('badge',{volume:.85}); setTimeout(()=>setBadgeToast(null),5200); }
      setUser({...user,last_bust_timestamp:bust.timestamp}); setSelected(bust); }catch(e){ alert(e.message); }
    setNote(''); setPendingCtx(null); setPhase('idle'); }
  SHOWCASE_MAP=Object.fromEntries(users.map(u=>[u.id,(u.showcase||'').split(',').filter(Boolean).slice(0,3)]));
  const analytics=useMemo(()=>buildAnalytics(busts,users,user),[busts,users,user]);
  return <main className={`dash ${locked?'cooldown-mode':''} ${phase==='charge'?'charging':''} ${phase==='explode'?'detonating':''}`}><GridBg/><PermissionGate/>{locked&&<CooldownGoop/>}<header className="top-bar"><button className="profile-chip" onClick={()=>setOverlay('profile')}><img src={avatar(user.avatar_seed)}/><span>{user.username}</span></button><img className="brand-mark" src={asset('bust-logo.png')} alt="" aria-hidden="true"/><div className="top-actions"><button className="icon-btn" title={muted?'Unmute SFX':'Mute SFX'} onClick={()=>setMuted(sfx.toggleMuted())}>{muted?<VolumeX/>:<Volume2/>}</button><button className="icon-btn" onClick={()=>{setOverlay('alerts');setUnread(0)}}><Bell/>{unread>0&&<b>{unread}</b>}</button><button className="icon-btn trophy-action" onClick={()=>setOverlay('trophy')}><Trophy/><small>{new Set(unlocks.filter(a=>a.user_id===user.id).map(a=>a.achievement_type)).size}</small></button></div></header><section className="button-stage">{locked?<CooldownScene/>:<BustButton phase={phase} onClick={startBust}/>}</section><button className="drawer-handle" onClick={()=>setOverlay('analytics')}><ChevronUp/> ANALYTICS BAY</button><Toasts toasts={toasts} setToasts={setToasts} onOpen={setSelected}/><AnimatePresence>{badgeToast&&<BadgeToast key="badge-toast" badge={badgeToast}/>} {phase==='note'&&<NoteModal key="note-modal" note={note} setNote={setNote} onCommit={commitBust}/>} {overlay&&<Overlay key={`overlay-${overlay}`} title={overlayTitle(overlay)} onClose={()=>setOverlay(null)}>{overlay==='profile'&&<Profile user={user} setUser={setUser} busts={busts} unlocks={unlocks} users={users} onOpen={setSelected}/>} {overlay==='alerts'&&<Alerts busts={busts} onOpen={setSelected}/>} {overlay==='analytics'&&<Analytics data={analytics} busts={busts} onOpen={setSelected}/>} {overlay==='trophy'&&<TrophyCabinet unlocks={unlocks} user={user}/>}</Overlay>} {selected&&<Detail key={`detail-${selected.id}`} bust={selected} all={busts} onClose={()=>setSelected(null)}/>}</AnimatePresence>{phase==='explode'&&<Explosion/>}</main> }
function GridBg(){ return <div className="grid-bg"/> }
function BustButton({phase,onClick}){ return <motion.button className="bust-button" disabled={phase!=='idle'} onClick={onClick} animate={phase==='charge'?{scale:[1,1.07,.96,1.09,1],rotate:[0,-3,3,-5,5,0]}:{}} transition={{duration:.18,repeat:phase==='charge'?Infinity:0}}><span>{phase==='charge'?'Edging…':'BUST'}</span><em>{phase==='idle'?'PRESSURE RELEASE CONTROL':'CHAMBER CRITICAL'}</em>{phase==='charge'&&<><i/><i/><i/><i/></>}</motion.button> }
function Explosion(){ const drops=Array.from({length:110}); const ropes=Array.from({length:18}); const shards=Array.from({length:30}); return <div className="explosion"><div className="blast-flash"/>{ropes.map((_,i)=><b className="goop-rope" key={`r${i}`} style={{'--l':`${Math.random()*100}%`,'--w':`${22+Math.random()*80}px`,'--h':`${38+Math.random()*70}vh`,'--d':`${Math.random()*.55}s`}}/>)}{drops.map((_,i)=><span className="milk-drop" key={`d${i}`} style={{'--x':`${Math.random()*150-75}vw`,'--y':`${Math.random()*120-60}vh`,'--s':`${7+Math.random()*28}px`,'--d':`${Math.random()*1.1}s`}}/>)}{shards.map((_,i)=><i className="button-shard" key={`s${i}`} style={{'--x':`${Math.random()*120-60}vw`,'--y':`${Math.random()*100-50}vh`,'--r':`${Math.random()*900-450}deg`,'--d':`${Math.random()*.6}s`}}/>)}<div className="milk-sheet"/><div className="screen-splatter"/></div> }
function CooldownGoop(){ return <div className="cooldown-goop" aria-hidden="true"><span/><span/><span/><span/><span/><span/><span/><span/></div> }
function NoteModal({note,setNote,onCommit}){ return <motion.div className="note-pop mf-frame" initial={{opacity:0,scale:.9}} animate={{opacity:1,scale:1}} exit={{opacity:0}}><h2>CAPTURE BUST NOTE</h2><textarea value={note} maxLength={240} onChange={e=>setNote(e.target.value)} placeholder="Optional field report…"/><small className="note-count">{note.length}/240</small><div className="note-actions"><button className="mf-button ghost" onClick={()=>onCommit('')}>SKIP</button><button className="mf-button" onClick={()=>onCommit()}>COMMIT TO LEDGER</button></div></motion.div> }
function CooldownScene(){ return <div className="cooldown-scene" aria-label="BUST cooldown scene"><div className="iso"><div className="fallen">Busted</div></div></div> }
function BadgeIcon({name}){ return <MIcon name={matMap[name]||name||'shield'}/> }
function BadgeMedal({icon,accent,tier}){ const url=tier?tierUrl(tier):null; return <div className={`badge-medal${url?` tier-plated`:''}`} style={{'--badge':accent,...(url?{backgroundImage:`url(${url})`}:{})}}><BadgeIcon name={icon}/></div> }
function BadgeToast({badge}){ if(!badge) return null; return <motion.div className="badge-toast mf-frame" initial={{opacity:0,y:-22,scale:.92}} animate={{opacity:1,y:0,scale:1}} exit={{opacity:0,y:-22}}><BadgeMedal icon={badge.micon||badge.icon} accent={badge.accent} tier={badge.tier}/><div><span>ACHIEVEMENT UNLOCKED</span><h2>{badge.name}</h2><p>{badge.tier.toUpperCase()} · {badge.points} XP</p></div></motion.div> }
function Overlay({title,onClose,children}){ return <motion.section className="overlay" initial={{y:'100%'}} animate={{y:0}} exit={{y:'100%'}}><button className="close" onClick={onClose}><X/></button><div className="overlay-head"><h1>{title}</h1></div>{children}</motion.section> }
function Detail({bust,all,onClose}){ return <motion.div className="detail-back" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}}><div className="detail mf-frame"><button className="detail-close" onClick={onClose} aria-label="Close detail"><X/></button><img src={avatar(bust.avatar_seed)}/><h2>{bust.username}<NameBadges userId={bust.user_id}/></h2><p>{fmt(bust.timestamp)} · {bust.time_bucket}</p>{bust.note?<blockquote>{bust.note}</blockquote>:null}<div className="metric-grid"><Metric icon={<Thermometer/>} label="TEMP" value={bust.temp_f?`${Math.round(bust.temp_f)}°F`:'—'}/><Metric icon={<Gauge/>} label="PRESSURE" value={pressureLabel(bust.pressure)||'—'} sub={bust.pressure?`${Math.round(bust.pressure)} hPa`:null}/><Metric icon={<MapPin/>} label="LOCATION" value={bust.city||'Unknown'}/><Metric icon={<Medal/>} label="DAY RANK" value={`#${rankForDay(bust,all)}`}/></div></div></motion.div> }
function Metric({icon,label,value,sub}){return <div className="metric">{icon}<small>{label}</small><strong>{value}</strong>{sub&&<em className="metric-sub">{sub}</em>}</div>}
/** Location + notification permission re-request controls (profile). Browsers only re-prompt when state is 'prompt'; DENIED requires the browser's site settings. */
function PermissionControls(){
  const [notif,setNotif]=useState(typeof Notification!=='undefined'?Notification.permission:'unsupported');
  const [geo,setGeo]=useState('unknown');
  useEffect(()=>{ navigator.permissions?.query({name:'geolocation'}).then(r=>{ setGeo(r.state); r.onchange=()=>setGeo(r.state); }).catch(()=>{}); },[]);
  async function askNotif(){ if(typeof Notification==='undefined'){ setNotif('unsupported'); return; } try{ setNotif(await Notification.requestPermission()); }catch{ setNotif('denied'); } }
  function askGeo(){ if(!navigator.geolocation){ setGeo('unsupported'); return; } localStorage.removeItem('bust_geo'); navigator.geolocation.getCurrentPosition(
    p=>{ localStorage.setItem('bust_geo',JSON.stringify({lat:p.coords.latitude,long:p.coords.longitude,at:Date.now()})); setGeo('granted'); },
    ()=>setGeo('denied'),{timeout:8000}); }
  const label=v=>({granted:'ON',denied:'BLOCKED',prompt:'ASK',default:'ASK',unknown:'ASK',unsupported:'N/A'}[v]||v);
  return <div className="perm-row">
    <span className="perm-title">DEVICE PERMISSIONS</span>
    <div>
      <button type="button" className="mf-button ghost" onClick={askGeo}><MapPin/> LOCATION · {label(geo)}</button>
      <button type="button" className="mf-button ghost" onClick={askNotif}><Bell/> NOTIFICATIONS · {label(notif)}</button>
    </div>
    {(geo==='denied'||notif==='denied')&&<small>A blocked permission can only be re-enabled from your browser's site settings (padlock icon in the address bar).</small>}
  </div> }
function Profile({user,setUser,busts,unlocks,users,onOpen}){
  const [tagline,setTagline]=useState(user.tagline||''); const [saving,setSaving]=useState(false); const [saved,setSaved]=useState(false); const [showPicker,setShowPicker]=useState(false); const [confirmDel,setConfirmDel]=useState(false);
  const stats=useMemo(()=>derivePersonalStats(user.id,busts,unlocks),[user.id,busts,unlocks]);
  const own=useMemo(()=>busts.filter(b=>b.user_id===user.id),[busts,user.id]);
  const trend=useMemo(()=>buildTrend(own,30),[own]);
  const rank=useMemo(()=>{const counts=users.map(u=>({id:u.id,count:busts.filter(b=>b.user_id===u.id).length})).sort((a,b)=>b.count-a.count);const i=counts.findIndex(c=>c.id===user.id);return i>=0&&counts[i].count>0?i+1:null;},[users,busts,user.id]);
  const myBadges=unlocks.filter(a=>a.user_id===user.id).map(a=>achievements.find(x=>x.id===a.achievement_type)).filter(Boolean).sort((a,b)=>b.points-a.points);
  const pinned=(user.showcase||'').split(',').filter(Boolean);
  async function save(patch){ setSaving(true); try{ const u=await backend.patchProfile(patch); setUser({...user,...u}); setSaved(true); setTimeout(()=>setSaved(false),1800);}catch(e){alert(e.message);}finally{setSaving(false);} }
  const lvl=stats.level;
  return <div className="profile-page">
    <section className="profile-hero mf-frame">
      <div className="profile-id">
        <div className="avatar-stack"><img src={avatar(user.avatar_seed)}/><button className="reroll" title="Re-roll avatar" onClick={()=>save({avatar_seed:`${user.username}-${Date.now()}`})} disabled={saving}><Repeat2/></button></div>
        <div>
          <span className="mf-kicker">LVL {lvl.level} · {lvl.title.toUpperCase()}</span>
          <h2>{user.username}<NameBadges userId={user.id}/></h2>
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
    <div className="feed two-col">{own.length?own.slice(0,10).map(b=><BustCard key={b.id} b={b} onOpen={onOpen}/>):<EmptyState text="Your ledger is empty. The button awaits."/>}</div>
    <div className="logout-row"><button className="mf-button ghost" onClick={async()=>{await backend.logout();setUser(null)}}><LogOut/> LOG OUT</button><button className="mf-button ghost danger" onClick={()=>setConfirmDel(true)}>DELETE ACCOUNT</button></div>
    {confirmDel&&<DeleteAccountModal onClose={()=>setConfirmDel(false)} onDeleted={()=>setUser(null)}/>}
  </div> }
function Alerts({busts,onOpen}){ return <div className="feed two-col">{busts.map(b=><BustCard key={b.id} b={b} onOpen={onOpen}/>)}</div> }
function BustCard({b,onOpen}){ return <button className="bust-card mf-frame" onClick={()=>onOpen(b)}><img src={avatar(b.avatar_seed)}/><div><strong>{b.username}<NameBadges userId={b.user_id}/></strong><span>{fmt(b.timestamp)} · {b.time_bucket}</span><p>{b.note || 'Pressure spike recorded.'}</p></div></button> }
function Analytics({data,busts,onOpen}){ const today=busts.filter(b=>todayKey(b.timestamp)===todayKey()); return <div className="analytics"><div className="stat-strip">{data.stats.map(s=><div className="stat mf-frame" key={s.label}><span>{s.label}</span><strong>{s.value}</strong><small>{s.hint}</small></div>)}</div><section className="analytics-grid"><div className="mf-frame module leaderboard-module"><h2>Leaderboard</h2><p>Ranked avatar tiles with satirical titles and all-time volume.</p>{data.leaderboard.length?data.leaderboard.map((u,i)=><div className="leader" key={u.id}><span>#{i+1}</span><img src={avatar(u.avatar_seed)}/><b>{u.username}<NameBadges userId={u.id}/>{u.streak>1&&<i className="streak-pill" title="current daily streak">{u.streak}d 🔥</i>}</b><Sparkline data={u.spark}/><em>{u.count} // {['Cream of the Crop','Daily Dripper','Pressure Adept','Puddle Scout'][i]||'Bay Operator'}{u.tagline?` · “${u.tagline}”`:''}</em></div>):<EmptyState text="No operators have logged yet."/>}</div><div className="mf-frame module"><h2>30-Day Trend</h2><p>Group volume, rolling month.</p><TrendChart data={data.trend}/></div><div className="mf-frame module"><h2>Daypart Share</h2><p>Which windows carry the group.</p>{Object.keys(data.buckets).length?<DonutChart data={Object.entries(data.buckets).map(([label,value])=>({label,value}))}/>:<EmptyState text="Awaiting events."/>}</div><div className="mf-frame module"><h2>Hour Histogram</h2><p>Raw hour-of-day distribution.</p><HourHistogram counts={data.hourHist}/></div><div className="mf-frame module chart-module"><h2>Weekly Volume</h2><p>Day-over-day ledger intensity.</p><div className="bars">{data.week.map(d=><div key={d.label}><i style={{height:`${Math.max(8,d.count*22)}px`}}/><strong>{d.count}</strong><span>{d.label}</span></div>)}</div></div><div className="mf-frame module chart-module"><h2>Heatmap</h2><p>24-hour activity by day of week.</p><div className="heat-wrap"><div className="heat-axis">{['S','M','T','W','T','F','S'].map((d,i)=><b key={i}>{d}</b>)}</div><div className="heat">{data.heat.map((v,i)=><span key={i} style={{opacity:.12+Math.min(v,5)*.18}} title={`${v} events`}/>)}</div></div></div><div className="mf-frame module chart-module"><h2>Environment Scatter</h2><p>Temperature versus barometric pressure.</p>{data.scatterPts.length?<ScatterChart points={data.scatterPts}/>:<EmptyState text="Awaiting environment data."/>}</div></section><section className="records-grid">{data.records.map(r=><div className="record-card mf-frame" key={r.id}><BadgeIcon name={r.icon}/><span>{r.label}</span><strong>{r.value}</strong><p>{r.detail}</p></div>)}</section><h2 className="section-title">Today’s Feed</h2><div className="feed two-col">{today.length?today.map(b=><BustCard key={b.id} b={b} onOpen={onOpen}/>):<EmptyState text="No busts in the current 24-hour window."/>}</div></div> }
function TrophyCabinet({unlocks,user}){
  const [detail,setDetail]=useState(null);
  const set=new Set(unlocks.filter(a=>a.user_id===user.id).map(a=>a.achievement_type));
  const catalog=[...progressionCatalog.flatMap(t=>t.stages),...expansionItems];
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
    <AnimatePresence>{detail&&<AchDetail key="ach-detail" item={detail} unlocked={set.has(detail.id)} onClose={()=>setDetail(null)}/>}</AnimatePresence>
  </div> }
function EmptyState({text}){ return <div className="empty-state"><Sparkles/><span>{text}</span></div> }
function Toasts({toasts,setToasts,onOpen}){ return <div className="toasts">{toasts.map(t=><div className="toast mf-frame" key={t.id} onClick={()=>onOpen(t.bust)}><button onClick={(e)=>{e.stopPropagation();setToasts(x=>x.filter(y=>y.id!==t.id))}}>×</button><b>{t.bust.username} BUSTED</b><span>{t.bust.note||'Open detail card.'}</span></div>)}</div> }
function overlayTitle(o){return {profile:'OPERATOR PROFILE',alerts:'ALERT FEED',analytics:'ANALYTICS DRAWER',trophy:'TROPHY CABINET'}[o]}
function buildAnalytics(busts,users,user){ const counts=users.map(u=>({...u,count:busts.filter(b=>b.user_id===u.id).length})).sort((a,b)=>b.count-a.count); const today=busts.filter(b=>todayKey(b.timestamp)===todayKey()).length; const rank=counts.findIndex(u=>u.id===user.id)+1; const stats=[{label:'GROUP BUSTS',value:busts.length,hint:'all-time ledger'},{label:'ACTIVE PLAYERS',value:users.length,hint:'registered operators'},{label:'TODAY',value:today,hint:'current local day'},{label:'YOUR RANK',value:rank>0?'#'+rank:'—',hint:'daily pressure index'}]; const week=Array.from({length:7}).map((_,i)=>{const d=new Date();d.setDate(d.getDate()-(6-i));return {label:d.toLocaleDateString([],{weekday:'short'}),count:busts.filter(b=>new Date(b.timestamp).toDateString()===d.toDateString()).length}}); const heat=Array.from({length:24*7},(_,i)=>busts.filter(b=>new Date(b.timestamp).getDay()*24+new Date(b.timestamp).getHours()===i).length); const temps=busts.filter(b=>b.temp_f&&b.pressure); const scatterPts=temps.map(b=>({x:Number(b.temp_f),y:Number(b.pressure),label:`${b.username||'?'} — ${Math.round(b.temp_f)}°F, ${Math.round(b.pressure)} hPa`})); const records=deriveAllTimeRecords(busts);
 const trend=buildTrend(busts,30);
 const buckets={}; busts.forEach(b=>{const k=b.time_bucket||timeBucket(b.timestamp);buckets[k]=(buckets[k]||0)+1;});
 const hourHist=Array.from({length:24},(_,h)=>busts.filter(b=>new Date(b.timestamp).getHours()===h).length);
 const leaderboard=counts.map(u=>{const own=busts.filter(b=>b.user_id===u.id);return {...u,spark:buildTrend(own,14).map(d=>d.count),streak:deriveStreaks(own).current};});
 return {stats,leaderboard,week,heat,scatterPts,records,trend,buckets,hourHist}; }
// Material Symbols renders its ligature NAMES as plain text until the font is ready —
// the font is bundled locally (material-symbols package), so this resolves almost instantly.
// If it somehow fails, icons stay hidden rather than ever showing raw codes like "ac_unit".
(async () => {
  for (let i = 0; i < 5; i++) {
    try {
      await document.fonts.load('24px "Material Symbols Outlined"');
      if (document.fonts.check('24px "Material Symbols Outlined"')) { document.documentElement.classList.add('msym-ready'); return; }
    } catch { /* retry */ }
    await new Promise(r => setTimeout(r, 1200));
  }
  document.documentElement.classList.add('msym-failed');
})();
createRoot(document.getElementById('root')).render(<App/>);
