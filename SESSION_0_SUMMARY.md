# SESSION 0 SUMMARY — TISA Trip OS (Experimental: Thailand)

> מוכן להדבקה בתחילת סשן שלב 1.

## מה נעשה
שלב 0 בלבד: הקמה ובטיחות. לא התחלנו אף פיצ'ר של שלב 1.

- פרויקט חדש בתיקייה `tisa-trip-os/` עם git מקומי (בלי remote, לא נדחף לשום מקום).
- אפס תלויות: רק Node.js מובנה. `npm start` מריץ שרת סטטי מקומי (`scripts/serve.js`), `npm test` מריץ `node --test`.
- דף שלד בעברית, `lang="he" dir="rtl"`, Mobile-First, שמציג "TISA — Experimental — תאילנד".
- הפרדה בין שכבות:
  - הגדרות: `config/app.config.json` (שם, תווית, שפת ברירת מחדל, מדינה פעילה, קידומת ל-localStorage).
  - נתונים: `data/countries/th.json` (שם המדינה בעברית/אנגלית, קוד מטבע THB, אזור זמן Asia/Bangkok, לוקאל לתאריכים). אין בו מחירים, שערים או תאריכים.
  - שפה: `locales/he.json` (פעיל), `locales/en.json` (שלד עם אותם מפתחות), כולל `dir`.
  - לוגיקה טהורה: `src/js/core/` (i18n, ולידציית מדינה, בניית כותרת). תצוגה: `src/js/app.js`, `src/css/main.css`.
- בדיקות: 12 בדיקות, כולל "שומרי כללים" שנכשלים אם מישהו מוסיף CDN, מפתח, קוקי/אנליטיקס, תלות, נתוני מדינה בתוך הקוד, או מחיר/תאריך בנתונים. וידאנו שהשומר באמת נכשל כשמכניסים קישור CDN, ואז החזרנו.

## טבלת PASS/FAIL (מתוך GOALS.md)
| # | קריטריון | תוצאה | הוכחה |
|---|-----------|--------|--------|
| G1 | README, GOALS, .gitignore, SESSION_0_SUMMARY בשורש | PASS | `ls -a` (ב-`docs/evidence/git-check.txt`) |
| G2 | מבנה תיקיות | PASS | `ls -d */` (ב-`docs/evidence/git-check.txt`) |
| G3 | `.gitignore` מתעלם מ-`.env` ו-`node_modules` | PASS | `git check-ignore -v` (ב-`docs/evidence/git-check.txt`) |
| G4 | git מקומי, commit ראשון, בלי remote | PASS | `git log`, `git remote -v` ריק (ב-`docs/evidence/git-check.txt`) |
| G5 | אפס תלויות | PASS | בדיקה `G5` ב-`docs/evidence/npm-test.txt` |
| G6 | `npm test` עובר | PASS | `tests 12, pass 12, fail 0` ב-`docs/evidence/npm-test.txt` |
| G7 | הדף מציג "TISA — Experimental — תאילנד" | PASS | `"h1"` ב-`docs/evidence/browser-check.json` + `stage0-mobile-360.png` |
| G8 | עברית ו-RTL | PASS | בדיקה `G8` + `"dir": "rtl"` בבדיקת הדפדפן |
| G9 | בלי CDN / משאבים חיצוניים | PASS | בדיקה `G9` + `"externalRequests": []` בבדיקת הדפדפן |
| G10 | אפס שגיאות קונסול (דרך `npm start`) | PASS | `"consoleErrors": []` תחת `served` |
| G11 | נתוני תאילנד בקובץ נפרד | PASS | בדיקה `G11` |
| G12 | שפה/מטבע/אזור זמן בהגדרות | PASS | בדיקה `G12` |
| G13 | בלי גלילה אופקית ב-360px | PASS | `"noHScroll": true` בבדיקת הדפדפן |
| G14 | בלי סודות בקוד | PASS | בדיקה `G14 + G15` + grep ללא תוצאות |
| G15 | בלי אנליטיקס/קוקיז | PASS | בדיקה `G14 + G15` |
| G16 | בלי מחירים/תאריכים מומצאים | PASS | בדיקה `G16` |
| G17 | טלפון אמיתי, Safari/Firefox | לא נבדק | ראו למטה |

## מה לא נבדק, ולמה
- **G17, טלפון אמיתי ודפדפנים אחרים:** הבדיקה רצה רק ב-Chromium headless ברוחב 360px. אין לנו גישה ל-iPhone/Android או ל-Safari/Firefox. צריך לפתוח ידנית.
- **פתיחה ישירה של `index.html` (file://):** הכותרת מוצגת, אבל הדפדפן חוסם מודולי JS מ-`file://`, אז הנתונים מההגדרות לא נטענים ויש 2 שגיאות CORS בקונסול (מתועד ב-`browser-check.json` תחת `file`). זו התנהגות צפויה של הדפדפן; הדרך הנתמכת היא `npm start`.
- **Windows/macOS:** הפקודות נבדקו רק בלינוקס (Node 22). אמורות לעבוד ב-Node 18+ בכל מערכת, אבל לא נבדק.
- **נגישות מלאה (קורא מסך, ניגודיות):** לא נבדקה בכלי ייעודי.

## החלטות שכדאי לדעת בשלב 1
- מודולי ES ו-`fetch` ל-JSON. לכן צריך שרת מקומי (`npm start`), לא `file://`.
- כל טקסט למשתמש עובר דרך `locales/*.json`. מפתח חסר מוצג כשם המפתח, כדי שפערים ייראו.
- הכותרת מורכבת מ"מותג" לטיני ומשם מקום מקומי, עם `<bdi dir="ltr">` כדי למנוע בלבול כיווניות.
- `storageKeyPrefix: "tisa:"` שמור ל-localStorage בשלב 1.
- מטבע ואזור זמן הם נתוני מדינה; פורמט תאריך יגיע מ-`Intl` לפי `dateFormatLocale`. שערי מטבע ומחירים לא קיימים ולא יומצאו: בשלב 1 הם יהיו קלט שהמשתמש עורך.

## לפני שמתחילים שלב 1: חסר
המקורות נמצאים בפרויקט "בניית אתרים" ואין לסשן הזה גישה אליהם. **צריך להדביק בתחילת סשן שלב 1:**
1. תוכנית העבודה ל-Claude Code ולוח הזמנים (במקרה של סתירה, היא קובעת).
2. פרומפט שלב 1 של TISA: 8 הפיצ'רים, האיסורים ו-18 הבדיקות.

לא ניחשנו את התוכן שלהם. GOALS.md של שלב 1 ייכתב רק אחרי שיודבקו.

## איך פותחים
```bash
cd tisa-trip-os
npm start        # http://localhost:8080
npm test
```
