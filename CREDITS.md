# CREDITS — נכסים חיצוניים ורישיונות

כל נכס שלא נוצר בפרויקט הזה מופיע כאן עם מקורו ורישיונו. אין נכסים בתשלום ואין טעינה מרשת: הכול מקומי.

| נכס | קובץ בפרויקט | מקור | רישיון | קובץ הרישיון |
|------|---------------|-------|---------|----------------|
| Heebo (גופן משתנה, 100–900) | `assets/fonts/Heebo-VF.ttf` | github.com/google/fonts, תיקייה `ofl/heebo` (הפרויקט: github.com/OdedEzer/heebo) | SIL Open Font License 1.1 | `assets/fonts/OFL-Heebo.txt` |
| IBM Plex Mono Medium | `assets/fonts/IBMPlexMono-Medium.ttf` | github.com/google/fonts, תיקייה `ofl/ibmplexmono` | SIL Open Font License 1.1 | `assets/fonts/OFL-IBMPlexMono.txt` |
| FreeSerif Bold (GNU FreeFont, 1.1.5) | `assets/fonts/FreeSerifBold.ttf` | חבילת דביאן `fonts-freefont-ttf` 20211204+svn4273-2, הקובץ כמו שהוא, בלי שינוי (המקור: savannah.gnu.org/projects/freefont). SHA-256 ברישיון | GPL-3+ עם חריגת הגופן (font exception): הטמעה במסמך או באתר לא הופכת אותם ל-GPL | `assets/fonts/LICENSE-FreeFont.txt` |

רישיון OFL מתיר שימוש, הטמעה והפצה חינם, גם במוצר מסחרי, כל עוד קובץ הרישיון נשאר מצורף ולא מוכרים את הגופן עצמו בנפרד.

## ספריית Supabase (שלב 14, צעד 1, 2026-11-23)
| נכס | קובץ בפרויקט | מקור | רישיון | קובץ הרישיון |
|------|---------------|-------|---------|----------------|
| `@supabase/supabase-js@2.119.2` (קובץ UMD אחד) | `vendor/supabase/supabase-js-2.119.2.umd.js` | רישום npm (`registry.npmjs.org`), מתוך ה-tarball: `package/dist/umd/supabase.js`. מאגר המקור: github.com/supabase/supabase-js | MIT | `vendor/supabase/LICENSE` |
| קוד צד שלישי שארוז בתוך הקובץ: `@supabase/phoenix` 0.4.5, ‏`iceberg-js` 0.8.1, ‏`tslib` 2.8.1 | בתוך הקובץ שלמעלה | רישום npm | MIT, ‏MIT, ‏0BSD | `vendor/supabase/THIRD_PARTY_LICENSES.txt` |

- **SHA-256 של הקובץ:** `8816af04d9915dbba1882d6f84f0b402dc40268063a63d9c66d24f52f371c263` (221,417 בתים).
- **נעילה:** `tests/stage14-vendor.test.js` נכשלת אם הקובץ משתנה, אפילו בבייט אחד.
- **אין CDN ואין `npm install`:** אין `node_modules`, ואין תלות ב-`package.json`.
- **רישיון:** MIT מתיר שימוש והפצה חינם, כל עוד קובצי הרישיון נשארים מצורפים.
- **מקומי לגמרי:** הקובץ נטען מהאתר עצמו. בזמן ריצה הוא פונה רק לכתובת הפרויקט שתוגדר בשלב הבא.
- **בצעד 1 האפליקציה עוד לא טוענת אותו.**
- **רישום האימות:** `docs/evidence/stage14/step1-vendor/`. נבדקו:
  - התאמה ל-`dist.integrity` ול-`dist.shasum` של הרישום.
  - חתימת npm.
  - provenance מסוג SLSA v1 מ-GitHub Actions.
  - הרישיון.
  - סריקה של הקובץ.
  - הרצה בדפדפן כשכל הרשת חסומה.

## נוצר בפרויקט (לא נכס חיצוני)
- **אייקונים** (`assets/icons.svg`): סט מקורי שצויר במיוחד לפרויקט (אז בשם TISA).
- **חלון המטוס, הצוק, הים והשמש** בכרטיס הטיול: מצוירים בקוד (CSS ו-SVG) בפרויקט, בלי תמונות, בלי בינה מלאכותית בתשלום ובלי מאגרי תמונות.
- **פלטת הצבעים**: נדגמה מתמונת שקיעה שבעל המוצר שלח כרפרנס. התמונה עצמה לא נכללת באפליקציה.
- **הלוגו והאייקון של LATISA** (מ-0.8.2): קובצי המקור התקבלו מבעל המוצר ואושרו על ידו ב-2026-11-21, ונשמרים כמו שהם ב-`docs/brand-source/`. הקבצים באפליקציה (`icons/*.png`, `assets/brand/*.png`) נבנים מהם ב-`scripts/brand/build-brand.py`: הסרת רקע, הקטנה, ורקע כחול-לילה לאייקוני מסך הבית. השינוי היחיד באיור, באישור בעל המוצר: גרסה לרקע בהיר עם סיסמה כהה.
- **אייקוני האפליקציה עד 0.8.1** (חלון מטוס בשקיעה) צוירו ב-`scripts/make-icons.cjs`, שהוצא משימוש ב-0.8.2.
