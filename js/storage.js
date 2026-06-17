// ── STORAGE ────────────────────────────────────────────────────────────────
// Single abstraction over localStorage and the artifact `window.storage` API.
// `window.storage` is checked first so the app still works inside a Claude.ai
// artifact (where localStorage is blocked). Keep this the only place that
// touches either backend.

export async function kvGet(key){
  try{
    if(window.storage){const r=await window.storage.get(key);return r?.value;}
    return localStorage.getItem(key);
  }catch(e){return null;}
}

export async function kvSet(key,val){
  try{
    if(window.storage)await window.storage.set(key,val);
    else localStorage.setItem(key,val);
  }catch(e){}
}
