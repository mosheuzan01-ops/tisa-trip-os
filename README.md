# TISA — Trip OS (Experimental: Thailand)

אב־טיפוס ניסיוני של TISA: מערכת הפעלה אחת לתכנון וניהול טיול.
הגרסה הזו מכוונת לתאילנד, אבל בנויה כך שמוסיפים מדינה בקובץ נתונים, בלי לגעת בקוד.

**סטטוס:** שלב 2 נגמר. מה כבר בנוי:
- מסך הבית המלוטש מכל הקודם.
- מבנה נתונים אחד עם גרסה (`tisa:v1`), עם שמירה אוטומטית והמרה מהפורמט הקודם.
- ניתוב לפי כתובת (`#/settings` וכו').
- הגדרות עם גיבוי, ייבוא ואיפוס.
- עבודה בלי קליטה (Service Worker) והתקנה למסך הבית.

המסכים של מסלול, כסף, צ'ק ליסט, מעברים, מידע ועוזר מופיעים כמסכים ריקים, ולכל אחד רשום השלב שבו הוא נבנה.

## הרצה
דרוש Node.js 18 ומעלה (חינמי). אין תלויות להתקנה, אין צורך ב-`npm install`.

```bash
npm start      # האתר: http://localhost:8080   ערכת המותג: http://localhost:8080/brand.html
npm run phone  # כמו start, וגם ברשת הביתית: מדפיס כתובת לפתוח בטלפון באותו Wi-Fi
npm test       # כל הבדיקות
node scripts/qa/stage2-browser.cjs   # בדיקות דפדפן לשלב 2 (צריך Playwright מותקן במחשב; לא תלות של הפרויקט)
```

פורט אחר: `PORT=3000 npm start` (ב-Windows PowerShell: `$env:PORT=3000; npm start`).
`npm start` מאזין רק ל-127.0.0.1. `npm run phone` פותח גם לרשת הביתית בלבד (לא לאינטרנט); עצרו אותו עם Ctrl+C בסיום.

אפשר גם לפתוח את `index.html` ישירות בדפדפן: הכותרת תופיע, אבל הדפדפן חוסם טעינת מודולים
ו-JSON מ-`file://`, ולכן הנתונים מההגדרות לא ייטענו. לעבודה רגילה השתמשו ב-`npm start`.

## מבנה
```
index.html              דף הכניסה (עברית, RTL)
config/app.config.json  הגדרות האפליקציה: שם, שפת ברירת מחדל, מדינה פעילה
data/countries/<id>.json נתוני מדינה (שם, מטבע, אזור זמן, לוקאל לתאריכים)
data/packs/<id>.js      חבילת מדינה: ברירות מחדל לתכנון (יעדים, פרופילי תקציב, שערי תכנון)
manifest.webmanifest    התקנה למסך הבית; icons/ אייקוני האפליקציה
sw.js                   עבודה בלי קליטה: עותק מלא של האפליקציה במכשיר
locales/<lang>.json     טקסטים לפי שפה (he פעיל, en שלד), כולל כיוון rtl/ltr
src/js/core/            לוגיקה טהורה, בלי DOM, נבדקת ב-Node (storage.js היא שכבת השמירה היחידה)
src/js/app.js           חיבור ההגדרות והנתונים לדף
src/css/tokens.css      המקור היחיד לצבעים (בהיר/כהה), טיפוגרפיה, ריווח ותנועה
src/css/main.css        רכיבים, Mobile-First
brand.html              ערכת המותג (src/css/brand.css, src/js/brand.js)
assets/                 גופנים מקומיים (OFL) ואייקוני SVG מקוריים; ראו CREDITS.md
tests/                  בדיקות (node:test המובנה, בלי ספריות)
scripts/serve.js        שרת סטטי מקומי, בלי תלויות
docs/evidence/          הוכחות ריצה (צילום מסך, בדיקת דפדפן)
docs/BACKUP_FORMAT.md   פורמט קובץ הגיבוי (חוזה)
docs/RULES.md           כללי עבודה קבועים
```

## הוספת מדינה
1. צרו `data/countries/<id>.json` באותו מבנה כמו `th.json`.
2. שנו את `activeCountry` ב-`config/app.config.json`.
3. הריצו `npm test`. הבדיקות מוודאות שהקובץ תקין.

## כללי הפרויקט
- אפס עלות ואפס תלויות. בלי CDN, בלי Tailwind, בלי שירותים בתשלום.
- בלי מפתחות או סודות בקוד. אם יידרשו בעתיד: `.env` (כבר ב-`.gitignore`).
- שמירה מקומית בלבד (localStorage, בשלבים הבאים). בלי שרת, בלי אנליטיקס, בלי קוקיז.
- בלי מחירים, שערים או תאריכים מומצאים. כל נתון כזה יהיה ניתן לעריכה.
- בדיקות נכתבות לפני קוד חישוב (תקציב, מטבע, תאריכים).
- חלק מהכללים נאכפים אוטומטית ב-`tests/project-rules.test.js`.

ראו גם: [SESSION_2_SUMMARY.md](SESSION_2_SUMMARY.md), [docs/CONNECTORS.md](docs/CONNECTORS.md), [GOALS.md](GOALS.md) (ליטוש; קודמים: docs/GOALS_STAGE0.md, docs/GOALS_STAGE1.md, docs/GOALS_TRIP_SETUP.md), [SESSION_1_SUMMARY.md](SESSION_1_SUMMARY.md), [SESSION_0_SUMMARY.md](SESSION_0_SUMMARY.md), [CREDITS.md](CREDITS.md).
