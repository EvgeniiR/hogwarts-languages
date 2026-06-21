// ── SYNC RESOLVE ─────────────────────────────────────────────────────────────
// Choice window UI — renders side-by-side comparison of local vs. cloud state
// statistics and returns the user's choice. Blocks until user decides.

import { esc } from './helpers.js';

const LEVEL_LABELS = { 0: 'A2', 1: 'B1', 2: 'B1+' };

const STAT_SPECS = [
  { key: '_updatedAt', label: 'Última modificación', fmt: 'date' },
  { key: 'vocab', label: 'Vocabulario', fmt: 'number' },
  { key: 'totalMsgs', label: 'Mensajes totales', fmt: 'number' },
  { key: 'streak', label: 'Racha de días', fmt: 'number' },
  { key: 'lifetimePts', label: 'Puntos totales', fmt: 'number' },
  { key: 'readingCompleted', label: 'Lecturas completadas', fmt: 'number' },
  { key: 'challengesCompleted', label: 'Desafíos completados', fmt: 'number' },
  { key: 'level', label: 'Nivel', fmt: 'level' },
];

function fmtStat(key, value, format) {
  if (format === 'date') {
    return new Date(value).toLocaleDateString('es-ES', {
      day: 'numeric', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  }
  if (format === 'level') {
    return LEVEL_LABELS[value] ?? String(value);
  }
  return String(value ?? 0);
}

function renderTable(localStats, remoteStats) {
  let h = '';
  h += `<div class="sync-choice-section">Este dispositivo</div>`;
  h += `<div class="sync-choice-section">Nube</div>`;
  for (const s of STAT_SPECS) {
    const lv = fmtStat(s.key, localStats[s.key], s.fmt);
    const rv = fmtStat(s.key, remoteStats[s.key], s.fmt);
    h += `<div class="sync-choice-row"><div class="sync-choice-row-label">${esc(s.label)}</div><div class="sync-choice-row-value">${esc(lv)}</div></div>`;
    h += `<div class="sync-choice-row"><div class="sync-choice-row-label">${esc(s.label)}</div><div class="sync-choice-row-value">${esc(rv)}</div></div>`;
  }
  return h;
}

export async function showChoiceWindow(localStats, remoteStats) {
  const wrap = document.getElementById('syncChoiceWrap');
  const splash = document.getElementById('splash');

  // Hide all splash children except syncChoiceWrap
  const hidden = [];
  for (const child of splash.children) {
    if (child !== wrap) {
      hidden.push({ el: child, prev: child.style.display });
      child.style.display = 'none';
    }
  }

  // Build the choice window
  wrap.innerHTML = `
    <div class="sync-choice-wrap">
      <div class="sync-choice-title">¿Qué versión quieres usar?</div>
      <div class="sync-choice-subtitle">Encontramos tu progreso en este dispositivo y en la nube.<br>Elige cuál quieres conservar.</div>
      <div class="sync-choice-table">
        ${renderTable(localStats, remoteStats)}
      </div>
      <div class="sync-choice-actions">
        <button class="sync-choice-btn sync-choice-btn--local" id="syncChoiceLocal">Usar este dispositivo</button>
        <button class="sync-choice-btn sync-choice-btn--remote" id="syncChoiceRemote">Usar nube</button>
      </div>
    </div>
  `;
  wrap.style.display = '';

  // Capture buttons for focus trap
  const localBtn = document.getElementById('syncChoiceLocal');
  const remoteBtn = document.getElementById('syncChoiceRemote');
  const btns = [localBtn, remoteBtn];

  function onKeydown(e) {
    if (e.key === 'Tab') {
      const idx = btns.indexOf(document.activeElement);
      if (e.shiftKey) {
        if (idx <= 0) { e.preventDefault(); btns[btns.length - 1].focus(); }
      } else {
        if (idx >= btns.length - 1 || idx === -1) { e.preventDefault(); btns[0].focus(); }
      }
    }
    // Escape does nothing — user must choose
  }

  wrap.addEventListener('keydown', onKeydown);

  // Auto-focus first button
  localBtn.focus();

  const choice = await new Promise((resolve) => {
    localBtn.addEventListener('click', () => resolve('local'));
    remoteBtn.addEventListener('click', () => resolve('remote'));
  });

  // Cleanup
  wrap.removeEventListener('keydown', onKeydown);
  wrap.innerHTML = '';
  wrap.style.display = 'none';

  // Restore original splash children
  for (const { el, prev } of hidden) {
    el.style.display = prev;
  }

  return choice;
}
