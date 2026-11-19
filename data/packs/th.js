// Country pack: Thailand. Planning defaults only, taken from the product owner's spec
// (TISA_PROMPT_EXPERIMENTAL section 5 and the work plan). Stage 2 only stores them here; no screen uses them yet.
// Nothing here is a live or verified price or rate: these are planning defaults the user can edit later.

export const TH = Object.freeze({
  countryCode: 'TH',
  timeZone: 'Asia/Bangkok',
  currency: 'THB',
  defaultDates: { start: '2026-12-05', end: '2027-01-03' },

  // 11 stops, 29 nights. Nights are derived from the dates. Koh Tao is the flexible stop (1-2 nights in the spec).
  destinations: [
    { id: 'bangkok', name: { he: 'בנגקוק', en: 'Bangkok' }, startDate: '2026-12-05', endDate: '2026-12-08', nights: 3 },
    { id: 'chiang-mai', name: { he: "צ'יאנג מאי", en: 'Chiang Mai' }, startDate: '2026-12-08', endDate: '2026-12-11', nights: 3 },
    { id: 'pai', name: { he: 'פאי', en: 'Pai' }, startDate: '2026-12-11', endDate: '2026-12-13', nights: 2 },
    { id: 'phuket', name: { he: 'פוקט', en: 'Phuket' }, startDate: '2026-12-13', endDate: '2026-12-16', nights: 3 },
    { id: 'krabi', name: { he: 'קראבי', en: 'Krabi' }, startDate: '2026-12-16', endDate: '2026-12-19', nights: 3 },
    { id: 'koh-phi-phi', name: { he: 'קו פי פי', en: 'Koh Phi Phi' }, startDate: '2026-12-19', endDate: '2026-12-21', nights: 2 },
    { id: 'koh-lanta', name: { he: 'קו לנטה', en: 'Koh Lanta' }, startDate: '2026-12-21', endDate: '2026-12-24', nights: 3 },
    { id: 'koh-samui', name: { he: 'קו סמוי', en: 'Koh Samui' }, startDate: '2026-12-24', endDate: '2026-12-28', nights: 4 },
    { id: 'koh-phangan', name: { he: 'קופנגן', en: 'Koh Phangan' }, startDate: '2026-12-28', endDate: '2027-01-01', nights: 4 },
    { id: 'koh-tao', name: { he: 'קו טאו', en: 'Koh Tao' }, startDate: '2027-01-01', endDate: '2027-01-02', nights: 1, flexible: true, nightsRange: [1, 2] },
    { id: 'bangkok-last', name: { he: 'בנגקוק', en: 'Bangkok' }, startDate: '2027-01-02', endDate: '2027-01-03', nights: 1 },
  ],

  budgetCategories: [
    { id: 'flight', name: { he: 'טיסה', en: 'Flight' } },
    { id: 'insurance-sim-gear', name: { he: 'ביטוח, SIM וציוד', en: 'Insurance, SIM and gear' } },
    { id: 'lodging', name: { he: 'לינה', en: 'Lodging' } },
    { id: 'food', name: { he: 'אוכל', en: 'Food' } },
    { id: 'transport', name: { he: 'נסיעות פנימיות', en: 'Local transport' } },
    { id: 'green', name: { he: 'ירוק', en: 'Green' } },
    { id: 'attractions', name: { he: 'אטרקציות', en: 'Attractions' } },
    { id: 'misc', name: { he: 'משתנה', en: 'Miscellaneous' } },
  ],

  // Planning defaults from the original prompt, split by category as given by the product owner on 2026-11-19.
  // These are planning numbers, NOT verified current prices (verified: false); the user can edit them in stage 4.
  // Names (optimal / average / saving) and emergency 2,500 ILS (about one flight ticket) set by the owner on 2026-11-19.
  // `total` is the running budget; emergency is kept apart from it.
  budgetProfilesVerified: false,
  budgetProfiles: [
    { id: 'saver', name: { he: 'חסכון', en: 'Saving' }, description: { he: 'כשאין הרבה כסף: לינה פשוטה, אוכל רחוב ונסיעות זולות.', en: 'When money is tight: simple stays, street food, cheap rides.' }, emergency: 2500, total: 9800, currency: 'ILS', categories: { flight: 2600, 'insurance-sim-gear': 700, lodging: 1500, food: 1500, transport: 900, green: 1200, attractions: 800, misc: 600 } },
    { id: 'realistic', name: { he: 'ממוצע', en: 'Average' }, description: { he: 'תרחיש ממוצע: נוח אבל לא מפנק.', en: 'The middle path: comfortable, not lavish.' }, emergency: 2500, total: 15270, currency: 'ILS', categories: { flight: 3900, 'insurance-sim-gear': 870, lodging: 3000, food: 2100, transport: 1400, green: 1500, attractions: 1500, misc: 1000 } },
    { id: 'comfort', name: { he: 'אופטימלי', en: 'Optimal' }, description: { he: 'התרחיש הטוב ביותר: לינה טובה, אטרקציות ומרווח.', en: 'The best case: good stays, attractions and room to spare.' }, emergency: 2500, total: 21400, currency: 'ILS', categories: { flight: 5000, 'insurance-sim-gear': 1000, lodging: 4500, food: 3000, transport: 1800, green: 2100, attractions: 2500, misc: 1500 } },
  ],

  // Planning rates from the spec (editable later; not live rates): 1 ILS = 10 THB, 1 USD = 3.7 ILS = 37 THB.
  planningRates: { ILS_THB: 10, USD_ILS: 3.7, USD_THB: 37 },
  atmFee: { amount: 220, currency: 'THB' },
});
