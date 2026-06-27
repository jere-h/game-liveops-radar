// js/core.js
// Framework-agnostic pure domain core for the Live-ops Deconfliction Checker.
//
// This module contains NO DOM access and NO framework dependencies. It is the
// unit-tested heart of the app, mapped 1:1 to the PRD's pure functions:
//
//   parseCalendar / parseAssignments  -> validate + normalize CSV (never throw)
//   buildMembership                    -> initiative_id -> Set<player_id>
//   computeConflicts                   -> every date-overlapping pair, ranked
//   filterByThreshold                  -> inclusive (>=) severity cutoff
//
// CSV parsing is fully self-contained (see `tokenizeCsv`): no runtime
// dependency on PapaParse or any CDN, so the app hosts as pure static files
// and works offline / behind a firewall. Parse functions never throw — all
// failures surface as ValidationErrors.

/**
 * @typedef {Object} CalendarRow
 * @property {string} initiative_id  Stable unique id of the initiative.
 * @property {string} name           Human-readable initiative name.
 * @property {string} start_date     Inclusive ISO start date (YYYY-MM-DD).
 * @property {string} end_date       Inclusive ISO end date (YYYY-MM-DD).
 * @property {number} start_ts        Parsed UTC timestamp of start_date (ms).
 * @property {number} end_ts          Parsed UTC timestamp of end_date (ms).
 * @property {string} [segment_predicate]  Optional targeting predicate text.
 */

/**
 * @typedef {Object} AssignmentRow
 * @property {string} initiative_id  Initiative the player is enrolled in.
 * @property {string} player_id      Stable unique id of the player.
 */

/**
 * @typedef {Object} ConflictPair
 * @property {string} id              Stable pair id, `${a_id}|${b_id}` (lexical).
 * @property {string} a_id            Lexically-first initiative id.
 * @property {string} b_id            Lexically-second initiative id.
 * @property {string} a_name          Name of initiative a.
 * @property {string} b_name          Name of initiative b.
 * @property {number} size_a          Distinct enrolled players in a.
 * @property {number} size_b          Distinct enrolled players in b.
 * @property {number} min_size        min(size_a, size_b) (fraction denominator).
 * @property {number} shared_players  Count of players enrolled in BOTH.
 * @property {number} overlap_fraction shared_players / min_size, in [0, 1].
 * @property {number} overlap_window_days Inclusive overlapping calendar days.
 * @property {string} overlap_start   ISO date of first overlapping day.
 * @property {string} overlap_end     ISO date of last overlapping day.
 * @property {('Low'|'Medium'|'High')} impact  Severity band from the fraction.
 */

/**
 * @typedef {Object} ValidationError
 * @property {string} message  Readable, user-facing explanation.
 * @property {number} [row]     1-based source line in the CSV (header is line 1).
 * @property {string} [column]  Offending column name, when applicable.
 * @property {string} [code]    Machine-readable category (schema|required|date|...).
 */

const DAY_MS = 86400000;
const EMPTY_SET = new Set();

/** Required + optional schema columns (fixed schema). */
export const CALENDAR_REQUIRED = ['initiative_id', 'start_date', 'end_date'];
export const CALENDAR_OPTIONAL = ['name', 'segment_predicate'];
export const ASSIGNMENT_REQUIRED = ['initiative_id', 'player_id'];

/** Impact band thresholds (on overlap_fraction) and their sort ranks. */
export const IMPACT_BANDS = { HIGH: 0.5, MEDIUM: 0.2 };
export const IMPACT_RANK = { High: 3, Medium: 2, Low: 1 };

// ---------------------------------------------------------------------------
// Small internal helpers (no DOM, no throwing across the public boundary).
// ---------------------------------------------------------------------------

/**
 * Self-contained RFC-4180-ish CSV tokenizer. Returns a matrix of string cells.
 * Handles quoted fields, embedded commas/newlines, and "" escaped quotes, plus
 * both LF and CRLF line endings. No external dependency (the app must stay
 * hostable as fully static files with no CDN at runtime).
 * @param {string} text
 * @returns {string[][]}
 */
function tokenizeCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let started = false; // did this row have any cell content/separators yet?
  const pushField = () => { row.push(field); field = ''; };
  const pushRow = () => { rows.push(row); row = []; started = false; };
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 1; }
        else inQuotes = false;
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') { inQuotes = true; started = true; continue; }
    if (ch === ',') { pushField(); started = true; continue; }
    if (ch === '\r') { continue; } // normalize CRLF -> LF
    if (ch === '\n') { pushField(); pushRow(); continue; }
    field += ch;
    started = true;
  }
  // Flush the trailing field/row if the file didn't end with a newline.
  if (started || field !== '' || row.length > 0) { pushField(); pushRow(); }
  return rows;
}

/** Coerce any cell value to a trimmed string. */
function str(v) {
  return v == null ? '' : String(v).trim();
}

/** Build a ValidationError object. */
function err(message, extra) {
  return Object.assign({ message: String(message) }, extra || {});
}

/** Lexical comparator returning -1/0/1. */
function cmp(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * Strictly parse an ISO date (YYYY-MM-DD) into a UTC timestamp.
 * Returns NaN for anything malformed or non-existent (e.g. 2024-02-30).
 * @param {string} s
 * @returns {number}
 */
function parseISODate(s) {
  if (typeof s !== 'string') return NaN;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (!m) return NaN;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return NaN;
  const ts = Date.UTC(y, mo - 1, d);
  const dt = new Date(ts);
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) {
    return NaN;
  }
  return ts;
}

/** Convert a UTC timestamp back to an ISO date string (YYYY-MM-DD). */
function toISODate(ts) {
  const dt = new Date(ts);
  const y = String(dt.getUTCFullYear()).padStart(4, '0');
  const mo = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${mo}-${d}`;
}

/** Map a fraction in [0,1] to an impact band. */
function impactBand(fraction) {
  if (fraction >= IMPACT_BANDS.HIGH) return 'High';
  if (fraction >= IMPACT_BANDS.MEDIUM) return 'Medium';
  return 'Low';
}

/** Size of the intersection of two Sets (iterates the smaller one). */
function intersectionSize(a, b) {
  let small = a;
  let large = b;
  if (a.size > b.size) {
    small = b;
    large = a;
  }
  let n = 0;
  for (const v of small) {
    if (large.has(v)) n += 1;
  }
  return n;
}

/**
 * Parse a CSV string into header-keyed row objects with a trimmed header row.
 * Mirrors the previous PapaParse contract (header:true, skipEmptyLines:'greedy').
 * @param {string} csvText
 * @returns {{ data: Object[], fields: string[], parseErrors: ValidationError[] }}
 */
function parseCsv(csvText) {
  const parseErrors = [];
  const matrix = tokenizeCsv(typeof csvText === 'string' ? csvText : '');
  if (matrix.length === 0) {
    return { data: [], fields: [], parseErrors };
  }
  const fields = matrix[0].map((f) => str(f));
  const data = [];
  for (let r = 1; r < matrix.length; r += 1) {
    const cells = matrix[r];
    // skipEmptyLines: 'greedy' — drop rows whose every cell is blank.
    if (cells.every((c) => str(c) === '')) continue;
    const rec = {};
    for (let c = 0; c < fields.length; c += 1) {
      rec[fields[c]] = cells[c] != null ? cells[c] : '';
    }
    data.push(rec);
  }
  return { data, fields, parseErrors };
}

/** Verify required columns are present; returns a schema error or null. */
function checkSchema(fields, required, optional, kind) {
  const missing = required.filter((c) => !fields.includes(c));
  if (missing.length === 0) return null;
  const expected = [...required, ...optional].join(', ');
  return err(
    `${kind} CSV is missing required column(s): ${missing.join(', ')}. ` +
      `Expected header: ${expected}.`,
    { code: 'schema' }
  );
}

// ---------------------------------------------------------------------------
// Public parse functions. Both NEVER throw — failures surface as `errors`.
// ---------------------------------------------------------------------------

/**
 * Parse + validate the calendar CSV.
 * @param {string} csvText
 * @param {{ requireSegmentPredicate?: boolean }} [options]
 * @returns {{ rows: CalendarRow[], errors: ValidationError[] }}
 */
export function parseCalendar(csvText, options = {}) {
  /** @type {CalendarRow[]} */
  const rows = [];
  /** @type {ValidationError[]} */
  const errors = [];
  try {
    if (typeof csvText !== 'string' || csvText.trim() === '') {
      errors.push(err('Calendar file is empty.', { code: 'empty' }));
      return { rows, errors };
    }
    const { data, fields, parseErrors } = parseCsv(csvText);
    errors.push(...parseErrors);

    const schemaError = checkSchema(fields, CALENDAR_REQUIRED, CALENDAR_OPTIONAL, 'Calendar');
    if (schemaError) {
      errors.push(schemaError);
      return { rows, errors };
    }

    const seen = new Set();
    data.forEach((raw, idx) => {
      const line = idx + 2; // header occupies line 1
      const initiative_id = str(raw.initiative_id);
      let name = str(raw.name);
      const start_date = str(raw.start_date);
      const end_date = str(raw.end_date);
      const segment_predicate = str(raw.segment_predicate);

      // Skip a fully-blank row silently.
      if (!initiative_id && !name && !start_date && !end_date && !segment_predicate) {
        return;
      }

      let ok = true;
      if (!initiative_id) {
        errors.push(err('Missing initiative_id.', { row: line, column: 'initiative_id', code: 'required' }));
        ok = false;
      }
      // `name` is an optional display label; fall back to the id when absent.
      if (!name) name = initiative_id;

      const startTs = parseISODate(start_date);
      const endTs = parseISODate(end_date);
      if (Number.isNaN(startTs)) {
        errors.push(err(`Invalid start_date "${start_date}" (expected ISO YYYY-MM-DD).`, {
          row: line,
          column: 'start_date',
          code: 'date',
        }));
        ok = false;
      }
      if (Number.isNaN(endTs)) {
        errors.push(err(`Invalid end_date "${end_date}" (expected ISO YYYY-MM-DD).`, {
          row: line,
          column: 'end_date',
          code: 'date',
        }));
        ok = false;
      }
      if (!Number.isNaN(startTs) && !Number.isNaN(endTs) && startTs > endTs) {
        errors.push(err(`start_date "${start_date}" is after end_date "${end_date}".`, {
          row: line,
          column: 'start_date',
          code: 'range',
        }));
        ok = false;
      }
      if (options.requireSegmentPredicate && !segment_predicate) {
        errors.push(err('Missing segment_predicate.', {
          row: line,
          column: 'segment_predicate',
          code: 'required',
        }));
        ok = false;
      }
      if (ok && seen.has(initiative_id)) {
        errors.push(err(`Duplicate initiative_id "${initiative_id}".`, {
          row: line,
          column: 'initiative_id',
          code: 'duplicate',
        }));
        ok = false;
      }
      if (!ok) return;

      seen.add(initiative_id);
      /** @type {CalendarRow} */
      const row = { initiative_id, name, start_date, end_date, start_ts: startTs, end_ts: endTs };
      if (segment_predicate) row.segment_predicate = segment_predicate;
      rows.push(row);
    });
  } catch (e) {
    errors.push(err(`Unexpected error parsing calendar: ${e && e.message ? e.message : e}`, {
      code: 'internal',
    }));
  }
  return { rows, errors };
}

/**
 * Parse + validate the assignment-log CSV. Rows are NOT de-duplicated here;
 * `buildMembership` performs Set-based dedup downstream.
 * @param {string} csvText
 * @returns {{ rows: AssignmentRow[], errors: ValidationError[] }}
 */
export function parseAssignments(csvText) {
  /** @type {AssignmentRow[]} */
  const rows = [];
  /** @type {ValidationError[]} */
  const errors = [];
  try {
    if (typeof csvText !== 'string' || csvText.trim() === '') {
      errors.push(err('Assignment file is empty.', { code: 'empty' }));
      return { rows, errors };
    }
    const { data, fields, parseErrors } = parseCsv(csvText);
    errors.push(...parseErrors);

    const schemaError = checkSchema(fields, ASSIGNMENT_REQUIRED, [], 'Assignment');
    if (schemaError) {
      errors.push(schemaError);
      return { rows, errors };
    }

    data.forEach((raw, idx) => {
      const line = idx + 2;
      const initiative_id = str(raw.initiative_id);
      const player_id = str(raw.player_id);

      if (!initiative_id && !player_id) return; // blank row

      let ok = true;
      if (!initiative_id) {
        errors.push(err('Missing initiative_id.', { row: line, column: 'initiative_id', code: 'required' }));
        ok = false;
      }
      if (!player_id) {
        errors.push(err('Missing player_id.', { row: line, column: 'player_id', code: 'required' }));
        ok = false;
      }
      if (!ok) return;
      rows.push({ initiative_id, player_id });
    });
  } catch (e) {
    errors.push(err(`Unexpected error parsing assignments: ${e && e.message ? e.message : e}`, {
      code: 'internal',
    }));
  }
  return { rows, errors };
}

// ---------------------------------------------------------------------------
// Membership + conflict computation.
// ---------------------------------------------------------------------------

/**
 * Build initiative_id -> Set<player_id>, de-duplicating repeated assignments.
 * @param {AssignmentRow[]} assignmentRows
 * @returns {Map<string, Set<string>>}
 */
export function buildMembership(assignmentRows) {
  /** @type {Map<string, Set<string>>} */
  const membership = new Map();
  if (!Array.isArray(assignmentRows)) return membership;
  for (const row of assignmentRows) {
    if (!row) continue;
    const id = str(row.initiative_id);
    const player = str(row.player_id);
    if (!id || !player) continue;
    let set = membership.get(id);
    if (!set) {
      set = new Set();
      membership.set(id, set);
    }
    set.add(player);
  }
  return membership;
}

/**
 * Compute every date-overlapping initiative pair as a ConflictPair.
 *
 * Rules:
 *  - Unique unordered pairs only; lexically ordered by initiative_id.
 *  - Self-pairs excluded.
 *  - Pairs where either side has 0 distinct players (min size 0) are skipped.
 *  - Date overlap is INCLUSIVE: a single shared day => overlap_window_days = 1.
 *  - overlap_fraction = shared_players / min(size_a, size_b).
 *  - Impact band derived from the fraction (High/Medium/Low).
 *  - Deterministic sort: impact desc, then fraction desc, then pair id asc.
 *
 * @param {CalendarRow[]} calendarRows
 * @param {Map<string, Set<string>>} membership
 * @returns {ConflictPair[]}
 */
export function computeConflicts(calendarRows, membership) {
  /** @type {ConflictPair[]} */
  const conflicts = [];
  if (!Array.isArray(calendarRows)) return conflicts;
  // Accept either a prebuilt membership Map or a raw assignment-row array.
  const mem = membership instanceof Map
    ? membership
    : buildMembership(Array.isArray(membership) ? membership : []);

  // Sort calendar lexically by id so i<j yields lexically-ordered pairs.
  const sorted = calendarRows.slice().sort((a, b) => cmp(a.initiative_id, b.initiative_id));

  for (let i = 0; i < sorted.length; i += 1) {
    const A = sorted[i];
    for (let j = i + 1; j < sorted.length; j += 1) {
      const B = sorted[j];
      if (A.initiative_id === B.initiative_id) continue; // self / dup guard

      const setA = mem.get(A.initiative_id) || EMPTY_SET;
      const setB = mem.get(B.initiative_id) || EMPTY_SET;
      const sizeA = setA.size;
      const sizeB = setB.size;
      const minSize = Math.min(sizeA, sizeB);
      if (minSize === 0) continue; // min-size-0 skipped

      const overlapStartTs = Math.max(A.start_ts, B.start_ts);
      const overlapEndTs = Math.min(A.end_ts, B.end_ts);
      if (overlapStartTs > overlapEndTs) continue; // no date overlap => no card

      const windowDays = Math.round((overlapEndTs - overlapStartTs) / DAY_MS) + 1;
      const shared = intersectionSize(setA, setB);
      const fraction = shared / minSize;
      const impact = impactBand(fraction);

      // `sorted` ascending + i<j guarantees A.initiative_id <= B.initiative_id.
      conflicts.push({
        id: `${A.initiative_id}|${B.initiative_id}`,
        a_id: A.initiative_id,
        b_id: B.initiative_id,
        // Documented contract aliases (first-task spec uses these names).
        initiative_a: A.initiative_id,
        initiative_b: B.initiative_id,
        a_name: A.name,
        b_name: B.name,
        size_a: sizeA,
        size_b: sizeB,
        min_size: minSize,
        shared_players: shared,
        overlap_fraction: fraction,
        overlap_window_days: windowDays,
        overlap_start: toISODate(overlapStartTs),
        overlap_end: toISODate(overlapEndTs),
        impact,
      });
    }
  }

  conflicts.sort((x, y) => {
    const r = IMPACT_RANK[y.impact] - IMPACT_RANK[x.impact];
    if (r !== 0) return r;
    if (y.overlap_fraction !== x.overlap_fraction) return y.overlap_fraction - x.overlap_fraction;
    return cmp(x.id, y.id);
  });

  return conflicts;
}

/**
 * Keep conflicts whose overlap_fraction meets the threshold (INCLUSIVE >=).
 * @param {ConflictPair[]} conflicts
 * @param {number} threshold  Fraction in [0, 1] (e.g. 0.2 for 20%).
 * @returns {ConflictPair[]}
 */
export function filterByThreshold(conflicts, threshold = 0) {
  if (!Array.isArray(conflicts)) return [];
  const t = Number.isFinite(threshold) ? threshold : 0;
  return conflicts.filter((c) => c.overlap_fraction >= t);
}
