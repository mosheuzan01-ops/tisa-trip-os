# פורמט קובץ הגיבוי של TISA (חוזה)

קובץ גיבוי שנוצר בגרסה הזו חייב להיכנס גם לכל גרסה עתידית (BETA ומעלה). אסור לשנות שדה קיים בלי פונקציית המרה ב-`src/js/core/schema.js`.

## שם הקובץ
`tisa-backup-YYYY-MM-DD.json`. התאריך הוא יום הייצוא לפי UTC.

## מבנה
```json
{
  "format": "tisa-backup",
  "schemaVersion": 1,
  "exportedAt": "2026-11-19T16:07:00.000Z",
  "data": { "...": "the full app state, see below" }
}
```

| שדה | סוג | חובה | משמעות |
|-----|-----|------|--------|
| `format` | מחרוזת | כן | תמיד `"tisa-backup"`. קובץ עם ערך אחר נדחה |
| `schemaVersion` | מספר שלם | כן | גרסת מבנה הנתונים בזמן הייצוא |
| `exportedAt` | מחרוזת ISO 8601 | כן | זמן הייצוא |
| `data` | אובייקט | כן | כל הנתונים, באותו מבנה שנשמר ב-`localStorage` במפתח `tisa:v1` |

## `data` (גרסה 1)
| שדה | סוג | הערות |
|-----|-----|-------|
| `schemaVersion` | `1` | |
| `appVersion` | מחרוזת | למשל `"0.2.0"` |
| `createdAt`, `updatedAt` | ISO 8601 | |
| `settings.language` | מחרוזת | `"he"` |
| `settings.theme` | `null`, `"light"` או `"dark"` | `null` אומר שהערכה נקבעת לפי המכשיר |
| `settings.lastBackupAt` | ISO 8601 או `null` | |
| `settings.assistantQuestionLimit` | מספר שלם | ברירת מחדל 50 |
| `activeTripId` | מחרוזת | חייב להיות מפתח ב-`trips` |
| `trips` | אובייקט לפי מזהה | |

### טיול (`trips[id]`)
| שדה | סוג | הערות |
|-----|-----|-------|
| `id` | מחרוזת | זהה למפתח. נוצר עם `crypto.randomUUID` |
| `countryCode` | מחרוזת | `"TH"` |
| `name` | מחרוזת | |
| `startDate`, `endDate` | `"YYYY-MM-DD"` או `null` | תאריכים לפי לוח השנה, בלי שעה |
| `destinations` | מערך | ריק בשלב 2. ימולא בשלב 3 |
| `expenses` | מערך | שלב 4 |
| `budget` | אובייקט | בשלב 1 נשמרו בו `amount` ו-`currency` |
| `rates` | אובייקט | שלב 4 |
| `transfers` | מערך | שלב 5 |
| `checklist` | מערך | שלב 5 |
| `events` | מערך | שלב 6 |
| `info` | אובייקט | שלב 7 |
| `assistant` | אובייקט | שלב 7 |

שדות שהגרסה הנוכחית לא מכירה נשמרים כמו שהם ולא נמחקים.

## כללי ייבוא
1. הקובץ חייב להיות JSON, ו-`format` חייב להיות `"tisa-backup"`. חייבים להופיע בו `schemaVersion`, `exportedAt` ו-`data`.
2. אם `schemaVersion` גבוה מזה של האפליקציה, הקובץ נדחה ומוצגת הודעה לעדכן את האפליקציה.
3. גרסה ישנה יותר עוברת המרה (`migrate`), ואחר כך בדיקת מבנה (`validateState`).
4. לפני שמחליפים את הנתונים מוצג תקציר: שם הטיול, התאריכים ומועד העדכון האחרון. ההחלפה קורית רק אחרי אישור מפורש.
5. כל שגיאה מחזירה קוד ולא משנה את הנתונים: `empty`, `notJson`, `format`, `structure`, `future`.

## היסטוריית גרסאות
- **0 (שלב 1):** המפתחות `tisa:trip` (`{ v: 1, trip: { dates, budget } }`) ו-`tisa:theme`. ההמרה ל-1 מעבירה את התאריכים ל-`startDate` ו-`endDate`, את התקציב ל-`budget`, ואת ערכת הצבע ל-`settings.theme`. המפתחות הישנים לא נמחקים.
- **1 (שלב 2):** המבנה שמתואר כאן.
