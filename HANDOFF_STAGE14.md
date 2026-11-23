# מסירה: שלב 14 (LATISA 1.1.0, ‏Supabase)

## פרויקט ויעד
- **LATISA / TRIPILOT:** אפליקציה אחת. המאגר: `mosheuzan01-ops/tisa-trip-os`.
- **שלב 14:** כניסה (Supabase Auth, מייל וסיסמה), סנכרון local-first, שיתוף טיול עם חברים ומסך אדמין.
  - הכול על האפליקציה הקיימת, ובעלות 0 ₪.
  - **בלי חשבון, 1.1.0 מתנהגת כמו 1.0.1.**

## מצב
- **main:** ‏1.0.1 (`965b92d`).
- **הענף:** `claude/eager-allen-ooe3kx`, מ-main. **אין PR ואין מיזוג.** בעל המוצר מחליט.
- **גרסה:** 1.1.0 ב-`package.json`, ב-`config/app.config.json` וב-`sw.js`.
- **Supabase:** **לא נוצר פרויקט.** ‏`config.cloud` ריק, ולכן באתר הכרטיס אומר "הסנכרון לענן עוד לא הוגדר". שום דבר לא נטען מהרשת.
- **בדיקות:**
  - `npm test` ‏495/495, ‏×3.
  - RLS מקומי 53/53, ‏×3.
  - הרגרסיה בדפדפן: 119 מתוך 120 עם exit 0. החריגה היחידה היא באג המתנה בבדיקה של שלב 14. תוקן, ואחריו 3/3 ברצף.
  - **הפירוט:** `docs/evidence/stage14/README.md` ו-`docs/GOALS_STAGE14.md`.

## מה נבנה (קבצים)
- **מסד נתונים:**
  - `supabase/migrations/0001_stage14_init.sql`: טבלאות, RLS, ופונקציות שהאפליקציה קוראת להן.
  - `supabase/tests/rls_check.sql`: ‏53 בדיקות, וביטול מלא בסוף.
  - `supabase/tests/local-auth-stub.sql`: לבדיקה מקומית בלבד.
  - `scripts/qa/stage14-rls-local.cjs` ו-`scripts/qa/lib/pg-local.cjs`.
- **ליבה (Node):**
  - `src/js/core/sync-map.js`: המיפוי, משותף מול אישי.
  - `src/js/core/sync-engine.js`: סנכרון, LWW ועותקים.
  - `src/js/core/cloud-api.js`: שכבה דקה מעל supabase-js, עם סיווג שגיאות.
  - `src/js/core/storage.js`: מפתחות `latisa:*` ואחסון הסשן.
- **ממשק:**
  - `src/js/cloud-view.js`: הכרטיס "החשבון והטיולים שלי", חלונות, סנכרון ומחוון.
  - `src/js/admin-view.js`: נטען ב-`import()` רק לאדמין.
  - `index.html`: CSP, מחוון, כרטיס ותבנית חלונות.
  - `src/css/main.css`.
  - `locales/*.json`.
  - `src/js/app.js`: חיבור, ונעילת תאריכים לחבר.
  - `src/js/itinerary-view.js`: נעילת "תכנון מחדש".
- **ספרייה:**
  - `vendor/supabase/supabase-js-2.119.2.umd.js`: נעולה ב-SHA-256 וב-SRI.
  - רישיונות: `vendor/supabase/LICENSE` ו-`THIRD_PARTY_LICENSES.txt`.
  - `CREDITS.md`.
- **בדיקות:**
  - `tests/stage14-vendor.test.js`
  - `tests/stage14-sync.test.js`
  - `tests/stage14-rules.test.js`
  - `tests/fakes/fake-cloud.js`
  - `scripts/qa/stage14-browser.cjs` ו-`scripts/qa/lib/fake-supabase.cjs`
- **שינויי בדיקות קיימות (עם סיבה):**
  - **G14:** "password" ו-"token" מותרים רק בקובצי הכניסה. במקום זה: S14-8.
  - **G9, ‏B19 ו-S2:** חריגה מדויקת לתג ה-CSP בלבד.
  - **BT-13:** רצפת גרסה 1.0.1, וגרסה זהה בשלושת המקומות.
- **מסמכים:**
  - `docs/BACKEND_HE.md`: הקמה, מפתחות, אדמין, השהיה, גיבוי ועלויות.
  - `docs/INSTALL_HE.md`: סעיף 9.
  - `docs/GOALS_STAGE14.md`
  - `docs/RULES.md`: חריגות שלב 14.
  - `docs/FREEZE.md`, ‏`docs/BACKUP_FORMAT.md` ו-`docs/FEATURES_TRIPILOT.md`.
  - טקסט הפרטיות בהגדרות.

## החלטות של בעל המוצר
ראו `docs/GOALS_STAGE14.md`. בקצרה:
- **מייל:** בלי אישור מייל, ואיפוס סיסמה ידני לחברים.
- **ספרייה:** 2.119.2, מקומית.
- **מפתחות:** קידומת `latisa:` למפתחות החדשים בלבד.
- **משותף ואישי:** לפי הטבלה.
- **תאריכים:** רק בעל הטיול.
- **אדמין:** ב-SQL ידני בלבד.
- **CSP:** כן.
- **תמונות:** במכשיר. אלבום: שלב נפרד, לא נבנה.
- **אזור:** Frankfurt.
- **גרסה:** 1.1.0.

## שינויי התנהגות שנמצאו בבדיקות ותוקנו
- **יצירת טיול:** `trips_select` מאפשר גם לבעלים (`owner_id = me`). בלי זה, ‏`INSERT ... ON CONFLICT` נכשל לפני שה-trigger מוסיף את הבעלים כחבר. נמצא בבדיקה המקומית.
- **העותק לפני העברה:** `latisa:premigration:v1` נשמר **לפני** שההורדה של הגיבוי משנה את `lastBackupAt`. כך הוא הטקסט המדויק.
- **הצעת "גיבוי והעברה":** מופיעה לבד רק בטלפון הראשון של החשבון, כשאין עוד טיול בענן. בטלפון נוסף מעבירים ב"העברה לחשבון". כך לא עולה בטעות טיול ברירת מחדל ריק.
- **"שינוי סיסמה":** נוסף, כדי שחבר שקיבל סיסמה זמנית מהמנהל יוכל להחליף אותה.

## פתוח (לא נעשה, ולמה)
- **פרויקט Supabase אמיתי:** בעל המוצר, לפי `docs/BACKEND_HE.md`. אחריו:
  - להריץ `rls_check.sql` ולשלוח צילום.
  - לשלוח את Project URL ואת ה-publishable key, כדי להכניס אותם ל-`config/app.config.json`.
- **אלבום תמונות משותף:** שלב נפרד באישור נפרד. הטיוטה בתוכנית v2.1, מחוץ למאגר.
- **בדיקות ידניות:** הרשימה ב-`docs/GOALS_STAGE14.md`.
- **אחרי מיזוג, ובאישור:** תג `v1.1.0`.

## כללים לשמור
- `docs/RULES.md`, כולל חריגות שלב 14.
- **מפתחות:** `tisa:*` לא משתנים לעולם. החדשים רק ב-`latisa:*`, ורק דרך `storage.js`.
- **מפתחות Supabase:** אין מפתח סודי, `service_role` או סיסמת מסד בשום מקום. המפתח הציבורי מותר ב-config בלבד.
- **אבטחה:** RLS בלבד. אדמין רק ידני.
- **TDD:** ה-red הוא assertion שנכשל. 3 ריצות. ראיות ב-`docs/evidence/stage14/`.
