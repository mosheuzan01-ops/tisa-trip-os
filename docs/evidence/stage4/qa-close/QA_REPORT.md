# QA: סיום שלב 4 (0.4.2, main @ 30f565a, 2026-11-19)

**FAIL: 0 | WARN: 1 | KNOWN: 4 | NOT CHECKED: 4**

| תחום | בדיקה | סטטוס | הוכחה |
|------|-------|-------|-------|
| נייד | 360, 390, 768 ו-1280 בבהיר ובכהה: בלי גלילה הצידה, RTL, יעדי הקשה של 44px ומעלה, טקסט מינימלי של 14px, גוף 16px | PASS | `qa-live-summary.json`, `qa-live/` |
| נגישות | ניגודיות מחושבת: 0 חריגות. 14 טקסטים על מתכת או גרדיאנט נבדקו דרך הטוקנים (S6) | PASS | `qa-live-summary.json` |
| נגישות | מקלדת: פוקוס נראה, החלון שומר את הפוקוס בפנים, Esc סוגר ומחזיר את הפוקוס | PASS | `qa-live-summary.json` |
| נגישות | reduced-motion | WARN | הסורק קורא רק HTML. בפועל זה מטופל ב-`src/css/main.css` וב-`app.js` |
| קישורים | 0 קישורים חיצוניים, 0 בקשות חיצוניות | PASS | `static-scan-*.txt`, `runs/` |
| SEO | h1=5 (אחת לכל מסך), `#/home` ו-`#/settings`, שדה קובץ מוסתר | KNOWN | כלל 7 ב-`docs/RULES.md` |
| SEO | brand.html | PASS | `static-scan-brand.html.txt` |
| פונקציונלי | `npm test` 130/130. stage4: 11, 7 ו-9, כל אחת ×3. stage2: 12. stage3: 10. stage3-polish: 3 | PASS | `npm-test.txt`, `runs/`, `stage2/`, `stage3-*.json` |
| תוכן | אין lorem, TODO או `console.log`. מספרים לא מאומתים מסומנים כהערכה | PASS | grep |

**לא נבדק:**
- האתר החי, כי github.io חסום מהסביבה.
- PageSpeed.
- אייפון אמיתי.
- מצב טיסה במכשיר אמיתי. נבדק רק `setOffline` ב-Chromium.
