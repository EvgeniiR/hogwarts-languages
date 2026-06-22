// ── HELPERS ────────────────────────────────────────────────────────────────
// Pure, dependency-free utilities used across modules.
import lang from './lang.js';

export function esc(s){
  if(!s)return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/\n/g,'<br>');
}

export function aResize(el){
  el.style.height='auto';
  el.style.height=Math.min(el.scrollHeight,72)+'px';
}

export function showToast(msg,bg,col){
  const t=document.createElement('div');
  t.className='toast';t.style.background=bg||'#c9a84c';t.style.color=col||'#1e0c04';t.textContent=msg;
  document.getElementById('app').appendChild(t);setTimeout(()=>t.remove(),3000);
}

export function friendlyError(err){
  const msg=((err&&err.message)||'').toLowerCase();
  const status=err&&err.status;
  if(status===429||msg.includes('resource_exhausted')||msg.includes('rate limit')||msg.includes('quota'))
    return lang.ui.errRateLimit;
  if(status===401||status===403||msg.includes('api key')||msg.includes('unauthorized')||msg.includes('permission denied'))
    return lang.ui.errApiKey;
  if(err instanceof TypeError||msg.includes('failed to fetch')||msg.includes('network'))
    return lang.ui.errNetwork;
  return lang.ui.errGeneric;
}

export function normWords(s){
  return (s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[.,!?¿¡;:"']/g,'').trim().split(/\s+/).filter(Boolean);
}

export function shuffleArray(arr){
  const a=[...arr];
  for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}
  return a;
}

export function extractJSON(raw){
  const s=raw.replace(/```json|```/g,'').trim();
  const clean=s.replace(/,(\s*[}\]])/g,'$1');
  const oStart=clean.indexOf('{'),oEnd=clean.lastIndexOf('}');
  const aStart=clean.indexOf('['),aEnd=clean.lastIndexOf(']');
  const hasObj=oStart!==-1&&oEnd>oStart;
  const hasArr=aStart!==-1&&aEnd>aStart;
  if(hasArr&&(!hasObj||aStart<oStart))return JSON.parse(clean.slice(aStart,aEnd+1));
  if(hasObj)return JSON.parse(clean.slice(oStart,oEnd+1));
  throw new Error('no JSON found in response');
}

export function mdInline(escaped){
  return escaped
    .replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*(?!\*)/g,'$1<em>$2</em>');
}

export function weekStart(ts){
  const d=new Date(ts);d.setHours(0,0,0,0);
  const day=(d.getDay()+6)%7;
  d.setDate(d.getDate()-day);
  return d.getTime();
}
