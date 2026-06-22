// ── SYNC RESOLVE ─────────────────────────────────────────────────────────────
// Choice window UI — renders side-by-side comparison of local vs. cloud state
// statistics and returns the user's choice. Blocks until user decides.

import { esc } from './helpers.js';
import lang from './lang.js';

const LEVEL_LABELS = { 0: 'A2', 1: 'B1', 2: 'B1+' };

const STAT_KEYS = ['_updatedAt', 'vocab', 'totalMsgs', 'streak', 'lifetimePts', 'readingCompleted', 'challengesCompleted', 'level'];

function fmtStat(key, value) {
  if (key === '_updatedAt') {
    return new Date(value).toLocaleDateString(lang.dateLocale, {
      day: 'numeric', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  }
  if (key === 'level') {
    return LEVEL_LABELS[value] ?? String(value);
  }
  return String(value ?? 0);
}

function renderTable(localStats, remoteStats) {
  let h = '';
  h += `<div class="sync-choice-section">${lang.ui.syncSectionLocal}</div>`;
  h += `<div class="sync-choice-section">${lang.ui.syncSectionCloud}</div>`;
  for (const key of STAT_KEYS) {
    const label = esc(lang.ui.syncStatLabels[key] || key);
    const lv = esc(fmtStat(key, localStats[key]));
    const rv = esc(fmtStat(key, remoteStats[key]));
    h += `<div class="sync-choice-row"><div class="sync-choice-row-label">${label}</div><div class="sync-choice-row-value">${lv}</div></div>`;
    h += `<div class="sync-choice-row"><div class="sync-choice-row-label">${label}</div><div class="sync-choice-row-value">${rv}</div></div>`;
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
      <div class="sync-choice-title">${lang.ui.syncTitle}</div>
      <div class="sync-choice-subtitle">${lang.ui.syncSubtitle}</div>
      <div class="sync-choice-table">
        ${renderTable(localStats, remoteStats)}
      </div>
      <div class="sync-choice-actions">
        <button class="sync-choice-btn sync-choice-btn--local" id="syncChoiceLocal">${lang.ui.syncBtnLocal}</button>
        <button class="sync-choice-btn sync-choice-btn--remote" id="syncChoiceRemote">${lang.ui.syncBtnCloud}</button>
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
