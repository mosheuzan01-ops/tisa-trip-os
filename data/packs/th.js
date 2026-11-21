// Country pack: Thailand. Planning defaults only, taken from the product owner's spec
// (TISA_PROMPT_EXPERIMENTAL section 5 and the work plan). Stage 2 only stores them here; no screen uses them yet.
// Nothing here is a live or verified price or rate: these are planning defaults the user can edit later.

export const TH = Object.freeze({
  countryCode: 'TH',
  timeZone: 'Asia/Bangkok',
  currency: 'THB',


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

  // Stage 9 (owner decision 2026-11-21): the default budget for a new trip. Planning amounts per person, not
  // prices and not real expenses. No dates here: the trip dates are entered in the app (rule 16).
  // `total` is the base budget; the emergency fund is kept apart from it and shown separately.
  budgetTemplates: [
    {
      id: 'plan20k',
      name: { he: 'תכנון 20,000 ₪ לאדם', en: 'Plan: 20,000 ILS per person' },
      description: { he: 'כולל טיסה. קרן חירום 2,500 ₪ בנפרד, לא כלולה ב-20,000.', en: 'Flight included. Emergency fund 2,500 ILS on top, not part of the 20,000.' },
      total: 20000, emergency: 2500, currency: 'ILS',
      categories: { flight: 5000, lodging: 5000, food: 3500, transport: 2200, attractions: 2300, 'insurance-sim-gear': 1000, misc: 1000 },
      categoryNames: {
        he: { food: 'אוכל ושתייה', transport: 'תחבורה, מעברים וטיסות פנים', attractions: 'אטרקציות וחיי לילה', 'insurance-sim-gear': 'ביטוח, תקשורת וציוד', misc: 'רזרבה, קניות ומתנות' },
        en: { food: 'Food and drinks', transport: 'Transport, transfers and domestic flights', attractions: 'Attractions and nightlife', 'insurance-sim-gear': 'Insurance, comms and gear', misc: 'Reserve, shopping and gifts' },
      },
      hidden: ['green'], // hidden only while it is empty; never deleted from data (owner, 2026-11-21)
    },
  ],

  // Stage 9 route template: a suggestion built from the trip dates the user enters (core/route-plan.js).
  // First night on the plane; Bangkok first (2-3 nights); southern islands only; Koh Samui over the night of
  // 31.12 when the trip has it; the last 3 dates (2 nights) in Bangkok. No ferry or flight times anywhere.
  routeTemplate: {
    firstNightOnPlane: true,
    start: { id: 'bangkok', name: { he: 'בנגקוק', en: 'Bangkok' }, nights: 3, shortNights: 2, shortBelow: 20 },
    end: { id: 'bangkok-end', name: { he: 'בנגקוק', en: 'Bangkok' }, nights: 2, note: { he: 'הלילות האחרונים לפני טיסת החזרה', en: 'Last nights before the flight home' } },
    minNights: 2,
    clusters: [
      [
        { id: 'koh-samui', name: { he: 'קו סמוי', en: 'Koh Samui' }, weight: 7, newYear: true, newYearNote: { he: 'ליל השנה החדשה: כיוון מועדף, לא סגור', en: "New Year's Eve: preferred, not booked" } },
        { id: 'koh-tao', name: { he: 'קו טאו', en: 'Koh Tao' }, weight: 3, flexible: true },
      ],
      [
        { id: 'phuket', name: { he: 'פוקט', en: 'Phuket' }, weight: 5 },
        { id: 'koh-phi-phi', name: { he: 'קו פי פי', en: 'Koh Phi Phi' }, weight: 4 },
        { id: 'koh-lanta', name: { he: 'קו לנטה', en: 'Koh Lanta' }, weight: 4 },
      ],
    ],
  },

  // Archive (owner decision 2026-11-21): the old route, its dates and the three old budget profiles.
  // Kept, never deleted, never the default. The app offers them only from an "archive" choice, marked stale.
  archive: {
    stale: true,
    staleLabel: { he: 'הערכה ישנה, לא מעודכנת', en: 'Old estimate, not updated' },
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
    // Names (optimal / average / saving) and emergency 2,500 ILS (about one flight ticket) set by the owner on 2026-11-19.
    // `total` is the running budget; emergency is kept apart from it.
    budgetProfilesVerified: false,
    budgetProfiles: [
      { id: 'saver', name: { he: 'חסכון', en: 'Saving' }, description: { he: 'כשאין הרבה כסף: לינה פשוטה, אוכל רחוב ונסיעות זולות.', en: 'When money is tight: simple stays, street food, cheap rides.' }, emergency: 2500, total: 9800, currency: 'ILS', categories: { flight: 2600, 'insurance-sim-gear': 700, lodging: 1500, food: 1500, transport: 900, green: 1200, attractions: 800, misc: 600 } },
      { id: 'realistic', name: { he: 'ממוצע', en: 'Average' }, description: { he: 'תרחיש ממוצע: נוח אבל לא מפנק.', en: 'The middle path: comfortable, not lavish.' }, emergency: 2500, total: 15270, currency: 'ILS', categories: { flight: 3900, 'insurance-sim-gear': 870, lodging: 3000, food: 2100, transport: 1400, green: 1500, attractions: 1500, misc: 1000 } },
      { id: 'comfort', name: { he: 'אופטימלי', en: 'Optimal' }, description: { he: 'התרחיש הטוב ביותר: לינה טובה, אטרקציות ומרווח.', en: 'The best case: good stays, attractions and room to spare.' }, emergency: 2500, total: 21400, currency: 'ILS', categories: { flight: 5000, 'insurance-sim-gear': 1000, lodging: 4500, food: 3000, transport: 1800, green: 2100, attractions: 2500, misc: 1500 } },
    ],
  },

  // Planning rates from the spec (editable later; not live rates): 1 ILS = 10 THB, 1 USD = 3.7 ILS = 37 THB.
  planningRates: { ILS_THB: 10, USD_ILS: 3.7, USD_THB: 37 },
  atmFee: { amount: 220, currency: 'THB' },

  // Stage 5 starter checklist and tasks (owner's stage-5 spec, 2026-11-19). Names only: no rules, numbers,
  // dates or medicine names. `verify` items depend on rules that change; the app shows them as "to check".
  checklistSeed: [
    { group: 'documents', name: { he: 'דרכון', en: 'Passport' } },
    { group: 'documents', name: { he: 'תוקף הדרכון', en: 'Passport validity' }, verify: true },
    { group: 'documents', name: { he: 'אשרה ודרישות כניסה', en: 'Visa and entry requirements' }, verify: true },
    { group: 'documents', name: { he: 'רישיון נהיגה בינלאומי', en: 'International driving permit' }, verify: true },
    { group: 'documents', name: { he: 'פוליסת ביטוח נסיעות', en: 'Travel insurance policy' } },
    { group: 'money', name: { he: 'כרטיס אשראי', en: 'Credit card' } },
    { group: 'money', name: { he: 'כרטיס נוסף לגיבוי', en: 'Backup card' } },
    { group: 'money', name: { he: 'מזומן לימים הראשונים', en: 'Cash for the first days' } },
    { group: 'comms', name: { he: 'eSIM או כרטיס SIM', en: 'eSIM or SIM card' } },
    { group: 'comms', name: { he: 'מפות שעובדות בלי קליטה', en: 'Offline maps' } },
    { group: 'health', name: { he: 'תרופות אישיות (לפי הרופא)', en: 'Personal medicine (as your doctor says)' } },
    { group: 'health', name: { he: 'ערכת עזרה ראשונה', en: 'First aid kit' } },
    { group: 'health', name: { he: 'קרם הגנה', en: 'Sunscreen' } },
    { group: 'health', name: { he: 'דוחה יתושים', en: 'Insect repellent' } },
    { group: 'clothing', name: { he: 'בגדים קלים', en: 'Light clothes' } },
    { group: 'clothing', name: { he: 'בגד ים', en: 'Swimwear' } },
    { group: 'clothing', name: { he: 'כפכפים או סנדלים', en: 'Flip-flops or sandals' } },
    { group: 'clothing', name: { he: 'לבוש לביקור במקדשים', en: 'Clothes for temple visits' }, verify: true },
    { group: 'chargers', name: { he: 'מטען לטלפון', en: 'Phone charger' } },
    { group: 'chargers', name: { he: 'מתאם לשקע החשמל', en: 'Plug adapter' }, verify: true },
    { group: 'chargers', name: { he: 'סוללה ניידת', en: 'Power bank' } },
  ],
  // Stage 9 PR 2: flight items, added from the lists screen on request, without repeating what is already there.
  // Generic advice only: anything that depends on airline or airport rules carries `verify`.
  flightChecklistSeed: [
    { group: 'offline', name: { he: 'כרטיסי עלייה למטוס שמורים בטלפון', en: 'Boarding passes saved on the phone' } },
    { group: 'offline', name: { he: 'אישורי הזמנות שמורים בטלפון', en: 'Booking confirmations saved on the phone' } },
    { group: 'offline', name: { he: 'קובץ גיבוי של האפליקציה', en: 'App backup file' } },
    { group: 'offline', name: { he: 'מתרגם שעובד בלי קליטה', en: 'Translator that works offline' } },
    { group: 'offline', name: { he: 'סרטים, מוזיקה או ספרים להורדה', en: 'Films, music or books downloaded' } },
    { group: 'flightFood', name: { he: 'חטיפים לטיסה', en: 'Snacks for the flight' } },
    { group: 'flightFood', name: { he: 'בקבוק ריק למילוי אחרי הבידוק', en: 'Empty bottle to fill after security' }, verify: true },
    { group: 'flightFood', name: { he: 'מסטיק או סוכריות', en: 'Gum or sweets' } },
    { group: 'flightFood', name: { he: 'ארוחה, אם היא לא כלולה בכרטיס', en: 'A meal, if the ticket has none' }, verify: true },
    { group: 'flightComfort', name: { he: 'כרית צוואר', en: 'Neck pillow' } },
    { group: 'flightComfort', name: { he: 'אטמי אוזניים', en: 'Earplugs' } },
    { group: 'flightComfort', name: { he: 'כיסוי עיניים', en: 'Eye mask' } },
    { group: 'flightComfort', name: { he: 'אוזניות', en: 'Headphones' } },
    { group: 'flightComfort', name: { he: 'שכבה חמה למטוס', en: 'A warm layer for the plane' } },
    { group: 'flightComfort', name: { he: 'גרביים נוחות', en: 'Comfortable socks' } },
  ],
  // Pre-stage-10, PR A (owner decision 2026-11-21): the built-in checklist. A new trip comes with all of it;
  // old data is offered only the missing items (by key, name or alias, in either language). Nothing is ticked
  // automatically. `verify` items depend on rules (entry, airline, airport, emergency numbers): they stay
  // "to check" until the user writes where they checked. The emergency numbers are the owner's list, NOT verified;
  // verifying them belongs to the "information for Thailand" stage (docs/FEATURES_TRIPILOT.md, stage 11).
  // `aliases`: names of the old starter and flight lists (checklistSeed, flightChecklistSeed) that mean the same.
  checklistBuiltinVersion: 1,
  checklistBuiltin: [
    // Documents and money
    { key: 'passport', group: 'documents', name: { he: 'דרכון', en: 'Passport' } },
    { key: 'passport-validity', group: 'documents', name: { he: 'תוקף הדרכון', en: 'Passport validity' }, note: { he: 'לפי דרישות הכניסה', en: 'As the entry rules require' }, verify: true },
    { key: 'entry-rules', group: 'documents', name: { he: 'אשרה ודרישות כניסה', en: 'Visa and entry requirements' }, verify: true },
    { key: 'passport-copy', group: 'documents', name: { he: 'צילום דרכון בטלפון ועותק מודפס בנפרד', en: 'Passport photo on the phone and a printed copy apart' } },
    { key: 'ticket-offline', group: 'documents', name: { he: 'כרטיס טיסה וקוד הזמנה זמינים אופליין', en: 'Flight ticket and booking code available offline' } },
    { key: 'insurance', group: 'documents', name: { he: 'פרטי ביטוח נסיעות ומספר חירום', en: 'Travel insurance details and emergency number' }, note: { he: 'טרם נרכש', en: 'Not bought yet' }, aliases: { he: ['פוליסת ביטוח נסיעות'], en: ['Travel insurance policy'] } },
    { key: 'first-address', group: 'documents', name: { he: 'כתובת הלינה הראשונה בבנגקוק באנגלית', en: 'First Bangkok stay address in English' }, note: { he: 'גם בתאית, אם אומתה', en: 'In Thai too, if checked' } },
    { key: 'driving-permit', group: 'documents', name: { he: 'רישיון נהיגה בינלאומי', en: 'International driving permit' }, note: { he: 'רק אם מתכננים לנהוג', en: 'Only if you plan to drive' }, verify: true },
    { key: 'credit-card', group: 'money', name: { he: 'כרטיס אשראי', en: 'Credit card' } },
    { key: 'backup-card', group: 'money', name: { he: 'כרטיס נוסף לגיבוי', en: 'Backup card' } },
    { key: 'cash', group: 'money', name: { he: 'מזומן לימים הראשונים', en: 'Cash for the first days' } },
    { key: 'esim', group: 'comms', name: { he: 'eSIM או כרטיס SIM', en: 'eSIM or SIM card' } },
    // Digital preparations, 2-3 days before the flight
    { key: 'checkin-online', group: 'offline', name: { he: "צ'ק-אין אונליין וכרטיס עלייה שמור אופליין", en: 'Online check-in, boarding pass saved offline' }, aliases: { he: ['כרטיסי עלייה למטוס שמורים בטלפון'], en: ['Boarding passes saved on the phone'] } },
    { key: 'bookings-offline', group: 'offline', name: { he: 'אישורי הזמנות שמורים בטלפון', en: 'Booking confirmations saved on the phone' } },
    { key: 'downloads', group: 'offline', name: { he: 'סרטים, סדרות, מוזיקה ופודקאסטים להורדה', en: 'Films, series, music and podcasts downloaded' }, note: { he: 'לטיסות הלוך וחזור', en: 'For both flights' }, aliases: { he: ['סרטים, מוזיקה או ספרים להורדה'], en: ['Films, music or books downloaded'] } },
    { key: 'offline-maps', group: 'offline', name: { he: 'מפות אופליין לבנגקוק וליעדים במסלול', en: 'Offline maps for Bangkok and the route' }, aliases: { he: ['מפות שעובדות בלי קליטה'], en: ['Offline maps'] } },
    { key: 'police-app', group: 'offline', name: { he: 'אפליקציית Thailand Tourist Police', en: 'Thailand Tourist Police app' }, note: { he: 'רק מהמקור הרשמי, אחרי בדיקה', en: 'Only from the official source, after checking' }, verify: true },
    { key: 'emergency-numbers', group: 'offline', name: { he: 'מספרי חירום שמורים בטלפון', en: 'Emergency numbers saved on the phone' }, note: { he: 'טרם אומת: אמבולנס 1669, משטרה 191, כיבוי אש 199, משטרת תיירים 1155, מידע תיירותי 1672', en: 'Not verified: ambulance 1669, police 191, fire 199, tourist police 1155, tourist info 1672' }, verify: true },
    { key: 'translator', group: 'offline', name: { he: 'מתרגם שעובד בלי קליטה', en: 'Translator that works offline' } },
    { key: 'app-backup', group: 'offline', name: { he: 'קובץ גיבוי של האפליקציה', en: 'App backup file' } },
    { key: 'phone-space', group: 'offline', name: { he: 'מקום פנוי בטלפון לתמונות ולקבצים', en: 'Free space on the phone for photos and files' } },
    { key: 'charge-phone', group: 'offline', name: { he: 'טעינת הטלפון והמטען הנייד', en: 'Phone and power bank charged' } },
    // On the flight day
    { key: 'day-check', group: 'flightDay', name: { he: 'דרכון, ארנק, טלפון, כרטיס טיסה ותיק יד', en: 'Passport, wallet, phone, ticket and carry-on' } },
    { key: 'home-check', group: 'flightDay', name: { he: 'בדיקת הבית לפני היציאה', en: 'Check the house before leaving' } },
    { key: 'leave-early', group: 'flightDay', name: { he: 'לצאת לשדה מספיק מוקדם', en: 'Leave for the airport early enough' }, note: { he: 'לפי שעת הטיסה והנחיות חברת התעופה. 3 שעות לפני טיסה בינלאומית היא הערכה, לא כלל', en: 'By the flight time and airline advice. 3 hours before an international flight is an estimate, not a rule' }, verify: true },
    // Carry-on
    { key: 'carry-basics', group: 'carryOn', name: { he: 'דרכון, ארנק וטלפון', en: 'Passport, wallet and phone' } },
    { key: 'carry-charger', group: 'carryOn', name: { he: 'כבל טעינה ומטען נייד', en: 'Charging cable and power bank' }, aliases: { he: ['מטען לטלפון', 'סוללה ניידת'], en: ['Phone charger', 'Power bank'] } },
    { key: 'headphones', group: 'carryOn', name: { he: 'אוזניות', en: 'Headphones' } },
    { key: 'carry-medicine', group: 'carryOn', name: { he: 'תרופות קבועות באריזה מתאימה', en: 'Regular medicine, packed properly' }, aliases: { he: ['תרופות אישיות (לפי הרופא)'], en: ['Personal medicine (as your doctor says)'] } },
    { key: 'glasses', group: 'carryOn', name: { he: 'משקפיים או משקפי שמש', en: 'Glasses or sunglasses' } },
    { key: 'house-keys', group: 'carryOn', name: { he: 'מפתחות לבית', en: 'House keys' } },
    // Comfort and sleep on the plane
    { key: 'neck-pillow', group: 'flightComfort', name: { he: 'כרית צוואר', en: 'Neck pillow' } },
    { key: 'warm-layer', group: 'flightComfort', name: { he: 'צעיף גדול או שכבה חמה', en: 'A large scarf or a warm layer' }, aliases: { he: ['שכבה חמה למטוס'], en: ['A warm layer for the plane'] } },
    { key: 'eye-mask', group: 'flightComfort', name: { he: 'כיסוי עיניים', en: 'Eye mask' } },
    { key: 'earplugs', group: 'flightComfort', name: { he: 'אטמי אוזניים', en: 'Earplugs' } },
    { key: 'socks', group: 'flightComfort', name: { he: 'גרביים עבים או נעליים נוחות', en: 'Thick socks or comfortable shoes' }, aliases: { he: ['גרביים נוחות'], en: ['Comfortable socks'] } },
    { key: 'long-shirt', group: 'flightComfort', name: { he: 'חולצה ארוכה דקה וחולצה להחלפה', en: 'A thin long shirt and a spare shirt' } },
    // Food and drinks for the flight
    { key: 'snacks', group: 'flightFood', name: { he: 'חטיפים לטיסה', en: 'Snacks for the flight' } },
    { key: 'gum', group: 'flightFood', name: { he: 'מסטיק או סוכריות', en: 'Gum or sweets' } },
    { key: 'bottle', group: 'flightFood', name: { he: 'בקבוק ריק למילוי אחרי הבידוק', en: 'Empty bottle to fill after security' }, note: { he: 'לפי כללי שדה התעופה', en: 'As the airport rules allow' }, verify: true },
    { key: 'meal', group: 'flightFood', name: { he: 'ארוחה, אם היא לא כלולה בכרטיס', en: 'A meal, if the ticket has none' }, verify: true },
    // Hygiene and health on the plane
    { key: 'lotion', group: 'hygiene', name: { he: 'קרם לחות ושפתון', en: 'Moisturiser and lip balm' } },
    { key: 'wipes', group: 'hygiene', name: { he: 'מגבונים וחומר לחיטוי ידיים', en: 'Wipes and hand sanitiser' } },
    { key: 'eye-drops', group: 'hygiene', name: { he: 'טיפות עיניים או תרסיס אף', en: 'Eye drops or nasal spray' }, note: { he: 'רק אם רלוונטי לך', en: 'Only if relevant to you' } },
    { key: 'liquids-bag', group: 'hygiene', name: { he: 'שקית נוזלים', en: 'Liquids bag' }, note: { he: 'לפי כללי הביטחון בשדה', en: 'As the airport security rules say' }, verify: true },
    // Checked bag
    { key: 'bag-clothes', group: 'checkedBag', name: { he: 'בגדים, נעליים ומוצרי טיפוח', en: 'Clothes, shoes and toiletries' } },
    { key: 'bag-limits', group: 'checkedBag', name: { he: 'מגבלות משקל ומידות של חברת התעופה', en: 'Airline weight and size limits' }, note: { he: 'לפי הכרטיס שלכם. לא מניחים משקל קבוע', en: 'As your ticket says. No fixed weight assumed' }, verify: true },
    { key: 'lithium-carry', group: 'checkedBag', name: { he: 'מטען נייד וסוללות ליתיום רק בתיק היד', en: 'Power bank and lithium batteries in the carry-on only' }, note: { he: 'לפי כללי חברת התעופה', en: 'As the airline rules say' }, verify: true },
    { key: 'valuables-carry', group: 'checkedBag', name: { he: 'דרכון, כסף, תרופות חיוניות וציוד יקר בתיק היד', en: 'Passport, money, vital medicine, valuables in the carry-on' } },
    { key: 'first-aid', group: 'health', name: { he: 'ערכת עזרה ראשונה', en: 'First aid kit' } },
    { key: 'sunscreen', group: 'health', name: { he: 'קרם הגנה', en: 'Sunscreen' } },
    { key: 'repellent', group: 'health', name: { he: 'דוחה יתושים', en: 'Insect repellent' } },
    { key: 'light-clothes', group: 'clothing', name: { he: 'בגדים קלים', en: 'Light clothes' } },
    { key: 'swimwear', group: 'clothing', name: { he: 'בגד ים', en: 'Swimwear' } },
    { key: 'sandals', group: 'clothing', name: { he: 'כפכפים או סנדלים', en: 'Flip-flops or sandals' } },
    { key: 'temple-clothes', group: 'clothing', name: { he: 'לבוש לביקור במקדשים', en: 'Clothes for temple visits' }, verify: true },
    { key: 'plug-adapter', group: 'chargers', name: { he: 'מתאם לשקע החשמל', en: 'Plug adapter' }, verify: true },
    // After landing in Bangkok
    { key: 'bag-arrived', group: 'afterLanding', name: { he: 'המזוודה הגיעה? אם לא, לדווח מיד', en: 'Bag arrived? If not, report it at once' } },
    { key: 'esim-activate', group: 'afterLanding', name: { he: 'הפעלת eSIM או SIM, אם נרכש', en: 'Turn on the eSIM or SIM, if bought' } },
    { key: 'show-address', group: 'afterLanding', name: { he: 'כתובת הלינה מוכנה להצגה לנהג', en: 'Stay address ready to show the driver' } },
    { key: 'cash-arrival', group: 'afterLanding', name: { he: 'משיכת כסף או החלפה לפי הצורך', en: 'Withdraw or change money as needed' } },
  ],
  taskSeed: [
    { title: { he: 'הזמנת טיסות', en: 'Book flights' } },
    { title: { he: 'ביטוח נסיעות', en: 'Travel insurance' } },
    { title: { he: 'בדיקת דרישות כניסה', en: 'Check entry requirements' } },
    { title: { he: 'הזמנת לינה', en: 'Book stays' } },
    { title: { he: 'תכנון מעברים', en: 'Plan transfers' } },
    { title: { he: 'הכנת אמצעי תשלום', en: 'Prepare payment methods' } },
    { title: { he: 'בדיקת מסמכים', en: 'Check documents' } },
  ],
});
