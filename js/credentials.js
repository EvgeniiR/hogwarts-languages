// ── CREDENTIALS & PROVIDER SELECTION ───────────────────────────────────────
// Opt-in "remember API key" persistence + the splash provider picker.
// Keys live in storage under `hp_creds` as {groq, gemini, anthropic, openai, last}.
import { R } from './state.js';
import { kvGet, kvSet } from './storage.js';

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
export async function clearCreds(provider){
  const creds=(await loadCreds())||{};
  delete creds[provider];creds.last=provider;
  R.cachedCreds=creds;
  await writeCreds(creds);
}

export function setProvider(p){
  R.provider=p;
  ['anthropic','gemini','groq','openai'].forEach(k=>{
    document.getElementById('pvd_'+k).style.background=p===k?'var(--bg3)':'var(--bg2)';
    document.getElementById('pvd_'+k).style.color=p===k?'var(--gold)':'var(--mt)';
    document.getElementById('keyInput'+k[0].toUpperCase()+k.slice(1)).style.display=p===k?'block':'none';
  });
  document.getElementById('rememberKey').checked=!!(R.cachedCreds&&R.cachedCreds[p]);
}

// Loads saved creds, primes the splash UI, and returns true if there is a
// usable saved key for the last-used provider (caller decides to auto-login).
export async function prefillCreds(){
  R.cachedCreds=(await loadCreds())||{};
  const provider=(KEY_INPUT_ID[R.cachedCreds.last]&&R.cachedCreds[R.cachedCreds.last])?R.cachedCreds.last:'groq';
  setProvider(provider);
  ['anthropic','gemini','groq','openai'].forEach(p=>{
    if(R.cachedCreds[p])document.getElementById(KEY_INPUT_ID[p]).value=R.cachedCreds[p];
  });
  return !!(R.cachedCreds.last&&R.cachedCreds[R.cachedCreds.last]);
}
