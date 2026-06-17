// ── AUDIO ──────────────────────────────────────────────────────────────────
// Ambient music playlist (discovered from audio/manifest.json at runtime),
// a synth-drone fallback, and the short UI beeps. On/off state persists in
// S.musicOff. All audio internals are private to this module.
import { S, saveS } from './state.js';
import { shuffleArray } from './helpers.js';

// Hardcoded fallback list for when manifest.json can't be fetched (file://).
const AUDIO_FILES = [
  "audio/A Fool's Theme - Brian Bolger.mp3",
  "audio/Aaron Kenny - English Country Garden (Happy).mp3",
  "audio/Aaron Kenny - Happy Haunts (Happy).mp3",
  "audio/Aaron Kenny - The Curious Kitten (Bright).mp3",
  "audio/Cooper Cannell - Sprightly Pursuit (Bright).mp3",
  "audio/English Country Garden - Aaron Kenny.mp3",
  "audio/First Dream - Brian Bolger.mp3",
  "audio/Jesse's Carnival Waltz - The Great North Sound Society.mp3",
  "audio/Saving The World - Aaron Kenny.mp3",
  "audio/Sir Cubworth - Monster At The Door (Dark).mp3",
  "audio/Sir Cubworth - Murder Mystery (Dramatic).mp3",
  "audio/Sir Cubworth - Rolling Hills (Inspirational).mp3",
  "audio/Sir Cubworth - Waltz To Death (Dark).mp3",
  "audio/The Curious Kitten - Aaron Kenny.mp3",
  "audio/The Two Seasons - Dan Bodan.mp3",
];

let actx=null, audioOn=false, drone=null;
let ambientAudio=null, audioIdx=-1, validAudioFiles=[];

function setBtn(off){
  const b=document.getElementById('aBtn');
  if(b)b.innerHTML=off?'<i class="ti ti-volume-off"></i>':'<i class="ti ti-volume"></i>';
}
// Called synchronously on app entry so the icon matches saved state before
// any async audio probing runs.
export function syncAudioBtn(){if(S.musicOff)setBtn(true);}

export async function tryAudio(){
  try{actx=new(window.AudioContext||window.webkitAudioContext)();}catch(e){}
  let files=AUDIO_FILES;
  try{
    const res=await fetch('audio/manifest.json');
    if(res.ok){
      const names=await res.json();
      if(Array.isArray(names)&&names.length)files=names.map(n=>'audio/'+n);
    }
  }catch(e){}
  validAudioFiles=[];
  let probed=0;
  if(!files.length){if(!S.musicOff){startDroneSynth();audioOn=true;}return;}
  files.forEach(f=>{
    const a=new Audio();
    a.addEventListener('canplaythrough',()=>{validAudioFiles.push(f);probed++;if(probed===files.length)startPlaylist();},{once:true});
    a.addEventListener('error',()=>{probed++;if(probed===files.length)startPlaylist();},{once:true});
    a.src=f;
  });
  setTimeout(()=>{if(!ambientAudio&&validAudioFiles.length===0&&!S.musicOff){startDroneSynth();audioOn=true;}},2000);
}

function startPlaylist(){
  if(validAudioFiles.length===0){if(!S.musicOff){startDroneSynth();audioOn=true;}return;}
  validAudioFiles=shuffleArray(validAudioFiles);
  audioIdx=0;
  playCurrent();
}

function playCurrent(){
  if(validAudioFiles.length===0)return;
  if(ambientAudio){ambientAudio.pause();ambientAudio=null;}
  ambientAudio=new Audio(validAudioFiles[audioIdx]);
  ambientAudio.volume=0.25;
  ambientAudio.onended=()=>{audioIdx=(audioIdx+1)%validAudioFiles.length;playCurrent();};
  if(S.musicOff){setBtn(true);return;}
  ambientAudio.play().then(()=>{audioOn=true;}).catch(()=>{});
}

export function skipSong(){
  if(validAudioFiles.length<=1)return;
  audioIdx=(audioIdx+1)%validAudioFiles.length;
  playCurrent();
}

function startDroneSynth(){
  if(!actx)return;stopDrone();
  const notes=[130.81,164.81,196];
  drone=notes.map(f=>{
    const o=actx.createOscillator();const g=actx.createGain();
    o.type='sine';o.frequency.value=f;g.gain.value=.012;
    o.connect(g);g.connect(actx.destination);o.start();
    return{o,g};
  });
}
function stopDrone(){if(drone){drone.forEach(n=>{try{n.o.stop();}catch(e){}});drone=null;}}

export function toggleAudio(){
  if(audioOn){
    if(ambientAudio){ambientAudio.pause();}else{stopDrone();}
    audioOn=false;setBtn(true);
  }else{
    if(ambientAudio){ambientAudio.play().catch(()=>{});}else if(actx){startDroneSynth();}
    audioOn=true;setBtn(false);
  }
  S.musicOff=!audioOn;saveS();
}

// ── UI beeps (no-op when audio is muted or context unavailable) ──────────────
function beep(f,t,v,d,delay){
  if(!actx||!audioOn)return;
  const o=actx.createOscillator();const g=actx.createGain();
  o.type=t;o.frequency.value=f;g.gain.value=v;o.connect(g);g.connect(actx.destination);
  const s=actx.currentTime+(delay||0);o.start(s);g.gain.exponentialRampToValueAtTime(.001,s+d);o.stop(s+d);
}
export function playSend(){beep(600,'triangle',.1,.15);}
export function playRecv(){[500,660,820].forEach((f,i)=>beep(f,'sine',.08,.22,i*.075));}
export function playVocab(){beep(880,'sine',.07,.28);}
export function playSpell(){[400,600,900,1200,1600].forEach((f,i)=>beep(f,'triangle',.06,.25,i*.06));}
