// ── PROGRESS ───────────────────────────────────────────────────────────────
// Points (weekly cap + lifetime), daily/weekly resets and streak, CEFR level
// progression, and achievements (counters + HP lifetime-points milestones).
import { S, saveS } from './state.js';
import { LEVELS } from './characters.js';
import { showToast } from './helpers.js';

// ── Points ───────────────────────────────────────────────────────────────
function showPtsFloat(n){
  const bar=document.getElementById('hgF');
  if(bar&&window.innerWidth>600){
    const el=document.createElement('div');
    el.className='pts-float';el.textContent='+'+n;
    bar.parentElement.parentElement.appendChild(el);
    setTimeout(()=>el.remove(),1200);
  }else{
    const dn=document.getElementById('dailyGoalNum');
    if(dn){dn.classList.remove('pts-flash');void dn.offsetWidth;dn.classList.add('pts-flash');setTimeout(()=>dn.classList.remove('pts-flash'),700);}
  }
}
function _countStreakToday(){
  const today=new Date().toISOString().slice(0,10);
  if(S.streak.lastDate===today)return;
  const yesterday=new Date(Date.now()-86400000).toISOString().slice(0,10);
  if(!S.streak.lastDate||S.streak.lastDate===yesterday){
    S.streak.count=(S.streak.count||0)+1;
  } else {
    S.streak.count=1;
  }
  S.streak.lastDate=today;
  updStreakUI();
  saveS();
}
export function awardPoints(n){
  S.weeklyPts=Math.max(0,Math.min(200,S.weeklyPts+n));
  if(n>0){
    S.lifetimePts=(S.lifetimePts||0)+n;
    const prev=S.dailyEarned;
    S.dailyEarned+=n;
    showPtsFloat(n);
    if(prev<50&&S.dailyEarned>=50)_countStreakToday();
  }
  updPtsUI();checkAchievements();checkLifetimeMilestones();
}
export function updPtsUI(){
  document.getElementById('hgF').style.width=Math.min(100,S.weeklyPts/2)+'%';
  document.getElementById('weeklyPtsLabel').textContent=S.weeklyPts+' / 200';
  const ds=document.getElementById('dailyGoalStar');
  const dn=document.getElementById('dailyGoalNum');
  if(ds&&dn){
    const done=S.dailyEarned>=50;
    ds.classList.toggle('goal-done',done);
    dn.textContent=done?'✓':S.dailyEarned+'/50';
    dn.classList.toggle('goal-done',done);
  }
}
export function updStreakUI(){
  const n=S.streak.count||0;
  document.getElementById('streakN').textContent=n;
  document.querySelector('.streak-d').style.display=n>0?'':'none';
}

// ── Date changes: daily streak + weekly points reset ────────────────────────
function getISOWeek(d){
  const t=new Date(Date.UTC(d.getFullYear(),d.getMonth(),d.getDate()));
  const day=t.getUTCDay()||7;t.setUTCDate(t.getUTCDate()+4-day);
  const yr=t.getUTCFullYear();
  const start=new Date(Date.UTC(yr,0,1));
  return `${yr}-W${String(Math.ceil((((t-start)/86400000)+1)/7)).padStart(2,'0')}`;
}
export function processDateChanges(){
  const now=new Date();
  const today=now.toISOString().slice(0,10);
  const week=getISOWeek(now);
  if(!S.lastActiveDate){S.lastActiveDate=today;S.currentWeek=week;checkAchievements();return;}
  if(S.lastActiveDate!==today){
    const diff=Math.round((new Date(today)-new Date(S.lastActiveDate))/86400000);
    if(diff>1){
      S.streak.count=0;
    } else if(S.streak.lastDate!==S.lastActiveDate){
      // yesterday not yet counted (user never hit 50 pts that session)
      const qualified=S.dailyEarned>=50;
      S.streak.count=qualified?(S.streak.count||0)+1:0;
      if(qualified)S.streak.lastDate=S.lastActiveDate;
    }
    // else: streak.lastDate===lastActiveDate — already counted by _countStreakToday
    S.dailyEarned=0;
    S.lastActiveDate=today;
    updStreakUI();
  }
  if(!S.currentWeek)S.currentWeek=week;
  if(S.currentWeek!==week){
    S.weeklyPts=0;S.currentWeek=week;
    showToast('🗓 ¡Nueva semana! Puntos semanales reiniciados. ¡Tú puedes!','#1a2a50','#6090e0');
    updPtsUI();
  }
  checkAchievements();
}

// ── Achievements ────────────────────────────────────────────────────────────
export const ACH_LABELS={
  streak:{icon:'🔥',name:'días de racha',name1:'día de racha'},
  msgs:{icon:'💬',name:'mensajes enviados',name1:'mensaje enviado'},
  vocab:{icon:'📖',name:'palabras aprendidas',name1:'palabra aprendida'},
  challenges:{icon:'⭐',name:'desafíos completados',name1:'desafío completado'},
  reading:{icon:'📰',name:'artículos leídos',name1:'artículo leído'},
};
export const ACH_X={streak:10,vocab:10,challenges:10,msgs:100,reading:10};
export const HP_MILESTONES=[
  {pts:500,  key:'hp_firstYear',icon:'🎓',label:'Estudiante de Primer Año'},
  {pts:1000, key:'hp_quidditch',icon:'🏆',label:'Copa de Quidditch'},
  {pts:5000, key:'hp_merlin',  icon:'⚗', label:'Orden de Merlín, Tercera Clase'},
  {pts:10000,key:'hp_champion',icon:'⚡',label:'Campeón de Hogwarts'},
];
export function checkLifetimeMilestones(){
  const lp=S.lifetimePts||0;
  HP_MILESTONES.forEach(m=>{
    if(!S.achievements[m.key]&&lp>=m.pts){
      S.achievements[m.key]=true;
      showToast(`🏆 ¡Logro desbloqueado! ${m.icon} ${m.label}`,'#5a0000','#f5e5c0');
      saveS();
    }
  });
}
export function nextMilestone(n,X){
  if(n<X){
    let v=1;
    while(v<=n)v*=2;
    return v<X?v:X;
  }
  return (Math.floor(n/X)+1)*X;
}
export function achievementMetrics(){
  return{
    streak:S.streak.count,
    msgs:S.totalMsgs,
    vocab:S.vocab.length,
    challenges:S.challengesCompleted||0,
    reading:S.readingCompleted||0,
    pts:S.lifetimePts||0
  };
}
export function checkAchievements(){
  const metrics=achievementMetrics();
  let any=false;
  Object.keys(ACH_LABELS).forEach(k=>{
    let reached=S.achievements[k]||0;
    let next=nextMilestone(reached,ACH_X[k]);
    while(next<=metrics[k]){
      reached=next;next=nextMilestone(reached,ACH_X[k]);
      const {icon,name,name1}=ACH_LABELS[k];
      const label=reached===1?name1:name;
      showToast(`🏆 ¡Logro desbloqueado! ${icon} ${reached} ${label}`,'#5a3000','#f5e5c0');
      any=true;
    }
    S.achievements[k]=reached;
  });
  if(any)saveS();
}

// ── Level progression ───────────────────────────────────────────────────────
export function pushLevelOutcome(correct){
  S.levelWindow=S.levelWindow||[];
  S.levelWindow.push(correct);
  if(S.levelWindow.length>30)S.levelWindow=S.levelWindow.slice(-30);
}
function calcLevel(){
  const m=S.totalMsgs;
  const w=S.levelWindow||[];
  const correctRate=w.length?w.filter(Boolean).length/w.length:1;
  if(m>=40&&correctRate>=0.7)return 2;
  if(m>=15)return 1;
  return 0;
}
export function checkLevelUp(){
  const nl=calcLevel();
  if(nl>S.level){S.level=nl;document.getElementById('lvlBadge').textContent=LEVELS[nl];showToast('🎉 ¡Nivel '+LEVELS[nl]+' desbloqueado!','#c9a84c','#1e0c04');return true;}
  return false;
}
