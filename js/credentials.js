// ── CREDENTIALS & PROVIDER SELECTION ───────────────────────────────────────
// Opt-in "remember API key" persistence + the splash provider picker.
// Keys live in storage under `hp_creds` as {groq, gemini, anthropic, openai, last}.
import { R } from './state.js';
import { kvGet, kvSet } from './storage.js';
import { updProviderBadge } from './chat.js';

export const KEY_INPUT_ID={anthropic:'apiKeyInput',gemini:'geminiKeyInput',groq:'groqKeyInput',openai:'openaiKeyInput'};

async function loadCreds(){
  try{const str=await kvGet('hp_creds');if(str)return JSON.parse(str);}catch(e){}
  return null;
}
async function writeCreds(creds){await kvSet('hp_creds',JSON.stringify(creds));}

export async function saveCreds(provider,key){
  const creds=(await loadCreds())||{};
  creds[provider]=key;creds.last=provider;
  R.cachedCreds=creds;
  await writeCreds(creds);
}

// Per-provider clear (no reload — used from splash auth management).
export async function removeCreds(provider){
  const creds=(await loadCreds())||{};
  delete creds[provider];
  R.cachedCreds=creds;
  if(!R.cachedCreds.last||R.cachedCreds.last===provider){
    const pks=Object.keys(creds).filter(k=>k!=='last');
    R.cachedCreds.last=pks.length?pks[0]:'groq';
    creds.last=R.cachedCreds.last;
  }
  await writeCreds(creds);
}

// Full logout (reload). Kept for settings "Cerrar sesión" behaviour.
export async function clearCreds(provider){
  const creds=(await loadCreds())||{};
  delete creds[provider];creds.last=provider;
  R.cachedCreds=creds;
  await writeCreds(creds);
}

// Show/hide the saved-key indicator for a given provider.
export function savedKeyIndicator(p){
  const savedEl=document.getElementById(p+'KeySaved');
  const inputEl=document.getElementById(KEY_INPUT_ID[p]);
  const hasKey=!!(R.keys[p]||(R.cachedCreds&&R.cachedCreds[p]));
  if(savedEl)savedEl.style.display=hasKey?'block':'none';
  if(inputEl){
    inputEl.style.display=hasKey?'none':'';
    if(hasKey){
      const v=R.keys[p]||(R.cachedCreds&&R.cachedCreds[p]);
      if(v)inputEl.value=v;
    }
  }
}

export function setProvider(p){
  R.provider=p;
  ['groq','openai','anthropic','gemini'].forEach(k=>{
    const btn=document.getElementById('pvd_'+k);
    if(btn){
      btn.style.background=p===k?'var(--bg3)':'var(--bg2)';
      btn.style.color=p===k?'var(--gold)':'var(--mt)';
    }
    const div=document.getElementById('keyInput'+k[0].toUpperCase()+k.slice(1));
    if(div)div.style.display=p===k?'block':'none';
  });
  savedKeyIndicator(p);
  const rk=document.getElementById('rememberKey');
  if(rk)rk.checked=!!(R.cachedCreds&&R.cachedCreds[p]);
  updProviderBadge();
}

// Show the input field for editing a saved key.
export function splashEditKey(p){
  const savedEl=document.getElementById(p+'KeySaved');
  const inputEl=document.getElementById(KEY_INPUT_ID[p]);
  if(savedEl)savedEl.style.display='none';
  if(inputEl){
    inputEl.style.display='';
    inputEl.focus();
  }
}

// Remove a single provider's key without reloading.
export async function splashDeleteKey(p){
  delete R.keys[p];
  await removeCreds(p);
  savedKeyIndicator(p);
  // If this was the current provider, pick next saved one.
  if(R.provider===p){
    const hasKeys=Object.keys(R.keys).filter(k=>R.keys[k]);
    if(hasKeys.length){
      R.provider=hasKeys[0];
      setProvider(R.provider);
    }
  }
}

// Loads saved creds, primes the splash UI, and returns true if there is a
// usable saved key for the last-used provider (caller decides to auto-login).
export async function prefillCreds(){
  R.cachedCreds=(await loadCreds())||{};
  const provider=(KEY_INPUT_ID[R.cachedCreds.last]&&R.cachedCreds[R.cachedCreds.last])?R.cachedCreds.last:'groq';
  setProvider(provider);
  ['groq','openai','anthropic','gemini'].forEach(p=>{
    if(R.cachedCreds[p]){
      const el=document.getElementById(KEY_INPUT_ID[p]);
      if(el)el.value=R.cachedCreds[p];
    }
    savedKeyIndicator(p);
  });
  return !!(R.cachedCreds.last&&R.cachedCreds[R.cachedCreds.last]);
}
