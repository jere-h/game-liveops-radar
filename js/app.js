// js/app.js
// DOM UI controller for the Live-ops Deconfliction Checker.
//
// Holds ephemeral view state (parsed rows, cached conflicts, threshold), wires
// the two file inputs and the 'Load sample data' button through the pure core
// (parse -> membership -> computeConflicts), re-filters via filterByThreshold on
// every slider change WITHOUT re-parsing, and renders the flag cards, empty
// state, the interim 'need both files' prompt, and the validation-error banner.
//
// Pure domain logic lives in ./core.js; this module only touches the DOM.

import {
  parseCalendar,
  parseAssignments,
  buildMembership,
  computeConflicts,
  filterByThreshold,
} from './core.js';
import { SAMPLE_CALENDAR_CSV as CALENDAR_CSV, SAMPLE_ASSIGNMENTS_CSV as ASSIGNMENTS_CSV } from './sample-data.js';

// ---------------------------------------------------------------------------
// Ephemeral view state
// ---------------------------------------------------------------------------

const state = {
  /** @type {Array|null} parsed calendar rows (null until a valid file/sample) */
  calendarRows: null,
  /** @type {Array|null} parsed assignment rows (null until valid file/sample) */
  assignmentRows: null,
  /** @type {Array} cached conflicts; computed once per parse, reused on slide */
  conflicts: [],
  /** @type {number} current threshold as a fraction in [0, 1] */
  threshold: 0.2,
  /** @type {boolean} whether at least one parse/compute has happened */
  computed: false,
};

// ---------------------------------------------------------------------------
// DOM lookups
// ---------------------------------------------------------------------------

const el = {
  calendarInput: document.getElementById('calendar-input'),
  assignmentsInput: document.getElementById('assignments-input'),
  sampleButton: document.getElementById('load-sample-btn'),
  thresholdSlider: document.getElementById('threshold-slider'),
  thresholdReadout: document.getElementById('threshold-readout'),
  cardList: document.getElementById('flag-list'),
  emptyState: document.getElementById('empty-state'),
  prompt: document.getElementById('prompt-state'),
  errorBanner: document.getElementById('error-banner'),
  errorMessage: document.getElementById('error-list'),
  errorDismiss: document.getElementById('error-dismiss'),
};

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** Read a File as text via a Promise. */
function readFileText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Could not read file'));
    reader.readAsText(file);
  });
}

/**
 * Normalize a core parse result into { rows, errors }.
 * The core's parse functions never throw and may return either a bare array of
 * rows or an object carrying rows + ValidationError[]; handle both shapes.
 */
function normalizeParseResult(result) {
  if (Array.isArray(result)) {
    return { rows: result, errors: [] };
  }
  if (result && typeof result === 'object') {
    const rows = Array.isArray(result.rows) ? result.rows : [];
    const errors = Array.isArray(result.errors) ? result.errors : [];
    return { rows, errors };
  }
  return { rows: [], errors: [] };
}

/** Turn a ValidationError-ish object into a readable line. */
function formatError(err) {
  if (err == null) return 'Unknown validation error.';
  if (typeof err === 'string') return err;
  const parts = [];
  if (err.file) parts.push(`[${err.file}]`);
  if (err.row != null) parts.push(`row ${err.row}`);
  if (err.field) parts.push(`field "${err.field}"`);
  const where = parts.join(' ');
  const msg = err.message || err.code || 'invalid data';
  return where ? `${where}: ${msg}` : msg;
}

/** Human label for the initiative pair, preferring names, falling back to ids. */
function pairLabel(conflict) {
  // core.js ConflictPair emits a_id/b_id and (optionally) a_name/b_name.
  const a =
    conflict.a_name ||
    conflict.a_id ||
    conflict.initiative_a ||
    conflict.a ||
    '?';
  const b =
    conflict.b_name ||
    conflict.b_id ||
    conflict.initiative_b ||
    conflict.b ||
    '?';
  return { a: String(a), b: String(b) };
}

/** Impact band normalized to one of Low / Medium / High. */
function impactBand(conflict) {
  const raw = String(conflict.impact || conflict.impact_band || '').toLowerCase();
  if (raw.startsWith('high')) return 'High';
  if (raw.startsWith('med')) return 'Medium';
  if (raw.startsWith('low')) return 'Low';
  return 'Low';
}

function formatPercent(fraction) {
  const f = Number(fraction);
  if (!isFinite(f)) return '0%';
  return `${Math.round(f * 100)}%`;
}

// ---------------------------------------------------------------------------
// Error banner
// ---------------------------------------------------------------------------

function showErrors(errors) {
  if (!errors || errors.length === 0) {
    hideErrors();
    return;
  }
  el.errorMessage.innerHTML = '';
  const list = document.createElement('ul');
  list.className = 'error-list';
  for (const err of errors.slice(0, 12)) {
    const li = document.createElement('li');
    li.textContent = formatError(err);
    list.appendChild(li);
  }
  if (errors.length > 12) {
    const li = document.createElement('li');
    li.textContent = `\u2026 and ${errors.length - 12} more issue(s).`;
    list.appendChild(li);
  }
  el.errorMessage.appendChild(list);
  el.errorBanner.hidden = false;
}

function hideErrors() {
  el.errorBanner.hidden = true;
  el.errorMessage.innerHTML = '';
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function buildCard(conflict) {
  const card = document.createElement('article');
  const band = impactBand(conflict);
  card.className = `flag-card impact-${band.toLowerCase()}`;

  // --- Title: the initiative pair (the field that was previously broken). ---
  const header = document.createElement('header');
  header.className = 'flag-card__header';

  const title = document.createElement('h3');
  title.className = 'flag-card__title';
  const { a, b } = pairLabel(conflict);
  title.textContent = `${a} \u2194 ${b}`;
  header.appendChild(title);

  const badge = document.createElement('span');
  badge.className = `impact-badge impact-badge--${band.toLowerCase()}`;
  badge.textContent = band;
  header.appendChild(badge);

  card.appendChild(header);

  // --- Metrics ---
  const metrics = document.createElement('dl');
  metrics.className = 'flag-card__metrics';

  const shared =
    conflict.shared_players != null ? conflict.shared_players : 0;
  const fraction =
    conflict.overlap_fraction != null ? conflict.overlap_fraction : 0;
  const windowDays =
    conflict.overlap_window_days != null ? conflict.overlap_window_days : 0;

  appendMetric(metrics, 'Shared players', String(shared));
  appendMetric(metrics, 'Overlap', formatPercent(fraction));
  appendMetric(
    metrics,
    'Window',
    `${windowDays} day${Number(windowDays) === 1 ? '' : 's'}`
  );

  card.appendChild(metrics);
  return card;
}

function appendMetric(dl, label, value) {
  const wrap = document.createElement('div');
  wrap.className = 'metric';

  const dt = document.createElement('dt');
  dt.className = 'metric__label';
  dt.textContent = label;

  const dd = document.createElement('dd');
  dd.className = 'metric__value';
  dd.textContent = value;

  wrap.appendChild(dt);
  wrap.appendChild(dd);
  dl.appendChild(wrap);
}

/**
 * Re-render the cards/empty/prompt regions from current state.
 * Does NOT re-parse; uses the cached conflicts + current threshold.
 */
function render() {
  const haveBoth = state.calendarRows != null && state.assignmentRows != null;

  // Interim prompt: shown until both files have been parsed at least once.
  el.prompt.hidden = haveBoth;

  if (!haveBoth || !state.computed) {
    el.cardList.innerHTML = '';
    el.cardList.hidden = true;
    el.emptyState.hidden = true;
    return;
  }

  const filtered = filterByThreshold(state.conflicts, state.threshold);

  el.cardList.innerHTML = '';
  if (!filtered || filtered.length === 0) {
    el.cardList.hidden = true;
    el.emptyState.hidden = false;
    return;
  }

  el.emptyState.hidden = true;
  el.cardList.hidden = false;

  const frag = document.createDocumentFragment();
  for (const conflict of filtered) {
    frag.appendChild(buildCard(conflict));
  }
  el.cardList.appendChild(frag);
}

// ---------------------------------------------------------------------------
// Compute pipeline
// ---------------------------------------------------------------------------

/**
 * Recompute the cached conflicts when both row sets are present.
 * Pure-core call path identical for uploads and the bundled sample.
 */
function recompute() {
  if (state.calendarRows == null || state.assignmentRows == null) {
    state.conflicts = [];
    state.computed = false;
    render();
    return;
  }
  try {
    const membership = buildMembership(state.assignmentRows);
    state.conflicts = computeConflicts(state.calendarRows, membership) || [];
    state.computed = true;
  } catch (err) {
    state.conflicts = [];
    state.computed = false;
    showErrors([
      { message: `Unexpected error computing conflicts: ${err && err.message ? err.message : err}` },
    ]);
  }
  render();
}

// ---------------------------------------------------------------------------
// Input handling
// ---------------------------------------------------------------------------

async function handleCalendarText(text) {
  const { rows, errors } = normalizeParseResult(parseCalendar(text));
  if (errors.length > 0) {
    showErrors(errors);
    // Keep prior valid rows; do not clobber state on a bad upload.
    return;
  }
  hideErrors();
  state.calendarRows = rows;
  recompute();
}

async function handleAssignmentsText(text) {
  const { rows, errors } = normalizeParseResult(parseAssignments(text));
  if (errors.length > 0) {
    showErrors(errors);
    return;
  }
  hideErrors();
  state.assignmentRows = rows;
  recompute();
}

async function onCalendarChange(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  try {
    const text = await readFileText(file);
    await handleCalendarText(text);
  } catch (err) {
    showErrors([{ file: 'calendar', message: String(err && err.message ? err.message : err) }]);
  }
}

async function onAssignmentsChange(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  try {
    const text = await readFileText(file);
    await handleAssignmentsText(text);
  } catch (err) {
    showErrors([{ file: 'assignments', message: String(err && err.message ? err.message : err) }]);
  }
}

function onLoadSample() {
  hideErrors();
  const cal = normalizeParseResult(parseCalendar(CALENDAR_CSV));
  const asg = normalizeParseResult(parseAssignments(ASSIGNMENTS_CSV));
  const errors = [...cal.errors, ...asg.errors];
  if (errors.length > 0) {
    // Bundled sample should always be clean; surface anything unexpected.
    showErrors(errors);
    return;
  }
  state.calendarRows = cal.rows;
  state.assignmentRows = asg.rows;
  recompute();
}

function onThresholdInput(event) {
  const pct = Number(event.target.value);
  state.threshold = isFinite(pct) ? pct / 100 : 0;
  if (el.thresholdReadout) {
    el.thresholdReadout.textContent = `${isFinite(pct) ? Math.round(pct) : 0}%`;
  }
  // Re-filter only; never re-parse or re-compute on a slider move.
  render();
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

function init() {
  if (el.calendarInput) el.calendarInput.addEventListener('change', onCalendarChange);
  if (el.assignmentsInput) el.assignmentsInput.addEventListener('change', onAssignmentsChange);
  if (el.sampleButton) el.sampleButton.addEventListener('click', onLoadSample);
  if (el.thresholdSlider) el.thresholdSlider.addEventListener('input', onThresholdInput);
  if (el.errorDismiss) el.errorDismiss.addEventListener('click', hideErrors);

  // Initialize threshold from the slider's current value (HTML default 20).
  if (el.thresholdSlider) {
    const pct = Number(el.thresholdSlider.value);
    state.threshold = isFinite(pct) ? pct / 100 : 0.2;
    if (el.thresholdReadout) {
      el.thresholdReadout.textContent = `${isFinite(pct) ? Math.round(pct) : 20}%`;
    }
  }

  hideErrors();
  render();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
