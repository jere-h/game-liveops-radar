// js/sample-data.js
//
// Bundled static fixtures for the "Load sample data" button.
//
// These are exported as literal CSV text strings — exactly the kind of text a
// user would upload from a file — so that clicking "Load sample data" feeds the
// identical parse -> validate -> compute -> render path that a real file upload
// takes. Nothing here is pre-parsed: app.js hands these strings to the very same
// core.js parseCalendar / parseAssignments functions used for uploads.
//
// Dataset shape (3 initiatives, 10 assignment rows):
//
//   Calendar
//   --------
//   SUMMER_SALE   2026-07-01 .. 2026-07-10
//   HERO_QUEST    2026-07-05 .. 2026-07-15   (overlaps SUMMER_SALE on Jul 5-10)
//   GUILD_WARS    2026-07-20 .. 2026-07-25   (no date overlap with the others)
//
//   Memberships (deduped to distinct players per initiative)
//   -------------------------------------------------------
//   SUMMER_SALE : P001, P002, P003, P004        -> size 4
//   HERO_QUEST  : P003, P004, P005              -> size 3
//   GUILD_WARS  : P006, P007, P008              -> size 3
//
// Expected single conflict pair (the only date-overlapping pair with players):
//
//   (HERO_QUEST, SUMMER_SALE)
//     shared_players       = 2          (P003, P004)
//     min_membership_size  = 3          (HERO_QUEST is the smaller cohort)
//     overlap_fraction     = 2 / 3 = 0.6666...
//     overlap_window_days  = 6          (Jul 5,6,7,8,9,10 — inclusive)
//
//   GUILD_WARS overlaps neither initiative's date window, so it produces no
//   flag card regardless of any shared players.

/**
 * Calendar CSV fixture.
 *
 * Columns (fixed schema expected by core.parseCalendar):
 *   initiative_id      - stable identifier for the initiative
 *   name               - human-readable label
 *   start_date         - inclusive ISO date (YYYY-MM-DD)
 *   end_date           - inclusive ISO date (YYYY-MM-DD)
 *   segment_predicate  - optional free-text targeting note (may be blank)
 *
 * @type {string}
 */
export const SAMPLE_CALENDAR_CSV = `initiative_id,name,start_date,end_date,segment_predicate
SUMMER_SALE,Summer Mega Sale,2026-07-01,2026-07-10,spenders_last_30d
HERO_QUEST,Hero Quest Event,2026-07-05,2026-07-15,all_active
GUILD_WARS,Guild Wars Season,2026-07-20,2026-07-25,
`;

/**
 * Assignment-log CSV fixture.
 *
 * Columns (fixed schema expected by core.parseAssignments):
 *   initiative_id  - must reference an initiative_id present in the calendar
 *   player_id      - the enrolled player
 *
 * Note the intentional duplicate row (HERO_QUEST,P003 appears twice) so the
 * "Load sample data" path exercises buildMembership's Set-based dedup exactly as
 * a messy real upload would.
 *
 * @type {string}
 */
export const SAMPLE_ASSIGNMENTS_CSV = `initiative_id,player_id
SUMMER_SALE,P001
SUMMER_SALE,P002
SUMMER_SALE,P003
SUMMER_SALE,P004
HERO_QUEST,P003
HERO_QUEST,P003
HERO_QUEST,P004
HERO_QUEST,P005
GUILD_WARS,P006
GUILD_WARS,P007
GUILD_WARS,P008
`;

/**
 * Convenience grouping of both fixtures, mirroring the two file inputs.
 * @type {{ calendar: string, assignments: string }}
 */
export const SAMPLE_DATA = {
  calendar: SAMPLE_CALENDAR_CSV,
  assignments: SAMPLE_ASSIGNMENTS_CSV,
  calendarCsv: SAMPLE_CALENDAR_CSV,
  assignmentsCsv: SAMPLE_ASSIGNMENTS_CSV,
};

// Convenience aliases for consumers expecting lowerCamelCase names.
export const calendarCsv = SAMPLE_CALENDAR_CSV;
export const assignmentsCsv = SAMPLE_ASSIGNMENTS_CSV;

export default SAMPLE_DATA;
