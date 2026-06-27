// js/assessment.js
//
// PRE-COMPUTED ASSESSMENT (baked in — this is NOT a live LLM call).
//
// The radar app renders a "Pre-computed assessment" panel from this module.
// Every `pairs` key is the EXACT `conflict.id` (`"A_ID|B_ID"`, A_ID < B_ID
// lexically) that core.computeConflicts emits for the bundled sample dataset.
// There is one entry per emitted conflict and no extras.
//
// IMPORTANT: keep the narrative QUALITATIVE. The hard numbers (shared players,
// overlap %, window days, impact band) are injected by app.js from live compute
// at render time, so nothing here hard-codes a specific count or percentage —
// that keeps the prose honest and consistent if the data ever shifts.

export const ASSESSMENT = {
  overall: {
    headline: 'Two whale-facing offers are stacked; your experiments are bleeding into each other',
    summary:
      'The slate front-loads premium monetization onto the same high-value audience while ' +
      'two live experiments share players with always-on systems. The biggest dollars are at ' +
      'risk early (overlapping spender offers), and your read on the store and onboarding tests ' +
      'is being contaminated by concurrent reach. Stagger the premium offers and isolate the ' +
      'experiment cohorts before launch.',
  },
  pairs: {
    // HIGH — two paid offers chasing the same spenders in the same window.
    'SUMMER_SALE|WHALE_VIP': {
      headline: 'Whale VIP Offer cannibalizes the Summer Mega Sale',
      risks: [
        'Direct revenue cannibalization: the same high-LTV spenders see two competing paid offers and buy the cheaper or first one, not both.',
        'Discount anchoring — a broad sale running alongside a premium VIP price erodes the perceived value of the VIP bundle.',
        'Attribution becomes muddy: you cannot tell which offer actually drove a given purchase, distorting future pricing decisions.',
      ],
      opportunities: [
        'Sequence them: run the VIP offer as an exclusive early-access window, then open the broad sale, to ladder spend instead of splitting it.',
        'Suppress the sale for the VIP-eligible segment so each player sees exactly one, cleaner offer.',
      ],
    },

    // HIGH — premium offer competing with an engagement event for whale attention.
    'DOUBLE_XP|WHALE_VIP': {
      headline: 'Double XP Weekend pulls whales away from the VIP purchase moment',
      risks: [
        'Attention split: whales chasing limited-time XP grind sessions are heads-down playing, not browsing the store at the VIP decision point.',
        'The free progression boost can substitute for the paid power the VIP offer sells, softening conversion.',
        'Session-time spikes from Double XP can mask or inflate VIP offer engagement metrics, misleading the post-mortem.',
      ],
      opportunities: [
        'Bridge them: gate a Double XP multiplier behind the VIP tier so the engagement event becomes a reason to convert rather than a distraction.',
        'Place the VIP offer at a natural grind break (energy-out / cap reached) to catch whales when paying removes friction.',
      ],
    },

    // MEDIUM — a controlled experiment overlapping an always-on system.
    'BATTLE_PASS_S7|STORE_LAYOUT': {
      headline: 'Store Layout Experiment is contaminating the Battle Pass cohort',
      risks: [
        'Confounded experiment: Battle Pass buyers routed through a changed store layout make the layout test impossible to read cleanly.',
        'A/B contamination — the same players sit in both the pass population and the layout variants, so neither metric isolates a single cause.',
        'Any store-conversion lift could be the pass FOMO talking, not the layout, leading you to ship the wrong winner.',
      ],
      opportunities: [
        'Exclude active Battle Pass holders from the layout test to recover a clean control group.',
        'If overlap is unavoidable, stratify the analysis by pass-ownership so each layout variant is judged within-segment.',
      ],
    },

    // MEDIUM — two experiments sharing players (A/B contamination).
    'NEWPLAYER_AB|STORE_LAYOUT': {
      headline: 'Two live experiments share players and blur each other',
      risks: [
        'Cross-experiment contamination: players in the New Player Funnel test also hit the Store Layout test, so interaction effects masquerade as main effects.',
        'Variant collision — a user can land in conflicting variant combinations you never designed or powered for.',
        'Underpowered, ambiguous reads: splitting the same users across two tests shrinks effective sample per cell and widens confidence intervals.',
      ],
      opportunities: [
        'Mutually exclude the two experiments at assignment time so each player is in at most one test.',
        'If you must overlap, run a proper factorial design and size it for the interaction so both reads stay valid.',
      ],
    },

    // LOW — mild, mostly benign audience overlap worth a glance, not an alarm.
    'BATTLE_PASS_S7|WINBACK': {
      headline: 'Minor reactivated-player bleed into the Battle Pass',
      risks: [
        'Light audience fatigue: a freshly reactivated player immediately pushed toward a paid pass may churn again from offer overload.',
        'The winback’s reactivation lift is slightly muddied by concurrent Battle Pass messaging.',
      ],
      opportunities: [
        'Cross-sell synergy: a returning player is a natural Battle Pass candidate — warm them up first, then present the pass as the next step.',
        'Use the small shared cohort as a low-risk test of a winback-to-pass upsell path before scaling it.',
      ],
    },
  },
};

export default ASSESSMENT;
