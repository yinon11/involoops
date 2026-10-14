/**
 * Seed transactional + admin email templates into the database.
 *
 * Same `email_templates` table the funnel emails live in; distinguished by
 * `template_type` ("transactional" for user-facing helpers, "admin" for the
 * notifications that go to ADMIN_EMAIL).
 *
 * Natural key is (code, locale). Re-running the script upserts: existing
 * rows get fresh subject/body, new rows are inserted, no rows are deleted.
 *
 * Run: npx tsx scripts/seed-transactional-templates.ts
 */

import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { emailTemplates } from "../src/db/schema/email-templates";
import * as schema from "../src/db/schema";

const connectionString = process.env.DATABASE_URL!;
const client = postgres(connectionString);
const db = drizzle(client, { schema });

interface TemplateSeed {
  code: string;
  locale: string;
  name: string;
  subject: string;
  templateType: "transactional" | "admin";
  variables: string;
  bodyHtml: string;
  bodyText?: string;
}

// ── Brand header ────────────────────────────────────────────────────
//
// Same lockup strip the funnel templates use. {{appUrl}} is auto-injected
// by sendFromTemplate in transactional.ts so individual helpers don't have
// to pass it. Image is PNG (Gmail/Outlook/iOS Mail don't render SVG).
//
// width/height attrs are mandatory for Outlook; the inline style mirrors
// them so high-DPI clients still scale crisply from the 800×200 source.
const LOGO_HEADER = `
  <div style="text-align:center;padding:20px 0 12px 0;">
    <a href="{{appUrl}}" style="text-decoration:none;display:inline-block;border:0;outline:none;">
      <img src="{{appUrl}}/brand/involoops-lockup-horizontal.png" alt="Involoops" width="180" height="45" style="display:inline-block;border:0;outline:none;text-decoration:none;height:45px;width:180px;" />
    </a>
  </div>`;

// ── User-facing transactional (en + he) ─────────────────────────────

const transactional: TemplateSeed[] = [
  // ── pwd-reset ────────────────────────────────────────────────────
  {
    code: "pwd-reset",
    locale: "en",
    name: "Password reset",
    subject: "Reset your Involoops password",
    templateType: "transactional",
    variables: '["resetUrl"]',
    bodyHtml: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#1a1a1a;">${LOGO_HEADER}
  <p>Hi,</p>
  <p>We received a request to reset your password. Click the link below (valid for 1 hour):</p>
  <p><a href="{{resetUrl}}" dir="ltr">Reset password</a></p>
  <p>If you did not ask for this, you can ignore this email.</p>
</body>
</html>`,
    bodyText: `Reset your password (valid 1 hour): {{resetUrl}}\n\nIf you did not ask for this, ignore this email.`,
  },
  {
    code: "pwd-reset",
    locale: "he",
    name: "איפוס סיסמה",
    subject: "איפוס סיסמה ל-Involoops",
    templateType: "transactional",
    variables: '["resetUrl"]',
    bodyHtml: `
<!DOCTYPE html>
<html lang="he" dir="rtl">
<head><meta charset="utf-8"></head>
<body style="font-family:'Segoe UI',Arial,'Helvetica Neue',sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#1a1a1a;direction:rtl;text-align:right;">${LOGO_HEADER}
  <p>שלום,</p>
  <p>קיבלנו בקשה לאפס את הסיסמה שלך. לחצו על הקישור להלן (בתוקף לשעה):</p>
  <p><a href="{{resetUrl}}" dir="ltr">איפוס סיסמה</a></p>
  <p>אם לא ביקשת זאת, אפשר להתעלם מהמייל הזה.</p>
</body>
</html>`,
    bodyText: `איפוס סיסמה (בתוקף לשעה): {{resetUrl}}\n\nאם לא ביקשת, ניתן להתעלם מהמייל הזה.`,
  },

  // ── email-verify ────────────────────────────────────────────────
  {
    code: "email-verify",
    locale: "en",
    name: "Email verification",
    subject: "Verify your Involoops email",
    templateType: "transactional",
    variables: '["userName","verifyUrl"]',
    bodyHtml: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#1a1a1a;">${LOGO_HEADER}
  <p>Hi {{userName}},</p>
  <p>Thanks for signing up. Please verify your email address by clicking the link below (valid for 1 hour):</p>
  <p><a href="{{verifyUrl}}" dir="ltr">Verify email</a></p>
  <p>If the link doesn't work, paste this URL into your browser:</p>
  <p style="word-break:break-all" dir="ltr">{{verifyUrl}}</p>
  <p>If you didn't create an account, you can safely ignore this email.</p>
</body>
</html>`,
    bodyText: `Hi {{userName}},\n\nVerify your email (valid 1 hour): {{verifyUrl}}\n\nIf you didn't create an account, ignore this email.`,
  },
  {
    code: "email-verify",
    locale: "he",
    name: "אימות אימייל",
    subject: "אימות כתובת המייל ב-Involoops",
    templateType: "transactional",
    variables: '["userName","verifyUrl"]',
    bodyHtml: `
<!DOCTYPE html>
<html lang="he" dir="rtl">
<head><meta charset="utf-8"></head>
<body style="font-family:'Segoe UI',Arial,'Helvetica Neue',sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#1a1a1a;direction:rtl;text-align:right;">${LOGO_HEADER}
  <p>שלום {{userName}},</p>
  <p>תודה שנרשמתם. נא לאמת את כתובת המייל שלכם בלחיצה על הקישור (בתוקף לשעה):</p>
  <p><a href="{{verifyUrl}}" dir="ltr">אימות מייל</a></p>
  <p>אם הקישור לא עובד, ניתן להעתיק את הכתובת לדפדפן:</p>
  <p style="word-break:break-all" dir="ltr">{{verifyUrl}}</p>
  <p>אם לא יצרתם חשבון, אפשר להתעלם מהמייל הזה.</p>
</body>
</html>`,
    bodyText: `שלום {{userName}},\n\nאימות מייל (בתוקף לשעה): {{verifyUrl}}\n\nאם לא יצרתם חשבון, ניתן להתעלם.`,
  },

  // ── authorized-sender-verify ────────────────────────────────────
  {
    code: "authorized-sender-verify",
    locale: "en",
    name: "Authorised sender verification",
    subject: "Confirm invoice forwarding to Involoops",
    templateType: "transactional",
    variables: '["ownerName","ownerEmail","verifyUrl"]',
    bodyHtml: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#1a1a1a;">${LOGO_HEADER}
  <p>Hi,</p>
  <p>{{ownerName}} ({{ownerEmail}}) wants to let invoices forwarded from <strong>this email address</strong> be added automatically to their Involoops account.</p>
  <p>If that was you, confirm by clicking the link below (valid for 1 hour):</p>
  <p><a href="{{verifyUrl}}" dir="ltr">Confirm this email</a></p>
  <p>If the link doesn't work, paste this URL into your browser:</p>
  <p style="word-break:break-all" dir="ltr">{{verifyUrl}}</p>
  <p>If you don't recognise this request, you can safely ignore this email — nothing will be shared.</p>
</body>
</html>`,
    bodyText: `{{ownerName}} ({{ownerEmail}}) wants invoices forwarded from this address added to their Involoops account.\n\nConfirm (valid 1 hour): {{verifyUrl}}\n\nIf you don't recognise this request, ignore this email.`,
  },
  {
    code: "authorized-sender-verify",
    locale: "he",
    name: "אימות כתובת שולח מורשית",
    subject: "אישור העברת חשבוניות ל-Involoops",
    templateType: "transactional",
    variables: '["ownerName","ownerEmail","verifyUrl"]',
    bodyHtml: `
<!DOCTYPE html>
<html lang="he" dir="rtl">
<head><meta charset="utf-8"></head>
<body style="font-family:'Segoe UI',Arial,'Helvetica Neue',sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#1a1a1a;direction:rtl;text-align:right;">${LOGO_HEADER}
  <p>שלום,</p>
  <p>{{ownerName}} ({{ownerEmail}}) מעוניין/ת שחשבוניות שיועברו מ<strong>כתובת מייל זו</strong> יתווספו אוטומטית לחשבון ה-Involoops שלו/שלה.</p>
  <p>אם זה אתם, אשרו בלחיצה על הקישור (בתוקף לשעה):</p>
  <p><a href="{{verifyUrl}}" dir="ltr">אישור כתובת זו</a></p>
  <p>אם הקישור לא עובד, ניתן להעתיק את הכתובת לדפדפן:</p>
  <p style="word-break:break-all" dir="ltr">{{verifyUrl}}</p>
  <p>אם אינכם מזהים את הבקשה, אפשר להתעלם מהמייל הזה — שום דבר לא ישותף.</p>
</body>
</html>`,
    bodyText: `{{ownerName}} ({{ownerEmail}}) מבקש/ת שחשבוניות שיועברו מכתובת זו יתווספו לחשבון ה-Involoops שלו/שלה.\n\nאישור (בתוקף לשעה): {{verifyUrl}}\n\nאם אינכם מזהים את הבקשה, ניתן להתעלם.`,
  },

  // ── invoice-scan-confirm ────────────────────────────────────────
  // {{{invoiceCards}}} is a triple-brace = raw HTML block built by
  // sendInvoiceScanConfirmation in transactional.ts. Never let user input
  // flow into it without escaping at the call site.
  {
    code: "invoice-scan-confirm",
    locale: "en",
    name: "Invoice scan confirmation",
    subject: "Invoice received",
    templateType: "transactional",
    variables: '["userName","invoiceCount","srcSubject","invoiceCards"]',
    bodyHtml: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body>
  <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#1a1a1a;">${LOGO_HEADER}
    <p>Hi {{userName}},</p>
    <h2 style="margin:16px 0 8px">We received your email</h2>
    <p>We scanned the attached invoice(s) — {{invoiceCount}} item(s). Here's what we extracted:</p>
    <p style="color:#666;font-size:13px"><strong>Original subject:</strong> {{srcSubject}}</p>
    {{{invoiceCards}}}
    <p style="color:#666;font-size:13px;margin-top:16px">You can view and edit these invoices in your Involoops dashboard.</p>
    <p style="color:#666;font-size:13px">— Involoops</p>
  </div>
</body>
</html>`,
    bodyText: `Hi {{userName}},\n\nWe received your email and scanned {{invoiceCount}} invoice(s). View them in your Involoops dashboard.`,
  },
  {
    code: "invoice-scan-confirm",
    locale: "he",
    name: "אישור סריקת חשבונית",
    subject: "אישור קבלת חשבונית",
    templateType: "transactional",
    variables: '["userName","invoiceCount","srcSubject","invoiceCards"]',
    bodyHtml: `
<!DOCTYPE html>
<html lang="he" dir="rtl">
<head><meta charset="utf-8"></head>
<body>
  <div style="font-family:'Segoe UI',Arial,'Helvetica Neue',sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#1a1a1a;direction:rtl;text-align:right;">${LOGO_HEADER}
    <p>שלום {{userName}},</p>
    <h2 style="margin:16px 0 8px">קיבלנו את המייל שלך</h2>
    <p>סרקנו את החשבוניות המצורפות — {{invoiceCount}} פריט/ים. להלן הפרטים שחילצנו:</p>
    <p style="color:#666;font-size:13px"><strong>נושא המייל המקורי:</strong> {{srcSubject}}</p>
    {{{invoiceCards}}}
    <p style="color:#666;font-size:13px;margin-top:16px">ניתן לעיין בחשבוניות ולערוך אותן בלוח הבקרה של Involoops.</p>
    <p style="color:#666;font-size:13px">— Involoops</p>
  </div>
</body>
</html>`,
    bodyText: `שלום {{userName}},\n\nקיבלנו את המייל שלך וסרקנו {{invoiceCount}} חשבוניות. ניתן לעיין בלוח הבקרה של Involoops.`,
  },

  // ── invoice-intake-failure ──────────────────────────────────────
  {
    code: "invoice-intake-failure",
    locale: "en",
    name: "Invoice email intake failure",
    subject: "We couldn't add your invoice from email",
    templateType: "transactional",
    variables: '["userName","srcSubject","reason","errorDetail"]',
    bodyHtml: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body>
  <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#1a1a1a;">${LOGO_HEADER}
    <p>Hi {{userName}},</p>
    <h2 style="margin:16px 0 8px">Your invoice email wasn't processed</h2>
    <p>{{reason}}</p>
    <p style="color:#666;font-size:13px"><strong>Original subject:</strong> {{srcSubject}}</p>
    <p style="color:#666;font-size:13px"><strong>Details:</strong> {{errorDetail}}</p>
    <p style="color:#666;font-size:13px;margin-top:16px">You can upload the file manually from your Involoops dashboard, or forward the email again after fixing the issue. If the reason above is unclear, we still received an alert and our team is looking into it. Account owners receive at most one summary alert like this per day.</p>
    <p style="color:#666;font-size:13px">— Involoops</p>
  </div>
</body>
</html>`,
    bodyText: `Hi {{userName}},\n\nYour invoice email wasn't processed.\n\n{{reason}}\n\nSubject: {{srcSubject}}\nDetails: {{errorDetail}}\n\nUpload manually from your dashboard or try again.`,
  },
  {
    code: "invoice-intake-failure",
    locale: "he",
    name: "כשל בקליטת חשבונית במייל",
    subject: "לא הצלחנו להוסיף את החשבונית מהמייל",
    templateType: "transactional",
    variables: '["userName","srcSubject","reason","errorDetail"]',
    bodyHtml: `
<!DOCTYPE html>
<html lang="he" dir="rtl">
<head><meta charset="utf-8"></head>
<body>
  <div style="font-family:'Segoe UI',Arial,'Helvetica Neue',sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#1a1a1a;direction:rtl;text-align:right;">${LOGO_HEADER}
    <p>שלום {{userName}},</p>
    <h2 style="margin:16px 0 8px">המייל עם החשבונית לא עובד</h2>
    <p>{{reason}}</p>
    <p style="color:#666;font-size:13px"><strong>נושא המייל המקורי:</strong> {{srcSubject}}</p>
    <p style="color:#666;font-size:13px"><strong>פרטים:</strong> {{errorDetail}}</p>
    <p style="color:#666;font-size:13px;margin-top:16px">אפשר להעלות את הקובץ ידנית מלוח הבקרה, או לשלוח את המייל שוב לאחר תיקון הבעיה. אם הסיבה לא ברורה, עדיין קיבלנו התראה ואנחנו בודקים. לבעלי חשבון נשלחת לכל היותר התראה מסכמת אחת ביום.</p>
    <p style="color:#666;font-size:13px">— Involoops</p>
  </div>
</body>
</html>`,
    bodyText: `שלום {{userName}},\n\nהמייל עם החשבונית לא עובד.\n\n{{reason}}\n\nנושא: {{srcSubject}}\nפרטים: {{errorDetail}}\n\nניתן להעלות ידנית מהלוח או לנסות שוב.`,
  },

  // ── shaam-expiry-warning ────────────────────────────────────────
  {
    code: "shaam-expiry-warning",
    locale: "en",
    name: "ITA authorization expiry warning",
    subject: "Your ITA authorization expires in {{daysLeft}} days",
    templateType: "transactional",
    variables: '["daysLeft","portalUrl"]',
    bodyHtml: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#1a1a1a;">${LOGO_HEADER}
  <p>Hi,</p>
  <p>Your ITA (חשבונית ישראל) authorization expires in <strong>{{daysLeft}} days</strong>.</p>
  <p>Renewal takes about two minutes — <a href="{{portalUrl}}" dir="ltr">open your settings</a> and click "Re-authorize".</p>
  <p>Without a valid authorization, we can't obtain allocation numbers for your invoices.</p>
</body>
</html>`,
    bodyText: `Your ITA authorization expires in {{daysLeft}} days. Renew at {{portalUrl}}.`,
  },
  {
    code: "shaam-expiry-warning",
    locale: "he",
    name: "אזהרת פקיעת הרשאת רשות המסים",
    subject: "תוקף ההרשאה שלך לרשות המסים יפוג בעוד {{daysLeft}} ימים",
    templateType: "transactional",
    variables: '["daysLeft","portalUrl"]',
    bodyHtml: `
<!DOCTYPE html>
<html lang="he" dir="rtl">
<head><meta charset="utf-8"></head>
<body style="font-family:'Segoe UI',Arial,'Helvetica Neue',sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#1a1a1a;direction:rtl;text-align:right;">${LOGO_HEADER}
  <p>שלום,</p>
  <p>ההרשאה שלך לרשות המסים (חשבונית ישראל) תפוג בעוד <strong>{{daysLeft}} ימים</strong>.</p>
  <p>חידוש לוקח כשתי דקות — <a href="{{portalUrl}}" dir="ltr">התחבר לאזור ההגדרות שלך</a> ולחץ על "חבר מחדש".</p>
  <p>בלי ההרשאה, לא נוכל להפיק מספרי הקצאה לחשבוניות שלך.</p>
</body>
</html>`,
    bodyText: `תוקף ההרשאה שלך לרשות המסים יפוג בעוד {{daysLeft}} ימים. חידוש: {{portalUrl}}`,
  },

  // ── shaam-expired ───────────────────────────────────────────────
  {
    code: "shaam-expired",
    locale: "en",
    name: "ITA authorization expired",
    subject: "Your ITA authorization has expired",
    templateType: "transactional",
    variables: '["portalUrl"]',
    bodyHtml: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#1a1a1a;">${LOGO_HEADER}
  <p>Hi,</p>
  <p>Your ITA (חשבונית ישראל) authorization has expired. We can't obtain allocation numbers until you re-authorize.</p>
  <p><a href="{{portalUrl}}" dir="ltr">Re-authorize now</a> — it takes about two minutes.</p>
</body>
</html>`,
    bodyText: `Your ITA authorization has expired. Re-authorize at {{portalUrl}}.`,
  },
  {
    code: "shaam-expired",
    locale: "he",
    name: "פקיעת הרשאת רשות המסים",
    subject: "תוקף ההרשאה שלך לרשות המסים פג",
    templateType: "transactional",
    variables: '["portalUrl"]',
    bodyHtml: `
<!DOCTYPE html>
<html lang="he" dir="rtl">
<head><meta charset="utf-8"></head>
<body style="font-family:'Segoe UI',Arial,'Helvetica Neue',sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#1a1a1a;direction:rtl;text-align:right;">${LOGO_HEADER}
  <p>שלום,</p>
  <p>ההרשאה שלך לרשות המסים (חשבונית ישראל) פגה. לא נוכל להפיק מספרי הקצאה עד אשר תחבר מחדש.</p>
  <p><a href="{{portalUrl}}" dir="ltr">חבר מחדש בלחיצה אחת</a> — התהליך לוקח כשתי דקות.</p>
</body>
</html>`,
    bodyText: `תוקף ההרשאה שלך לרשות המסים פג. חבר מחדש: {{portalUrl}}`,
  },

  // ── shaam-stuck ─────────────────────────────────────────────────
  {
    code: "shaam-stuck",
    locale: "en",
    name: "ITA onboarding stuck",
    subject: "Complete your ITA connection",
    templateType: "transactional",
    variables: '["portalUrl"]',
    bodyHtml: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#1a1a1a;">${LOGO_HEADER}
  <p>Hi,</p>
  <p>You started the ITA integration setup but haven't finished. Without it, we can't obtain allocation numbers for your invoices.</p>
  <p><a href="{{portalUrl}}" dir="ltr">Pick up where you left off</a>.</p>
</body>
</html>`,
    bodyText: `You started your ITA connection setup but haven't finished. Continue at {{portalUrl}}.`,
  },
  {
    code: "shaam-stuck",
    locale: "he",
    name: "תהליך חיבור לרשות המסים לא הושלם",
    subject: "השלם את החיבור לרשות המסים",
    templateType: "transactional",
    variables: '["portalUrl"]',
    bodyHtml: `
<!DOCTYPE html>
<html lang="he" dir="rtl">
<head><meta charset="utf-8"></head>
<body style="font-family:'Segoe UI',Arial,'Helvetica Neue',sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#1a1a1a;direction:rtl;text-align:right;">${LOGO_HEADER}
  <p>שלום,</p>
  <p>התחלת את תהליך החיבור לרשות המסים אבל עדיין לא סיימת. בלי זה, לא נוכל להפיק מספרי הקצאה לחשבוניות שלך.</p>
  <p><a href="{{portalUrl}}" dir="ltr">המשך מהיכן שעצרת</a>.</p>
</body>
</html>`,
    bodyText: `התחלת את תהליך החיבור לרשות המסים אך טרם סיימת. המשך: {{portalUrl}}`,
  },

  // ── shaam-hearing-deadline ──────────────────────────────────────
  // Points at the invoice and at the seller's accountant rather than
  // stating what happens when the window closes — that rule is still
  // unconfirmed (see docs/ita-compliance/shaam-rejection-plan.md §8).
  {
    code: "shaam-hearing-deadline",
    locale: "en",
    name: "ITA hearing deadline approaching",
    subject: "Hearing deadline approaching for invoice {{documentNumber}}",
    templateType: "transactional",
    variables: '["documentNumber","deadline","portalUrl"]',
    bodyHtml: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#1a1a1a;">${LOGO_HEADER}
  <p>Hi,</p>
  <p>The Tax Authority has not yet decided on invoice <strong>{{documentNumber}}</strong>, and the hearing deadline is <strong>{{deadline}}</strong>.</p>
  <p>The window is short. If you intend to contest the refusal, speak to your accountant now.</p>
  <p><a href="{{portalUrl}}" dir="ltr">Open your ITA settings</a>.</p>
</body>
</html>`,
    bodyText: `The Tax Authority has not decided on invoice {{documentNumber}}. Hearing deadline: {{deadline}}. Speak to your accountant. {{portalUrl}}`,
  },
  {
    code: "shaam-hearing-deadline",
    locale: "he",
    name: "מועד השימוע מתקרב",
    subject: "מועד השימוע מתקרב עבור חשבונית {{documentNumber}}",
    templateType: "transactional",
    variables: '["documentNumber","deadline","portalUrl"]',
    bodyHtml: `
<!DOCTYPE html>
<html lang="he" dir="rtl">
<head><meta charset="utf-8"></head>
<body style="font-family:'Segoe UI',Arial,'Helvetica Neue',sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#1a1a1a;direction:rtl;text-align:right;">${LOGO_HEADER}
  <p>שלום,</p>
  <p>רשות המסים טרם החליטה בעניין חשבונית <strong>{{documentNumber}}</strong>, ומועד השימוע הוא <strong>{{deadline}}</strong>.</p>
  <p>המועדים קצרים. אם בכוונתך לערער על הסירוב, מומלץ לפנות לרואה החשבון כעת.</p>
  <p><a href="{{portalUrl}}" dir="ltr">מעבר להגדרות רשות המסים</a>.</p>
</body>
</html>`,
    bodyText: `רשות המסים טרם החליטה בעניין חשבונית {{documentNumber}}. מועד השימוע: {{deadline}}. מומלץ לפנות לרואה החשבון. {{portalUrl}}`,
  },
];

// ── Admin notifications (English only — recipient is ADMIN_EMAIL) ──

const admin: TemplateSeed[] = [
  {
    code: "admin-new-signup",
    locale: "en",
    name: "Admin: new user signup",
    subject: "[Involoops] New signup: {{userName}}",
    templateType: "admin",
    variables: '["userName","userEmail","provider"]',
    bodyHtml: `
<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="font-family:system-ui,sans-serif;color:#1a1a1a;">
  <h2>New user signup</h2>
  <p><strong>Name:</strong> {{userName}}</p>
  <p><strong>Email:</strong> {{userEmail}}</p>
  <p><strong>Signed up via:</strong> {{provider}}</p>
</body></html>`,
    bodyText: `New signup: {{userName}} <{{userEmail}}> via {{provider}}`,
  },
  {
    code: "admin-contact-message",
    locale: "en",
    name: "Admin: contact form message",
    subject: "[Involoops] Contact: {{subject}}",
    templateType: "admin",
    // {{message}} is escaped by the renderer; whitespace is preserved with
    // white-space:pre-wrap on the wrapper <p>.
    variables: '["senderName","senderEmail","subject","message"]',
    bodyHtml: `
<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="font-family:system-ui,sans-serif;color:#1a1a1a;">
  <h2>New contact form submission</h2>
  <p><strong>Name:</strong> {{senderName}}</p>
  <p><strong>Email:</strong> {{senderEmail}}</p>
  <p><strong>Subject:</strong> {{subject}}</p>
  <p><strong>Message:</strong></p>
  <p style="white-space:pre-wrap">{{message}}</p>
  <hr />
  <p style="color:#666;font-size:12px">Reply directly to this email to reach {{senderName}} ({{senderEmail}}).</p>
</body></html>`,
    bodyText: `New contact message from {{senderName}} <{{senderEmail}}>\nSubject: {{subject}}\n\n{{message}}`,
  },
  {
    code: "admin-user-set-byok-key",
    locale: "en",
    name: "Admin: user saved BYOK key",
    subject: "[Involoops] User set own Claude key: {{userName}}",
    templateType: "admin",
    variables: '["userName","userEmail","keyHint"]',
    bodyHtml: `
<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="font-family:system-ui,sans-serif;color:#1a1a1a;">
  <h2>User saved a Claude (Anthropic) API key</h2>
  <p><strong>Name:</strong> {{userName}}</p>
  <p><strong>Email:</strong> {{userEmail}}</p>
  <p><strong>Key hint:</strong> …{{keyHint}}</p>
</body></html>`,
    bodyText: `User {{userName}} <{{userEmail}}> set own Claude key (hint: …{{keyHint}})`,
  },
  {
    code: "admin-new-subscription",
    locale: "en",
    name: "Admin: new paid subscription",
    subject: "[Involoops] New subscription: {{userName}} → {{tier}}",
    templateType: "admin",
    variables: '["userName","userEmail","tier","amount"]',
    // {{amount}} is optional; when empty, the surrounding <p> renders as
    // "Amount: " — acceptable for an admin-only email and avoids conditionals.
    bodyHtml: `
<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="font-family:system-ui,sans-serif;color:#1a1a1a;">
  <h2>New paid subscription</h2>
  <p><strong>Name:</strong> {{userName}}</p>
  <p><strong>Email:</strong> {{userEmail}}</p>
  <p><strong>Tier:</strong> {{tier}}</p>
  <p><strong>Amount:</strong> {{amount}}</p>
</body></html>`,
    bodyText: `New subscription: {{userName}} <{{userEmail}}> → {{tier}} ({{amount}})`,
  },
];

async function main() {
  console.log("Seeding transactional + admin templates...");
  const all = [...transactional, ...admin];
  for (const tmpl of all) {
    await db
      .insert(emailTemplates)
      .values(tmpl)
      .onConflictDoUpdate({
        target: [emailTemplates.code, emailTemplates.locale],
        set: {
          name: tmpl.name,
          subject: tmpl.subject,
          bodyHtml: tmpl.bodyHtml,
          bodyText: tmpl.bodyText,
          templateType: tmpl.templateType,
          variables: tmpl.variables,
          updatedAt: new Date(),
        },
      });
    console.log(`  ✓ ${tmpl.templateType}: ${tmpl.code} [${tmpl.locale}]`);
  }
  console.log("\nDone!");
  process.exit(0);
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
