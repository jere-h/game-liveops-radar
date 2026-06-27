// js/sample-data.js
//
// Bundled static fixtures for the Live-ops Deconfliction Radar.
//
// These are exported as literal CSV text strings — exactly the kind of text a
// user would upload from a file — so the auto-loaded built-in dataset feeds the
// identical parse -> validate -> compute -> render path that a real file upload
// takes. Nothing here is pre-parsed: app.js hands these strings to the very same
// core.js parseCalendar / parseAssignments functions used for uploads.
//
// =====================================================================
// Dataset: a mid-core mobile/live-service game's July 2026 live-ops slate
// =====================================================================
//
//   Calendar (8 initiatives). Windows are deliberately staggered into two date
//   clusters plus two isolated events so the date-overlap graph has EXACTLY the
//   five intended edges (core emits a card for every date-overlapping pair where
//   both sides have >=1 player, so non-intended pairs are kept date-disjoint).
//   ----------------------------------------------------------------------------
//   SUMMER_SALE    Summer Mega Sale          2026-07-01 .. 2026-07-05
//   WHALE_VIP      Whale VIP Offer           2026-07-04 .. 2026-07-08
//   DOUBLE_XP      Double XP Weekend         2026-07-08 .. 2026-07-10
//   WINBACK        Lapsed-Player Winback     2026-07-11 .. 2026-07-13
//   BATTLE_PASS_S7 Battle Pass S7            2026-07-12 .. 2026-07-15
//   STORE_LAYOUT   Store Layout Experiment   2026-07-14 .. 2026-07-17
//   NEWPLAYER_AB   New Player Funnel A/B     2026-07-16 .. 2026-07-20
//   GUILD_WARS     Guild Wars Season         2026-07-25 .. 2026-07-31  (isolated)
//
//   Date-overlap edges (and only these):
//     SUMMER_SALE-WHALE_VIP, WHALE_VIP-DOUBLE_XP, WINBACK-BATTLE_PASS_S7,
//     BATTLE_PASS_S7-STORE_LAYOUT, STORE_LAYOUT-NEWPLAYER_AB.
//   GUILD_WARS overlaps nobody in time -> clean outer radar blip, no conflict.
//
//   Distinct membership sizes (after dedup)
//   ---------------------------------------
//   SUMMER_SALE     -> 12   WHALE_VIP      -> 6
//   BATTLE_PASS_S7  -> 14   DOUBLE_XP      -> 9
//   NEWPLAYER_AB    -> 8    STORE_LAYOUT   -> 10
//   GUILD_WARS      -> 7    WINBACK        -> 6
//
//   Engineered conflicts (the five date-overlapping pairs with shared players).
//   Pair id is lexical "A_ID|B_ID". Impact: frac>=0.5 High, >=0.2 Medium, else Low.
//   ------------------------------------------------------------------------------
//   HIGH   : SUMMER_SALE|WHALE_VIP       shared 5 / min 6  = 0.83  (revenue cannibalization)
//   HIGH   : DOUBLE_XP|WHALE_VIP         shared 4 / min 6  = 0.67  (whale attention split)
//   MEDIUM : BATTLE_PASS_S7|STORE_LAYOUT shared 4 / min 10 = 0.40  (experiment contamination)
//   MEDIUM : NEWPLAYER_AB|STORE_LAYOUT   shared 2 / min 8  = 0.25  (A/B contamination)
//   LOW    : BATTLE_PASS_S7|WINBACK      shared 1 / min 6  = 0.167 (mild audience overlap)
//
//   Intentional duplicate row: (SUMMER_SALE,P001) appears twice to exercise
//   buildMembership's Set-based dedup, as a messy real upload would.

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
SUMMER_SALE,Summer Mega Sale,2026-07-01,2026-07-05,spenders_last_30d
WHALE_VIP,Whale VIP Offer,2026-07-04,2026-07-08,ltv_gt_500
DOUBLE_XP,Double XP Weekend,2026-07-08,2026-07-10,
WINBACK,Lapsed-Player Winback,2026-07-11,2026-07-13,dormant_gt_14d
BATTLE_PASS_S7,Battle Pass S7,2026-07-12,2026-07-15,all_active
STORE_LAYOUT,Store Layout Experiment,2026-07-14,2026-07-17,
NEWPLAYER_AB,New Player Funnel A/B,2026-07-16,2026-07-20,install_lt_7d
GUILD_WARS,Guild Wars Season,2026-07-25,2026-07-31,guild_member
`;

/**
 * Assignment-log CSV fixture.
 *
 * Columns (fixed schema expected by core.parseAssignments):
 *   initiative_id  - must reference an initiative_id present in the calendar
 *   player_id      - the enrolled player
 *
 * Player pool P001..P040, reused across initiatives to engineer the overlaps
 * documented in the header. Contains one intentional duplicate row
 * (SUMMER_SALE,P001) so the load path exercises buildMembership's dedup.
 *
 * @type {string}
 */
export const SAMPLE_ASSIGNMENTS_CSV = `initiative_id,player_id
SUMMER_SALE,P001
SUMMER_SALE,P001
SUMMER_SALE,P002
SUMMER_SALE,P003
SUMMER_SALE,P004
SUMMER_SALE,P005
SUMMER_SALE,P006
SUMMER_SALE,P007
SUMMER_SALE,P008
SUMMER_SALE,P009
SUMMER_SALE,P010
SUMMER_SALE,P011
SUMMER_SALE,P012
WHALE_VIP,P001
WHALE_VIP,P002
WHALE_VIP,P003
WHALE_VIP,P004
WHALE_VIP,P005
WHALE_VIP,P013
BATTLE_PASS_S7,P001
BATTLE_PASS_S7,P002
BATTLE_PASS_S7,P003
BATTLE_PASS_S7,P014
BATTLE_PASS_S7,P015
BATTLE_PASS_S7,P016
BATTLE_PASS_S7,P017
BATTLE_PASS_S7,P018
BATTLE_PASS_S7,P019
BATTLE_PASS_S7,P020
BATTLE_PASS_S7,P021
BATTLE_PASS_S7,P022
BATTLE_PASS_S7,P038
BATTLE_PASS_S7,P023
DOUBLE_XP,P001
DOUBLE_XP,P002
DOUBLE_XP,P003
DOUBLE_XP,P004
DOUBLE_XP,P024
DOUBLE_XP,P025
DOUBLE_XP,P026
DOUBLE_XP,P027
DOUBLE_XP,P028
NEWPLAYER_AB,P029
NEWPLAYER_AB,P030
NEWPLAYER_AB,P031
NEWPLAYER_AB,P032
NEWPLAYER_AB,P033
NEWPLAYER_AB,P034
NEWPLAYER_AB,P041
NEWPLAYER_AB,P042
STORE_LAYOUT,P014
STORE_LAYOUT,P015
STORE_LAYOUT,P016
STORE_LAYOUT,P017
STORE_LAYOUT,P035
STORE_LAYOUT,P036
STORE_LAYOUT,P037
STORE_LAYOUT,P029
STORE_LAYOUT,P030
STORE_LAYOUT,P028
GUILD_WARS,P039
GUILD_WARS,P040
GUILD_WARS,P024
GUILD_WARS,P025
GUILD_WARS,P026
GUILD_WARS,P027
GUILD_WARS,P028
WINBACK,P038
WINBACK,P040
WINBACK,P031
WINBACK,P032
WINBACK,P033
WINBACK,P034
`;

/**
 * Convenience grouping of both fixtures, mirroring the two file inputs.
 * @type {{ calendar: string, assignments: string, calendarCsv: string, assignmentsCsv: string }}
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
