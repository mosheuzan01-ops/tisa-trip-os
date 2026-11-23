# רגרסיה ×3 על `651e3da` (תיקון ההמתנה של L10 ו-K9), 2026-11-23

**הקוד שנבדק:** `651e3da`. ה-HEAD נבדק בתחילת כל ריצה ובסופה (`summary.txt`). אותה קבוצה ואותו runner כמו ב-`../regression/` (c64bd10). רק JSON ופלט הועתקו (כלל 20).

| | run1 | run2 | run3 |
|---|---|---|---|
| `npm test` | 510/510 | 510/510 | 510/510 |
| RLS מקומי | ALL PASS | ALL PASS | ALL PASS |
| 41 סקריפטים (40 ו-`qa-live-060`) | 41/41 exit 0 | 41/41 exit 0 | 41/41 exit 0 |
| קובצי תוצאה עם FAIL | 0 | 0 | 0 |
| `scripts/qa/qa_scan.py` | index FAIL 5, WARN 3 · brand FAIL 0, WARN 2 | זהה | זהה |
| סורק הסקיל (`qa-scan-skill-*.txt`) | index FAIL 5, WARN 4 · brand FAIL 0, WARN 2 | זהה | זהה |

- **סה"כ:** 129 מתוך 129 הרצות עם exit 0. ‏`smart-bag-browser` (L10), ‏`tips-browser` (K9) ו-`stage7-offline-browser` עברו בשלוש הריצות.
- **הסורקים:** הפלט זהה לזה של `../regression/` על `defff2c`, וכל הממצאים KNOWN. סורק הסקיל הורץ מחדש אחרי הריצה עם אותו קובץ סורק כמו ב-c64bd10 (md5 `4adb23a5`), כי ה-runner הריץ בטעות גרסה אחרת שלו. ה-HTML לא השתנה בין `defff2c` ל-`651e3da`.
