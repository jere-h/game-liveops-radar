// js/app.js
// DOM UI controller for the Live-ops Deconfliction Radar.
//
// On load it auto-populates from the bundled sample (no interaction needed),
// runs the pure core (parse -> membership -> computeConflicts), derives a
// RadarModel, and renders three coordinated views from one cached compute:
//   1. the collision radar (js/radar.js),
//   2. the pre-computed assessment panel (js/assessment.js, numbers injected
//      live from compute),
//   3. the conflict detail cards.
// The threshold slider re-filters all three WITHOUT re-parsing. File uploads
// swap in custom data through the identical core path.
//
// Pure domain logic lives in ./core.js; this module only touches the DOM.

import {
  parseCalendar,
  parseAssignments,
  buildMembership,
  computeConflicts,
  filterByThreshold,
  IMPACT_BANDS,
} from './core.js';
import {
  SAMPLE_CALENDAR_CSV as CALENDAR_CSV,
  SAMPLE_ASSIGNMENTS_CSV as ASSIGNMENTS_CSV,
} from './sample-data.js';
import { renderRadar } from './radar.js';
import { ASSESSMENT } from './assessment.js';

// ---------------------------------------------------------------------------
// Ephemeral view state
// ---------------------------------------------------------------------------

const state = {
  /** @type {Array|null} parsed calendar rows (null until a valid file/sample) */
  calendarRows: null,
  /** @type {Array|null} parsed assignment rows (null until valid file/sample) */
  assignmentRows: null,
  /** @type {Map|null} cached membership (id -> Set<player>), for radar sizes */
  membership: null,
  /** @type {Array} cached conflicts; computed once per parse, reused on slide */
  conflicts: [],
  /** @type {{initiatives:Array,links:Array}|null} cached radar model */
  radarModel: null,
  /** @type {number} current threshold as a fraction in [0, 1] */
  threshold: 0,
  /** @type {boolean} whether at least one parse/compute has happened */
  computed: false,
  /** @type {boolean} true while showing the bundled sample (drives the
   *  assessment narrative, which is written for the sample only) */
  isSample: true,
};

// ---------------------------------------------------------------------------
// DOM lookups
// ---------------------------------------------------------------------------

const el = {
  calendarInput: document.getElementById('calendar-input'),
  assignmentsInput: document.getElementById('assignments-input'),
  calendarStatus: document.getElementById('calendar-status'),
  assignmentsStatus: document.getElementById('assignments-status'),
  sampleButton: document.getElementById('load-sample-btn'),
  thresholdSlider: document.getElementById('threshold-slider'),
  thresholdReadout: document.getElementById('threshold-readout'),
  cardList: document.getElementById('flag-list'),
  emptyState: document.getElementById('empty-state'),
  prompt: document.getElementById('prompt-state'),
  errorBanner: document.getElementById('error-banner'),
  errorMessage: document.getElementById('error-list'),
  errorDismiss: document.getElementById('error-dismiss'),
  radar: document.getElementById('radar'),
  radarLegend: document.getElementById('radar-legend'),
  assessmentOverall: document.getElementById('assessment-overall'),
  assessmentPairs: document.getElementById('assessment-pairs'),
  assessmentEmpty: document.getElementById('assessment-empty'),
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
  const a =
    conflict.a_name || conflict.a_id || conflict.initiative_a || conflict.a || '?';
  const b =
    conflict.b_name || conflict.b_id || conflict.initiative_b || conflict.b || '?';
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

/** Map an overlap fraction to a band label, mirroring core's IMPACT_BANDS. */
function bandFromFraction(fraction) {
  const f = Number(fraction) || 0;
  if (f >= IMPACT_BANDS.HIGH) return 'High';
  if (f >= IMPACT_BANDS.MEDIUM) return 'Medium';
  return 'Low';
}

function formatPercent(fraction) {
  const f = Number(fraction);
  if (!isFinite(f)) return '0%';
  return `${Math.round(f * 100)}%`;
}

function setFileStatus(node, label, loaded) {
  if (!node) return;
  node.textContent = label;
  node.setAttribute('data-loaded', loaded ? 'true' : 'false');
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
    li.textContent = `… and ${errors.length - 12} more issue(s).`;
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
// Radar model
// ---------------------------------------------------------------------------

/**
 * Derive the RadarModel consumed by js/radar.js from a compute result.
 * Every calendar initiative becomes a blip (so non-conflicting ones still
 * appear at the rim); every conflict becomes a link.
 */
function buildRadarModel(calendarRows, membership, conflicts) {
  const sizeOf = (id) => {
    const set = membership && membership.get ? membership.get(id) : null;
    return set && typeof set.size === 'number' ? set.size : 0;
  };

  // Each initiative's risk = the worst overlap fraction it participates in.
  const riskByInit = new Map();
  for (const c of conflicts) {
    for (const id of [c.a_id, c.b_id]) {
      const prev = riskByInit.get(id) || 0;
      if (c.overlap_fraction > prev) riskByInit.set(id, c.overlap_fraction);
    }
  }

  const initiatives = (calendarRows || []).map((r) => {
    const riskScore = riskByInit.get(r.initiative_id) || 0;
    return {
      id: r.initiative_id,
      name: r.name || r.initiative_id,
      size: sizeOf(r.initiative_id),
      riskScore,
      riskBand: riskScore === 0 ? 'None' : bandFromFraction(riskScore),
    };
  });

  const links = (conflicts || []).map((c) => ({
    id: c.id,
    source: c.a_id,
    target: c.b_id,
    sharedPlayers: c.shared_players,
    overlapFraction: c.overlap_fraction,
    impact: c.impact,
    windowDays: c.overlap_window_days,
    overlapStart: c.overlap_start,
    overlapEnd: c.overlap_end,
  }));

  return { initiatives, links };
}

const LEGEND_ITEMS = [
  { band: 'high', label: 'High impact (≥50% overlap)' },
  { band: 'medium', label: 'Medium (20–50%)' },
  { band: 'low', label: 'Low (<20%)' },
  { band: 'none', label: 'No collision' },
];

function renderLegend() {
  if (!el.radarLegend) return;
  el.radarLegend.innerHTML = '';
  for (const item of LEGEND_ITEMS) {
    const span = document.createElement('span');
    span.className = `legend-item legend-${item.band}`;
    const dot = document.createElement('span');
    dot.className = 'legend-dot';
    span.appendChild(dot);
    span.appendChild(document.createTextNode(item.label));
    el.radarLegend.appendChild(span);
  }
}

/**
 * Scroll the assessment entry for a given conflict id into view and flash it.
 * No-op if that entry isn't currently rendered (e.g. filtered out by threshold).
 */
function flashAssessmentItem(pairId) {
  if (!el.assessmentPairs || !pairId) return;
  const item = el.assessmentPairs.querySelector(`[data-pair-id="${pairId}"]`);
  if (!item) return;
  item.scrollIntoView({ behavior: 'smooth', block: 'center' });
  item.classList.remove('is-flash');
  void item.offsetWidth; // restart the flash animation if re-clicked
  item.classList.add('is-flash');
}

/** Radar link clicked → jump to its assessment entry. */
function onRadarLinkSelect(link) {
  if (link && link.id) flashAssessmentItem(link.id);
}

/** Radar blip clicked → jump to the worst current collision it's part of. */
function onRadarInitiativeSelect(init) {
  if (!init || !init.id) return;
  const related = filterByThreshold(state.conflicts, state.threshold).find(
    (c) => c.a_id === init.id || c.b_id === init.id
  );
  if (related) flashAssessmentItem(related.id);
}

function renderRadarView() {
  if (!el.radar || !state.radarModel) return;
  try {
    renderRadar(el.radar, state.radarModel, {
      threshold: state.threshold,
      onSelectLink: onRadarLinkSelect,
      onSelectInitiative: onRadarInitiativeSelect,
    });
  } catch (err) {
    // A viz failure must never take down the rest of the dashboard.
    showErrors([
      { message: `Radar render error: ${err && err.message ? err.message : err}` },
    ]);
  }
}

// ---------------------------------------------------------------------------
// Assessment panel
// ---------------------------------------------------------------------------

function buildAssessmentEntry(conflict) {
  const entry = ASSESSMENT.pairs && ASSESSMENT.pairs[conflict.id];
  if (!entry) return null; // custom data with no baked narrative for this pair

  const li = document.createElement('li');
  const band = impactBand(conflict);
  li.className = `assessment-item impact-${band.toLowerCase()}`;
  li.dataset.pairId = conflict.id; // lets a radar click scroll here

  const head = document.createElement('div');
  head.className = 'assessment-item__head';

  const h3 = document.createElement('h3');
  h3.className = 'assessment-item__headline';
  h3.textContent = entry.headline;
  head.appendChild(h3);

  const badge = document.createElement('span');
  badge.className = `impact-badge impact-badge--${band.toLowerCase()}`;
  badge.textContent = band;
  head.appendChild(badge);
  li.appendChild(head);

  // Hard numbers injected live from compute (kept out of the baked prose).
  const stats = document.createElement('p');
  stats.className = 'assessment-item__stats';
  const { a, b } = pairLabel(conflict);
  stats.textContent =
    `${a} ↔ ${b} · ${conflict.shared_players} shared players · ` +
    `${formatPercent(conflict.overlap_fraction)} overlap · ` +
    `${conflict.overlap_window_days} day${conflict.overlap_window_days === 1 ? '' : 's'} concurrent`;
  li.appendChild(stats);

  li.appendChild(buildBulletGroup('Risks', entry.risks, 'risks'));
  li.appendChild(buildBulletGroup('Opportunities', entry.opportunities, 'opportunities'));

  return li;
}

function buildBulletGroup(title, items, kind) {
  const wrap = document.createElement('div');
  wrap.className = `assessment-group assessment-group--${kind}`;
  const h4 = document.createElement('h4');
  h4.className = 'assessment-group__title';
  h4.textContent = title;
  wrap.appendChild(h4);
  const ul = document.createElement('ul');
  ul.className = 'assessment-group__list';
  for (const text of items || []) {
    const li = document.createElement('li');
    li.textContent = text;
    ul.appendChild(li);
  }
  wrap.appendChild(ul);
  return wrap;
}

function renderAssessment(filtered) {
  if (!el.assessmentPairs) return;

  // Overall summary (only meaningful for the bundled sample narrative).
  if (el.assessmentOverall) {
    el.assessmentOverall.innerHTML = '';
    if (state.isSample && ASSESSMENT.overall) {
      const h3 = document.createElement('h3');
      h3.className = 'assessment-overall__headline';
      h3.textContent = ASSESSMENT.overall.headline;
      const p = document.createElement('p');
      p.className = 'assessment-overall__summary';
      p.textContent = ASSESSMENT.overall.summary;
      el.assessmentOverall.appendChild(h3);
      el.assessmentOverall.appendChild(p);
    } else if (!state.isSample) {
      const p = document.createElement('p');
      p.className = 'assessment-overall__summary assessment-overall__note';
      p.textContent =
        'Custom data loaded. The pre-written risk/opportunity narrative applies ' +
        'to the built-in sample; the radar and metrics above reflect your data.';
      el.assessmentOverall.appendChild(p);
    }
  }

  el.assessmentPairs.innerHTML = '';
  const entries = [];
  for (const conflict of filtered) {
    const node = buildAssessmentEntry(conflict);
    if (node) entries.push(node);
  }

  if (entries.length === 0) {
    if (el.assessmentEmpty) el.assessmentEmpty.hidden = false;
    return;
  }
  if (el.assessmentEmpty) el.assessmentEmpty.hidden = true;
  const frag = document.createDocumentFragment();
  for (const node of entries) frag.appendChild(node);
  el.assessmentPairs.appendChild(frag);
}

// ---------------------------------------------------------------------------
// Conflict detail cards
// ---------------------------------------------------------------------------

function buildCard(conflict) {
  const card = document.createElement('article');
  const band = impactBand(conflict);
  card.className = `flag-card impact-${band.toLowerCase()}`;

  const header = document.createElement('header');
  header.className = 'flag-card__header';

  const title = document.createElement('h3');
  title.className = 'flag-card__title';
  const { a, b } = pairLabel(conflict);
  title.textContent = `${a} ↔ ${b}`;
  header.appendChild(title);

  const badge = document.createElement('span');
  badge.className = `impact-badge impact-badge--${band.toLowerCase()}`;
  badge.textContent = band;
  header.appendChild(badge);

  card.appendChild(header);

  const metrics = document.createElement('dl');
  metrics.className = 'flag-card__metrics';

  const shared = conflict.shared_players != null ? conflict.shared_players : 0;
  const fraction = conflict.overlap_fraction != null ? conflict.overlap_fraction : 0;
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

// ---------------------------------------------------------------------------
// Coordinated render
// ---------------------------------------------------------------------------

/**
 * Re-render every view from current state. Does NOT re-parse; uses the cached
 * conflicts/radar model + the current threshold.
 */
function render() {
  const haveBoth = state.calendarRows != null && state.assignmentRows != null;
  if (el.prompt) el.prompt.hidden = haveBoth;

  if (!haveBoth || !state.computed) {
    if (el.cardList) { el.cardList.innerHTML = ''; el.cardList.hidden = true; }
    if (el.emptyState) el.emptyState.hidden = true;
    if (el.assessmentPairs) el.assessmentPairs.innerHTML = '';
    if (el.assessmentOverall) el.assessmentOverall.innerHTML = '';
    if (el.assessmentEmpty) el.assessmentEmpty.hidden = true;
    if (el.radar) el.radar.innerHTML = '';
    return;
  }

  const filtered = filterByThreshold(state.conflicts, state.threshold);

  // 1. Radar (full model; renderRadar hides sub-threshold links itself).
  renderRadarView();

  // 2. Assessment.
  renderAssessment(filtered);

  // 3. Detail cards.
  el.cardList.innerHTML = '';
  if (!filtered || filtered.length === 0) {
    el.cardList.hidden = true;
    el.emptyState.hidden = false;
    return;
  }
  el.emptyState.hidden = true;
  el.cardList.hidden = false;
  const frag = document.createDocumentFragment();
  for (const conflict of filtered) frag.appendChild(buildCard(conflict));
  el.cardList.appendChild(frag);
}

// ---------------------------------------------------------------------------
// Compute pipeline
// ---------------------------------------------------------------------------

/**
 * Recompute cached conflicts + radar model when both row sets are present.
 * Identical pure-core path for uploads and the bundled sample.
 */
function recompute() {
  if (state.calendarRows == null || state.assignmentRows == null) {
    state.conflicts = [];
    state.radarModel = null;
    state.computed = false;
    render();
    return;
  }
  try {
    const membership = buildMembership(state.assignmentRows);
    state.membership = membership;
    state.conflicts = computeConflicts(state.calendarRows, membership) || [];
    state.radarModel = buildRadarModel(state.calendarRows, membership, state.conflicts);
    state.computed = true;
  } catch (err) {
    state.conflicts = [];
    state.radarModel = null;
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

function handleCalendarText(text) {
  const { rows, errors } = normalizeParseResult(parseCalendar(text));
  if (errors.length > 0) {
    showErrors(errors);
    return false;
  }
  hideErrors();
  state.calendarRows = rows;
  return true;
}

function handleAssignmentsText(text) {
  const { rows, errors } = normalizeParseResult(parseAssignments(text));
  if (errors.length > 0) {
    showErrors(errors);
    return false;
  }
  hideErrors();
  state.assignmentRows = rows;
  return true;
}

async function onCalendarChange(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  try {
    const text = await readFileText(file);
    if (handleCalendarText(text)) {
      state.isSample = false;
      setFileStatus(el.calendarStatus, file.name || 'Custom file', true);
      recompute();
    }
  } catch (err) {
    showErrors([{ file: 'calendar', message: String(err && err.message ? err.message : err) }]);
  }
}

async function onAssignmentsChange(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  try {
    const text = await readFileText(file);
    if (handleAssignmentsText(text)) {
      state.isSample = false;
      setFileStatus(el.assignmentsStatus, file.name || 'Custom file', true);
      recompute();
    }
  } catch (err) {
    showErrors([{ file: 'assignments', message: String(err && err.message ? err.message : err) }]);
  }
}

function loadSample() {
  hideErrors();
  const cal = normalizeParseResult(parseCalendar(CALENDAR_CSV));
  const asg = normalizeParseResult(parseAssignments(ASSIGNMENTS_CSV));
  const errors = [...cal.errors, ...asg.errors];
  if (errors.length > 0) {
    showErrors(errors);
    return;
  }
  state.calendarRows = cal.rows;
  state.assignmentRows = asg.rows;
  state.isSample = true;
  setFileStatus(el.calendarStatus, 'Using sample', false);
  setFileStatus(el.assignmentsStatus, 'Using sample', false);
  if (el.calendarInput) el.calendarInput.value = '';
  if (el.assignmentsInput) el.assignmentsInput.value = '';
  recompute();
}

function onThresholdInput(event) {
  const pct = Number(event.target.value);
  state.threshold = isFinite(pct) ? pct / 100 : 0;
  if (el.thresholdReadout) {
    el.thresholdReadout.textContent = `${isFinite(pct) ? Math.round(pct) : 0}%`;
  }
  render(); // re-filter only; never re-parse on a slider move
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

function init() {
  if (el.calendarInput) el.calendarInput.addEventListener('change', onCalendarChange);
  if (el.assignmentsInput) el.assignmentsInput.addEventListener('change', onAssignmentsChange);
  if (el.sampleButton) el.sampleButton.addEventListener('click', loadSample);
  if (el.thresholdSlider) el.thresholdSlider.addEventListener('input', onThresholdInput);
  if (el.errorDismiss) el.errorDismiss.addEventListener('click', hideErrors);

  // Initialize threshold from the slider's current value (HTML default 0).
  if (el.thresholdSlider) {
    const pct = Number(el.thresholdSlider.value);
    state.threshold = isFinite(pct) ? pct / 100 : 0;
    if (el.thresholdReadout) {
      el.thresholdReadout.textContent = `${isFinite(pct) ? Math.round(pct) : 0}%`;
    }
  }

  renderLegend();
  hideErrors();
  // Auto-populate the dashboard from the bundled sample — no interaction needed.
  loadSample();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
