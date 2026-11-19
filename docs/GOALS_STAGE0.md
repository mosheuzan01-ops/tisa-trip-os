# GOALS — סשן 0 (הקמה ובטיחות)

## מטרת הסשן (משפט אחד)
להקים בסיס נקי, בטוח וחינמי לאב־טיפוס TISA — Experimental — תאילנד: מבנה תיקיות, תיעוד, git מקומי, תשתית בדיקות שרצה ודף שלד בעברית שנפתח בדפדפן, בלי להתחיל אף פיצ'ר של שלב 1.

## קריטריונים (PASS / FAIL)
כל שורה מסומנת PASS רק אם יש לה פלט ריצה אמיתי. אחרת "לא נבדק".

| # | קריטריון | איך בודקים | תוצאה |
|---|-----------|-------------|--------|
| G1 | קיימים README.md, GOALS.md, .gitignore, SESSION_0_SUMMARY.md בשורש | `ls -a` | PASS |
| G2 | מבנה תיקיות: `src/`, `data/`, `locales/`, `config/`, `tests/`, `scripts/`, `docs/` | `ls -d */` | PASS |
| G3 | `.gitignore` מתעלם מ-`.env` ו-`node_modules/` | `git check-ignore -v .env node_modules/x` | PASS |
| G4 | git מקומי עם commit ראשון, בלי remote | `git log --oneline`, `git remote -v` ריק | PASS |
| G5 | אפס תלויות: אין `dependencies`/`devDependencies` ואין `node_modules` | בדיקה אוטומטית + `ls node_modules` נכשל | PASS |
| G6 | `npm test` רץ ועובר (0 כשלונות) | פלט `node --test` | PASS |
| G7 | דף השלד מציג "TISA — Experimental — תאילנד" | Chromium headless, טקסט ה-`h1` | PASS |
| G8 | `<html lang="he" dir="rtl">` וכיוון מחושב RTL בדפדפן | בדיקה אוטומטית + `getComputedStyle` בדפדפן | PASS |
| G9 | בלי CDN ובלי משאב חיצוני: אף `http(s)://` ב-HTML/CSS/JS | בדיקה אוטומטית + רשימת בקשות רשת בדפדפן | PASS |
| G10 | אפס שגיאות בקונסול בטעינת הדף | Chromium headless, האזנה ל-console/pageerror (דרך `npm start`) | PASS |
| G11 | נתוני תאילנד בקובץ נתונים נפרד (`data/countries/th.json`), לא בקוד | בדיקה אוטומטית: הקוד לא מכיל "תאילנד" / "THB" | PASS |
| G12 | שפה, מטבע, אזור זמן ופורמט תאריך מוגדרים בהגדרות (`config/app.config.json`, `locales/*.json`) | בדיקה אוטומטית של סכמת ההגדרות | PASS |
| G13 | Mobile-First: ללא גלילה אופקית ברוחב 360px | Chromium headless, `scrollWidth <= clientWidth` | PASS |
| G14 | אין מפתחות/סיסמאות/טוקנים בקוד | `grep` לדפוסים נפוצים | PASS |
| G15 | אין אנליטיקס, קוקיז או שמירת מידע אישי | `grep` ל-`document.cookie`, `gtag`, `analytics` | PASS |
| G16 | לא נוצרו מחירים או תאריכים מומצאים | בדיקה אוטומטית: אין שדות מחיר/תאריך בנתונים | PASS |
| G17 | הדף נראה תקין בטלפון אמיתי ובדפדפנים שונים (Safari/Firefox) | ידנית | לא נבדק |

ההוכחות לכל שורה נמצאות ב-`SESSION_0_SUMMARY.md` ובפלט הבדיקות ב-`docs/evidence/`.

## מחוץ לתחום של הסשן הזה
- כל 8 הפיצ'רים של שלב 1 (התוכן המדויק שלהם נמצא בפרומפט שלב 1, שעוד לא הודבק לסשן הזה).
- קוד חישוב כלשהו (תקציב, המרת מטבע, תאריכים). הבדיקות שלו ייכתבו לפניו, בשלב 1.
- מחירים, שערי מטבע, תאריכים או טיפים כלשהם.
- Service Worker / PWA / מצב אופליין.
- תרגום לאנגלית (יש רק קובץ שלד `locales/en.json`).
- פרסום, דומיין, git מרוחק, חיבור חשבונות, App Store / Google Play.
