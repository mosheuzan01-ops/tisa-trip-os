# שלב 14, צעד 1: ספריית Supabase מקומית ונעולה (ראיות)

תאריך: 2026-11-23. הענף: `claude/eager-allen-ooe3kx`, מ-main ‏(`965b92d`, ‏1.0.1).

## מה נוסף
- `vendor/supabase/supabase-js-2.119.2.umd.js`: הקובץ `package/dist/umd/supabase.js` מתוך ה-tarball של `@supabase/supabase-js@2.119.2`, בלי שום שינוי.
- `vendor/supabase/LICENSE` (MIT, ‏Supabase) ו-`vendor/supabase/THIRD_PARTY_LICENSES.txt` (‏phoenix, ‏iceberg-js, ‏tslib).
- `tests/stage14-vendor.test.js`: בדיקת שלמות קבועה (SHA-256 וגודל), רישיונות ו-CREDITS. הבדיקה גם מוודאת שהאפליקציה **עוד לא** טוענת את הקובץ.
- `CREDITS.md`: מקור, גרסה, רישיון ו-hash.

## מה לא השתנה
- קוד האפליקציה, `index.html`, ‏`sw.js` וה-PRECACHE.
- הגרסה (1.0.1). היא תשתנה ל-1.1.0 כשהאפליקציה תתחיל להשתמש בספרייה.
- מפתחות האחסון ופורמט הגיבוי.
- אין `node_modules`, ואין תלות ב-`package.json` (G5).

## אימות (`verify.txt`)
| בדיקה | תוצאה |
|---|---|
| sha1 ו-sha512 של ה-tarball מול הרישום | זהים |
| חתימת npm (ECDSA) | `valid=true` |
| Provenance (SLSA v1) | ה-digest זהה ל-tarball. הבנייה: GitHub Actions של `supabase/supabase-js`, ‏`publish.yml`, ‏commit `02d2e8f1…` |
| Sigstore (שרשרת תעודות ויומן שקיפות) | **לא אומת קריפטוגרפית.** לזה צריך cosign או `npm audit signatures` |
| הקובץ במאגר מול הקובץ ב-tarball | `cmp` זהה. SHA-256 ‏`8816af04…c263`, ‏221,417 בתים |
| סריקה סטטית | אין `eval`, ‏`new Function`, ‏`import()` או `sendBeacon`. אין שרת קבוע. ה-tracing כבוי |

## הרצה בדפדפן, כשכל הרשת חסומה (`runtime-check.txt`)
- הקובץ נטען מהדיסק.
- `createClient` עבד בלי אף בקשה.
- כניסה מול שרת דמה מקומי:
  - הסשן נשמר **רק** במפתח `latisa:auth:v1`.
  - `localStorage` ו-`sessionStorage` נשארו ריקים.
  - **הסיסמה לא נשמרה בשום מקום.**
  - אחרי התנתקות, המפתח נמחק.
- 0 חיבורי WebSocket.
- הסקריפטים שהריצו את הבדיקות מצורפים כ-`.txt`.

## TDD ונעילה
- **red** (`red.txt`): ארבע assertions נכשלו לפני שהקבצים נוספו. V5 עבר.
- **green** (`green.txt`): 5/5.
- **הוכחת נעילה** (`tamper.txt`): שינוי של בייט אחד בקובץ הכשיל את V1 ("content changed"). הקובץ שוחזר, וה-hash חזר להיות המקורי.

## רגרסיה, 3 פעמים ברצף
- **`npm test`:** ‏461/461 בכל ריצה (456 קיימות ועוד 5 חדשות). הקבצים: `npm-test-run{1,2,3}.summary.txt`.
- **דפדפן:** 4 סקריפטים × 3 ריצות = 12/12 "ALL PASS" עם exit 0 (`browser/summary.txt`):
  - `stage7-offline-browser`: אופליין.
  - `stage13-release-browser`: אין בקשה החוצה, PWA וגיבוי.
  - `stage13-upgrade-browser`: שדרוג בלי אובדן נתונים.
  - `stage7-close-browser`: שמירת נתונים, C5.
- **צילומים:** לא צורפו, כי אין שינוי ויזואלי.
- הפלטים נשמרים כ-`.txt`, כי `.gitignore` מתעלם מ-`*.log` (כמו בשלבים קודמים).
