/**
 * Seed email funnels, templates, and steps into the database.
 * Run: npx tsx scripts/seed-email-funnels.ts
 */

import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { emailTemplates } from "../src/db/schema/email-templates";
import { emailFunnels, emailFunnelSteps, emailFunnelExits } from "../src/db/schema/email-funnels";
import { eq, and } from "drizzle-orm";
import * as schema from "../src/db/schema";

const connectionString = process.env.DATABASE_URL!;
const client = postgres(connectionString);
const db = drizzle(client, { schema });

// ── Brand header ────────────────────────────────────────────────────
//
// Small Involoops lockup strip injected at the top of every email body.
// Image is a PNG (SVG isn't supported by Gmail web / Outlook / iOS Mail) and
// referenced via {{appUrl}} so dev/staging/prod each pull the logo from
// their own origin. Caller (funnel-send-service / transactional sendFromTemplate)
// supplies appUrl in the variables map.
//
// width/height attrs are mandatory for Outlook; the inline style mirrors them
// so high-DPI clients still scale crisply from the 800×200 source PNG.
const LOGO_HEADER = `
  <div style="text-align:center;padding:20px 0 12px 0;">
    <a href="{{appUrl}}" style="text-decoration:none;display:inline-block;border:0;outline:none;">
      <img src="{{appUrl}}/brand/involoops-lockup-horizontal.png" alt="Involoops" width="180" height="45" style="display:inline-block;border:0;outline:none;text-decoration:none;height:45px;width:180px;" />
    </a>
  </div>`;

// ── Templates ───────────────────────────────────────────────────────

const templates = [
  {
    code: "onb-welcome",
    locale: "en",
    name: "Welcome Email",
    subject: "Welcome to {{companyName}}!",
    templateType: "funnel",
    variables: '["userName","companyName","appUrl"]',
    bodyHtml: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#1a1a1a;">${LOGO_HEADER}
  <div style="background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);padding:32px;border-radius:12px 12px 0 0;text-align:center;">
    <h1 style="color:white;margin:0;font-size:28px;">Welcome! 🎉</h1>
  </div>
  <div style="background:#ffffff;padding:32px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;">
    <p style="font-size:16px;line-height:1.6;">Hi {{userName}},</p>
    <p style="font-size:16px;line-height:1.6;">Welcome to <strong>{{companyName}}</strong>! We're excited to have you on board.</p>
    <p style="font-size:16px;line-height:1.6;">Here's how to get started:</p>
    <ol style="font-size:15px;line-height:1.8;padding-left:20px;">
      <li><strong>Upload your first invoice</strong> — drag and drop a PDF</li>
      <li><strong>Review the extraction</strong> — our AI reads the details</li>
      <li><strong>Approve or edit</strong> — ensure everything is correct</li>
    </ol>
    <div style="text-align:center;margin:28px 0;">
      <a href="{{appUrl}}/invoices/upload" style="display:inline-block;background:#667eea;color:white;text-decoration:none;padding:14px 28px;border-radius:8px;font-weight:600;font-size:16px;">Upload Your First Invoice →</a>
    </div>
    <p style="font-size:14px;color:#6b7280;">Your free plan includes 10 invoices per month. Need more? You can upgrade anytime in Settings, or set up your own Anthropic (Claude) key.</p>
  </div>
  <p style="font-size:12px;color:#9ca3af;text-align:center;margin-top:20px;">
    <a href="{{amazonSESUnsubscribeUrl}}" style="color:#9ca3af;">Unsubscribe</a>
  </p>
</body>
</html>`,
    bodyText: `Hi {{userName}},

Welcome to {{companyName}}! We're excited to have you on board.

Get started:
1. Upload your first invoice — drag and drop a PDF
2. Review the extraction — our AI reads the details
3. Approve or edit — ensure everything is correct

Upload now: {{appUrl}}/invoices/upload

Your free plan includes 10 invoices per month. Need more? You can upgrade anytime in Settings, or set up your own Anthropic (Claude) key.`,
  },
  {
    code: "onb-first-invoice",
    locale: "en",
    name: "Upload Your First Invoice",
    subject: "Ready to upload your first invoice, {{userName}}?",
    templateType: "funnel",
    variables: '["userName","appUrl"]',
    bodyHtml: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#1a1a1a;">${LOGO_HEADER}
  <div style="background:#ffffff;padding:32px;border:1px solid #e5e7eb;border-radius:12px;">
    <h2 style="margin-top:0;">Hi {{userName}}, haven't uploaded yet?</h2>
    <p style="font-size:16px;line-height:1.6;">We noticed you signed up but haven't uploaded any invoices yet. Getting started is easy:</p>
    <ul style="font-size:15px;line-height:1.8;">
      <li>Just drag & drop a PDF invoice</li>
      <li>Our AI extracts all the details automatically</li>
      <li>Review and approve in seconds</li>
    </ul>
    <div style="text-align:center;margin:24px 0;">
      <a href="{{appUrl}}/invoices/upload" style="display:inline-block;background:#667eea;color:white;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;">Try It Now →</a>
    </div>
  </div>
  <p style="font-size:12px;color:#9ca3af;text-align:center;margin-top:20px;">
    <a href="{{amazonSESUnsubscribeUrl}}" style="color:#9ca3af;">Unsubscribe</a>
  </p>
</body>
</html>`,
    bodyText: `Hi {{userName}},

We noticed you signed up but haven't uploaded any invoices yet.

Just drag & drop a PDF invoice, our AI extracts all the details, and you review in seconds.

Try it now: {{appUrl}}/invoices/upload`,
  },
  {
    code: "act-first-processed",
    locale: "en",
    name: "First Invoice Processed",
    subject: "Your first invoice is ready! 🎉",
    templateType: "funnel",
    variables: '["userName","appUrl"]',
    bodyHtml: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#1a1a1a;">${LOGO_HEADER}
  <div style="background:#ffffff;padding:32px;border:1px solid #e5e7eb;border-radius:12px;">
    <h2 style="margin-top:0;">Great job, {{userName}}! 🎉</h2>
    <p style="font-size:16px;line-height:1.6;">Your first invoice has been processed successfully. Head to your dashboard to review it and see your financial overview.</p>
    <div style="text-align:center;margin:24px 0;">
      <a href="{{appUrl}}/pending" style="display:inline-block;background:#10B981;color:white;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;">Review Invoice →</a>
    </div>
    <p style="font-size:14px;color:#6b7280;">Tip: Set up vendors to improve extraction accuracy over time.</p>
  </div>
  <p style="font-size:12px;color:#9ca3af;text-align:center;margin-top:20px;">
    <a href="{{amazonSESUnsubscribeUrl}}" style="color:#9ca3af;">Unsubscribe</a>
  </p>
</body>
</html>`,
    bodyText: `Great job, {{userName}}!

Your first invoice has been processed successfully. Head to your dashboard to review it.

Review: {{appUrl}}/pending

Tip: Set up vendors to improve extraction accuracy over time.`,
  },
  {
    code: "act-keep-going",
    locale: "en",
    name: "Keep the Momentum",
    subject: "You're on a roll, {{userName}}!",
    templateType: "funnel",
    variables: '["userName","appUrl"]',
    bodyHtml: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#1a1a1a;">${LOGO_HEADER}
  <div style="background:#ffffff;padding:32px;border:1px solid #e5e7eb;border-radius:12px;">
    <h2 style="margin-top:0;">You're building good habits! 💪</h2>
    <p style="font-size:16px;line-height:1.6;">Hi {{userName}}, you've reached 10 invoices — you're really getting the hang of it!</p>
    <p style="font-size:16px;line-height:1.6;">A few tips to get even more from your dashboard:</p>
    <ul style="font-size:15px;line-height:1.8;">
      <li><strong>Create vendors</strong> for repeat suppliers — extraction gets smarter</li>
      <li><strong>Use extraction notes</strong> to guide the AI for tricky invoices</li>
      <li><strong>Lock periods</strong> when you're done reviewing a month</li>
    </ul>
    <div style="text-align:center;margin:24px 0;">
      <a href="{{appUrl}}/dashboard" style="display:inline-block;background:#667eea;color:white;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;">View Dashboard →</a>
    </div>
  </div>
  <p style="font-size:12px;color:#9ca3af;text-align:center;margin-top:20px;">
    <a href="{{amazonSESUnsubscribeUrl}}" style="color:#9ca3af;">Unsubscribe</a>
  </p>
</body>
</html>`,
    bodyText: `Hi {{userName}},

You've reached 10 invoices — you're really getting the hang of it!

Tips:
- Create vendors for repeat suppliers
- Use extraction notes for tricky invoices
- Lock periods when done reviewing

Dashboard: {{appUrl}}/dashboard`,
  },
  {
    code: "conv-approaching-limit",
    locale: "en",
    name: "Approaching Plan Limit",
    subject: "You're almost at your {{tierName}} plan limit",
    templateType: "funnel",
    variables:
      '["userName","appUrl","tierName","tierLimit","upgradeUrl","byokSettingsUrl"]',
    bodyHtml: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#1a1a1a;">${LOGO_HEADER}
  <div style="background:#ffffff;padding:32px;border:1px solid #e5e7eb;border-radius:12px;">
    <h2 style="margin-top:0;color:#D97706;">⚠️ Heads up, {{userName}}</h2>
    <p style="font-size:16px;line-height:1.6;">You're approaching your monthly cap of <strong>{{tierLimit}} invoices</strong> on the <strong>{{tierName}}</strong> plan. Once you hit it, uploads pause until next month — so here are two ways to keep things moving:</p>

    <div style="background:#F9FAFB;padding:16px;border-radius:8px;margin:16px 0;">
      <p style="margin:0 0 6px 0;font-size:15px;"><strong>Option 1 — Upgrade your plan</strong></p>
      <p style="margin:4px 0;font-size:13px;color:#4b5563;">Professional — 50/mo · Business — 150/mo · Enterprise — 500/mo</p>
      <div style="margin-top:10px;">
        <a href="{{upgradeUrl}}" style="display:inline-block;background:#D97706;color:white;text-decoration:none;padding:10px 20px;border-radius:6px;font-weight:600;font-size:14px;">See plans →</a>
      </div>
    </div>

    <div style="background:#F9FAFB;padding:16px;border-radius:8px;margin:16px 0;">
      <p style="margin:0 0 6px 0;font-size:15px;"><strong>Option 2 — Bring your own Anthropic API key</strong></p>
      <p style="margin:4px 0;font-size:13px;color:#4b5563;">Paste your own key and we'll use it for extraction. You control costs with Anthropic directly, and your monthly cap jumps to 500 invoices.</p>
      <div style="margin-top:10px;">
        <a href="{{byokSettingsUrl}}" style="display:inline-block;background:#111827;color:white;text-decoration:none;padding:10px 20px;border-radius:6px;font-weight:600;font-size:14px;">Add your key →</a>
      </div>
    </div>
  </div>
  <p style="font-size:12px;color:#9ca3af;text-align:center;margin-top:20px;">
    <a href="{{amazonSESUnsubscribeUrl}}" style="color:#9ca3af;">Unsubscribe</a>
  </p>
</body>
</html>`,
    bodyText: `Hi {{userName}},

You're approaching your monthly cap of {{tierLimit}} invoices on the {{tierName}} plan.

Two ways to keep uploading:

1. Upgrade your plan — Professional (50/mo), Business (150/mo), or Enterprise (500/mo).
   {{upgradeUrl}}

2. Bring your own Anthropic API key — you control billing with Anthropic and your cap jumps to 500/mo.
   {{byokSettingsUrl}}`,
  },
  {
    code: "conv-limit-reached",
    locale: "en",
    name: "Plan Limit Reached",
    subject: "You've hit your {{tierName}} plan limit",
    templateType: "funnel",
    variables:
      '["userName","appUrl","tierName","tierLimit","upgradeUrl","byokSettingsUrl"]',
    bodyHtml: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#1a1a1a;">${LOGO_HEADER}
  <div style="background:#ffffff;padding:32px;border:1px solid #e5e7eb;border-radius:12px;">
    <h2 style="margin-top:0;color:#DC2626;">🚫 {{tierName}} plan limit reached</h2>
    <p style="font-size:16px;line-height:1.6;">Hi {{userName}}, you've used all {{tierLimit}} invoices on the <strong>{{tierName}}</strong> plan this month. Uploads are paused until the counter resets — unless you pick one of these:</p>

    <div style="background:#F9FAFB;padding:16px;border-radius:8px;margin:16px 0;">
      <p style="margin:0 0 6px 0;font-size:15px;"><strong>Upgrade your plan</strong></p>
      <p style="margin:4px 0;font-size:13px;color:#4b5563;">Jump to a higher tier and resume uploading immediately.</p>
      <div style="margin-top:10px;">
        <a href="{{upgradeUrl}}" style="display:inline-block;background:#DC2626;color:white;text-decoration:none;padding:12px 24px;border-radius:6px;font-weight:600;font-size:14px;">Upgrade now →</a>
      </div>
    </div>

    <div style="background:#F9FAFB;padding:16px;border-radius:8px;margin:16px 0;">
      <p style="margin:0 0 6px 0;font-size:15px;"><strong>Or bring your own Anthropic API key</strong></p>
      <p style="margin:4px 0;font-size:13px;color:#4b5563;">Paste your key in Settings — you pay Anthropic directly, and your cap rises to 500 invoices/month.</p>
      <div style="margin-top:10px;">
        <a href="{{byokSettingsUrl}}" style="display:inline-block;background:#111827;color:white;text-decoration:none;padding:10px 20px;border-radius:6px;font-weight:600;font-size:14px;">Add your key →</a>
      </div>
    </div>

    <p style="font-size:14px;color:#6b7280;">Your existing invoices and data are safe. The monthly counter resets at the start of next month.</p>
  </div>
  <p style="font-size:12px;color:#9ca3af;text-align:center;margin-top:20px;">
    <a href="{{amazonSESUnsubscribeUrl}}" style="color:#9ca3af;">Unsubscribe</a>
  </p>
</body>
</html>`,
    bodyText: `Hi {{userName}},

You've used all {{tierLimit}} invoices on the {{tierName}} plan this month. Two ways to unblock:

1. Upgrade your plan — {{upgradeUrl}}
2. Bring your own Anthropic API key (cap jumps to 500/mo) — {{byokSettingsUrl}}

Your existing invoices are safe. The counter resets next month.`,
  },
];

// ── Hebrew templates ────────────────────────────────────────────────
//
// One row per `code` per locale. Same {{placeholder}} names as the English
// versions — the funnel sender always supplies the same variables, the
// renderer picks the correct row based on `users.preferred_locale` at send
// time. Bodies use <html lang="he" dir="rtl"> + inline `direction:rtl` so
// Outlook / iOS Mail render correctly even when the dir attribute is ignored.

const templatesHe = [
  {
    code: "onb-welcome",
    locale: "he",
    name: "אימייל ברוכים הבאים",
    subject: "ברוכים הבאים ל-{{companyName}}!",
    templateType: "funnel",
    variables: '["userName","companyName","appUrl"]',
    bodyHtml: `
<!DOCTYPE html>
<html lang="he" dir="rtl">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="font-family:'Segoe UI',Arial,'Helvetica Neue',sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#1a1a1a;direction:rtl;text-align:right;">${LOGO_HEADER}
  <div style="background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);padding:32px;border-radius:12px 12px 0 0;text-align:center;">
    <h1 style="color:white;margin:0;font-size:28px;">ברוכים הבאים! 🎉</h1>
  </div>
  <div style="background:#ffffff;padding:32px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;">
    <p style="font-size:16px;line-height:1.6;">שלום {{userName}},</p>
    <p style="font-size:16px;line-height:1.6;">ברוכים הבאים ל-<strong>{{companyName}}</strong>! שמחים שהצטרפתם.</p>
    <p style="font-size:16px;line-height:1.6;">כך מתחילים:</p>
    <ol style="font-size:15px;line-height:1.8;padding-right:20px;padding-left:0;">
      <li><strong>העלו את החשבונית הראשונה</strong> — גררו ושחררו קובץ PDF</li>
      <li><strong>בדקו את הפרטים שחולצו</strong> — ה-AI שלנו קורא את החשבונית</li>
      <li><strong>אשרו או ערכו</strong> — וודאו שהכל מדויק</li>
    </ol>
    <div style="text-align:center;margin:28px 0;">
      <a href="{{appUrl}}/invoices/upload" style="display:inline-block;background:#667eea;color:white;text-decoration:none;padding:14px 28px;border-radius:8px;font-weight:600;font-size:16px;">העלאת החשבונית הראשונה ←</a>
    </div>
    <p style="font-size:14px;color:#6b7280;">המסלול החינמי כולל 10 חשבוניות בחודש. צריכים יותר? אפשר לשדרג בכל עת מההגדרות, או להגדיר מפתח Anthropic (Claude) משלכם.</p>
  </div>
  <p style="font-size:12px;color:#9ca3af;text-align:center;margin-top:20px;">
    <a href="{{amazonSESUnsubscribeUrl}}" style="color:#9ca3af;">הסרה מרשימת התפוצה</a>
  </p>
</body>
</html>`,
    bodyText: `שלום {{userName}},

ברוכים הבאים ל-{{companyName}}! שמחים שהצטרפתם.

כך מתחילים:
1. העלו את החשבונית הראשונה — גררו ושחררו קובץ PDF
2. בדקו את הפרטים שחולצו — ה-AI שלנו קורא את החשבונית
3. אשרו או ערכו — וודאו שהכל מדויק

להעלאה: {{appUrl}}/invoices/upload

המסלול החינמי כולל 10 חשבוניות בחודש. צריכים יותר? אפשר לשדרג בכל עת מההגדרות, או להגדיר מפתח Anthropic (Claude) משלכם.`,
  },
  {
    code: "onb-first-invoice",
    locale: "he",
    name: "תזכורת להעלאת חשבונית ראשונה",
    subject: "{{userName}}, מוכנים להעלות את החשבונית הראשונה?",
    templateType: "funnel",
    variables: '["userName","appUrl"]',
    bodyHtml: `
<!DOCTYPE html>
<html lang="he" dir="rtl">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="font-family:'Segoe UI',Arial,'Helvetica Neue',sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#1a1a1a;direction:rtl;text-align:right;">${LOGO_HEADER}
  <div style="background:#ffffff;padding:32px;border:1px solid #e5e7eb;border-radius:12px;">
    <h2 style="margin-top:0;">{{userName}}, עוד לא העליתם חשבונית?</h2>
    <p style="font-size:16px;line-height:1.6;">שמנו לב שנרשמתם אבל עדיין לא העליתם חשבוניות. ההתחלה פשוטה:</p>
    <ul style="font-size:15px;line-height:1.8;padding-right:20px;padding-left:0;">
      <li>גוררים ומשחררים קובץ PDF של חשבונית</li>
      <li>ה-AI מחלץ את כל הפרטים אוטומטית</li>
      <li>בודקים ומאשרים תוך שניות</li>
    </ul>
    <div style="text-align:center;margin:24px 0;">
      <a href="{{appUrl}}/invoices/upload" style="display:inline-block;background:#667eea;color:white;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;">לנסות עכשיו ←</a>
    </div>
  </div>
  <p style="font-size:12px;color:#9ca3af;text-align:center;margin-top:20px;">
    <a href="{{amazonSESUnsubscribeUrl}}" style="color:#9ca3af;">הסרה מרשימת התפוצה</a>
  </p>
</body>
</html>`,
    bodyText: `שלום {{userName}},

שמנו לב שנרשמתם אבל עדיין לא העליתם חשבוניות.

פשוט גוררים ומשחררים קובץ PDF, ה-AI מחלץ את הפרטים, ואתם בודקים תוך שניות.

לנסות עכשיו: {{appUrl}}/invoices/upload`,
  },
  {
    code: "act-first-processed",
    locale: "he",
    name: "החשבונית הראשונה עובדה",
    subject: "החשבונית הראשונה שלך מוכנה! 🎉",
    templateType: "funnel",
    variables: '["userName","appUrl"]',
    bodyHtml: `
<!DOCTYPE html>
<html lang="he" dir="rtl">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="font-family:'Segoe UI',Arial,'Helvetica Neue',sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#1a1a1a;direction:rtl;text-align:right;">${LOGO_HEADER}
  <div style="background:#ffffff;padding:32px;border:1px solid #e5e7eb;border-radius:12px;">
    <h2 style="margin-top:0;">כל הכבוד, {{userName}}! 🎉</h2>
    <p style="font-size:16px;line-height:1.6;">החשבונית הראשונה שלך עובדה בהצלחה. עברו לדשבורד לסקירה ותוכלו לראות תמונה כוללת של ההוצאות.</p>
    <div style="text-align:center;margin:24px 0;">
      <a href="{{appUrl}}/pending" style="display:inline-block;background:#10B981;color:white;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;">לסקור את החשבונית ←</a>
    </div>
    <p style="font-size:14px;color:#6b7280;">טיפ: הגדרת ספקים משפרת את דיוק החילוץ עם הזמן.</p>
  </div>
  <p style="font-size:12px;color:#9ca3af;text-align:center;margin-top:20px;">
    <a href="{{amazonSESUnsubscribeUrl}}" style="color:#9ca3af;">הסרה מרשימת התפוצה</a>
  </p>
</body>
</html>`,
    bodyText: `כל הכבוד, {{userName}}!

החשבונית הראשונה שלך עובדה בהצלחה. עברו לדשבורד לסקירה.

לסקירה: {{appUrl}}/pending

טיפ: הגדרת ספקים משפרת את דיוק החילוץ עם הזמן.`,
  },
  {
    code: "act-keep-going",
    locale: "he",
    name: "להמשיך בקצב",
    subject: "{{userName}}, אתם בקצב מצוין!",
    templateType: "funnel",
    variables: '["userName","appUrl"]',
    bodyHtml: `
<!DOCTYPE html>
<html lang="he" dir="rtl">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="font-family:'Segoe UI',Arial,'Helvetica Neue',sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#1a1a1a;direction:rtl;text-align:right;">${LOGO_HEADER}
  <div style="background:#ffffff;padding:32px;border:1px solid #e5e7eb;border-radius:12px;">
    <h2 style="margin-top:0;">בונים הרגלים טובים! 💪</h2>
    <p style="font-size:16px;line-height:1.6;">שלום {{userName}}, הגעתם ל-10 חשבוניות — ניכר שאתם נכנסים לקצב!</p>
    <p style="font-size:16px;line-height:1.6;">כמה טיפים שיעזרו לכם להפיק עוד יותר מהדשבורד:</p>
    <ul style="font-size:15px;line-height:1.8;padding-right:20px;padding-left:0;">
      <li><strong>צרו ספקים</strong> לחשבוניות חוזרות — החילוץ נעשה חכם יותר</li>
      <li><strong>השתמשו בהערות חילוץ</strong> כדי להנחות את ה-AI לחשבוניות מורכבות</li>
      <li><strong>נעלו תקופות</strong> כשסיימתם לסקור חודש</li>
    </ul>
    <div style="text-align:center;margin:24px 0;">
      <a href="{{appUrl}}/dashboard" style="display:inline-block;background:#667eea;color:white;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;">לדשבורד ←</a>
    </div>
  </div>
  <p style="font-size:12px;color:#9ca3af;text-align:center;margin-top:20px;">
    <a href="{{amazonSESUnsubscribeUrl}}" style="color:#9ca3af;">הסרה מרשימת התפוצה</a>
  </p>
</body>
</html>`,
    bodyText: `שלום {{userName}},

הגעתם ל-10 חשבוניות — ניכר שאתם נכנסים לקצב!

טיפים:
- צרו ספקים לחשבוניות חוזרות
- השתמשו בהערות חילוץ לחשבוניות מורכבות
- נעלו תקופות כשסיימתם לסקור

דשבורד: {{appUrl}}/dashboard`,
  },
  {
    code: "conv-approaching-limit",
    locale: "he",
    name: "מתקרבים למכסת התוכנית",
    subject: "{{userName}}, אתם מתקרבים למכסה של תוכנית {{tierName}}",
    templateType: "funnel",
    variables:
      '["userName","appUrl","tierName","tierLimit","upgradeUrl","byokSettingsUrl"]',
    bodyHtml: `
<!DOCTYPE html>
<html lang="he" dir="rtl">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="font-family:'Segoe UI',Arial,'Helvetica Neue',sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#1a1a1a;direction:rtl;text-align:right;">${LOGO_HEADER}
  <div style="background:#ffffff;padding:32px;border:1px solid #e5e7eb;border-radius:12px;">
    <h2 style="margin-top:0;color:#D97706;">⚠️ שימו לב, {{userName}}</h2>
    <p style="font-size:16px;line-height:1.6;">אתם מתקרבים למכסה החודשית של <strong>{{tierLimit}} חשבוניות</strong> בתוכנית <strong>{{tierName}}</strong>. ברגע שתגיעו, העלאות יושהו עד תחילת החודש הבא — לכן הנה שתי דרכים להמשיך:</p>

    <div style="background:#F9FAFB;padding:16px;border-radius:8px;margin:16px 0;">
      <p style="margin:0 0 6px 0;font-size:15px;"><strong>אפשרות 1 — שדרוג התוכנית</strong></p>
      <p style="margin:4px 0;font-size:13px;color:#4b5563;">Professional — 50 בחודש · Business — 150 בחודש · Enterprise — 500 בחודש</p>
      <div style="margin-top:10px;">
        <a href="{{upgradeUrl}}" style="display:inline-block;background:#D97706;color:white;text-decoration:none;padding:10px 20px;border-radius:6px;font-weight:600;font-size:14px;">לראות תוכניות ←</a>
      </div>
    </div>

    <div style="background:#F9FAFB;padding:16px;border-radius:8px;margin:16px 0;">
      <p style="margin:0 0 6px 0;font-size:15px;"><strong>אפשרות 2 — להביא מפתח Anthropic משלכם</strong></p>
      <p style="margin:4px 0;font-size:13px;color:#4b5563;">מדביקים מפתח אישי, ואנחנו נשתמש בו לחילוץ. אתם שולטים בעלויות מול Anthropic ישירות, והמכסה החודשית קופצת ל-500 חשבוניות.</p>
      <div style="margin-top:10px;">
        <a href="{{byokSettingsUrl}}" style="display:inline-block;background:#111827;color:white;text-decoration:none;padding:10px 20px;border-radius:6px;font-weight:600;font-size:14px;">להוספת מפתח ←</a>
      </div>
    </div>
  </div>
  <p style="font-size:12px;color:#9ca3af;text-align:center;margin-top:20px;">
    <a href="{{amazonSESUnsubscribeUrl}}" style="color:#9ca3af;">הסרה מרשימת התפוצה</a>
  </p>
</body>
</html>`,
    bodyText: `שלום {{userName}},

אתם מתקרבים למכסה החודשית של {{tierLimit}} חשבוניות בתוכנית {{tierName}}.

שתי דרכים להמשיך להעלות:

1. שדרוג התוכנית — Professional (50/חודש), Business (150/חודש), או Enterprise (500/חודש).
   {{upgradeUrl}}

2. להביא מפתח Anthropic משלכם — אתם משלמים ישירות ל-Anthropic והמכסה קופצת ל-500/חודש.
   {{byokSettingsUrl}}`,
  },
  {
    code: "conv-limit-reached",
    locale: "he",
    name: "הגעתם למכסת התוכנית",
    subject: "הגעתם למכסה של תוכנית {{tierName}}",
    templateType: "funnel",
    variables:
      '["userName","appUrl","tierName","tierLimit","upgradeUrl","byokSettingsUrl"]',
    bodyHtml: `
<!DOCTYPE html>
<html lang="he" dir="rtl">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="font-family:'Segoe UI',Arial,'Helvetica Neue',sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#1a1a1a;direction:rtl;text-align:right;">${LOGO_HEADER}
  <div style="background:#ffffff;padding:32px;border:1px solid #e5e7eb;border-radius:12px;">
    <h2 style="margin-top:0;color:#DC2626;">🚫 הגעתם למכסה של תוכנית {{tierName}}</h2>
    <p style="font-size:16px;line-height:1.6;">שלום {{userName}}, השתמשתם בכל {{tierLimit}} החשבוניות של תוכנית <strong>{{tierName}}</strong> החודש. ההעלאות מושהות עד שהמונה מתאפס — אלא אם בוחרים אחת מהאפשרויות הבאות:</p>

    <div style="background:#F9FAFB;padding:16px;border-radius:8px;margin:16px 0;">
      <p style="margin:0 0 6px 0;font-size:15px;"><strong>שדרוג התוכנית</strong></p>
      <p style="margin:4px 0;font-size:13px;color:#4b5563;">קופצים למסלול גבוה יותר וממשיכים להעלות מיד.</p>
      <div style="margin-top:10px;">
        <a href="{{upgradeUrl}}" style="display:inline-block;background:#DC2626;color:white;text-decoration:none;padding:12px 24px;border-radius:6px;font-weight:600;font-size:14px;">לשדרג עכשיו ←</a>
      </div>
    </div>

    <div style="background:#F9FAFB;padding:16px;border-radius:8px;margin:16px 0;">
      <p style="margin:0 0 6px 0;font-size:15px;"><strong>או להביא מפתח Anthropic משלכם</strong></p>
      <p style="margin:4px 0;font-size:13px;color:#4b5563;">מדביקים מפתח בהגדרות — משלמים ישירות ל-Anthropic, והמכסה עולה ל-500 חשבוניות בחודש.</p>
      <div style="margin-top:10px;">
        <a href="{{byokSettingsUrl}}" style="display:inline-block;background:#111827;color:white;text-decoration:none;padding:10px 20px;border-radius:6px;font-weight:600;font-size:14px;">להוספת מפתח ←</a>
      </div>
    </div>

    <p style="font-size:14px;color:#6b7280;">החשבוניות והמידע הקיימים שלכם בטוחים. המונה החודשי מתאפס בתחילת החודש הבא.</p>
  </div>
  <p style="font-size:12px;color:#9ca3af;text-align:center;margin-top:20px;">
    <a href="{{amazonSESUnsubscribeUrl}}" style="color:#9ca3af;">הסרה מרשימת התפוצה</a>
  </p>
</body>
</html>`,
    bodyText: `שלום {{userName}},

השתמשתם בכל {{tierLimit}} החשבוניות של תוכנית {{tierName}} החודש. שתי דרכים לשחרר את ההעלאות:

1. שדרוג התוכנית — {{upgradeUrl}}
2. להביא מפתח Anthropic משלכם (המכסה קופצת ל-500/חודש) — {{byokSettingsUrl}}

החשבוניות והמידע הקיימים שלכם בטוחים. המונה מתאפס בתחילת החודש הבא.`,
  },
];

// ── Funnels ─────────────────────────────────────────────────────────

const funnelDefs = [
  {
    code: "1.1",
    name: "Welcome Flow",
    funnelGroup: "onboarding",
    description: "Welcome email and first invoice nudge after signup",
    entryEvent: "SIGNUP",
    mutexGroup: "onboarding",
    steps: [
      { stepNumber: 1, templateCode: "onb-welcome", delayHours: 0, delayFrom: "funnel_entry" },
      { stepNumber: 2, templateCode: "onb-first-invoice", delayHours: 48, delayFrom: "previous_step" },
    ],
    exits: [
      { exitCondition: "FIRST_INVOICE_UPLOADED", isSuccess: true, description: "User uploaded first invoice" },
    ],
  },
  {
    code: "2.1",
    name: "Activation Flow",
    funnelGroup: "activation",
    description: "Celebrate first invoice and encourage continued usage",
    entryEvent: "FIRST_INVOICE_UPLOADED",
    mutexGroup: "activation",
    steps: [
      { stepNumber: 1, templateCode: "act-first-processed", delayHours: 1, delayFrom: "funnel_entry" },
      { stepNumber: 2, templateCode: "act-keep-going", delayHours: 168, delayFrom: "funnel_entry" }, // 7 days
    ],
    exits: [],
  },
  {
    code: "4.1",
    name: "Approaching Limit",
    funnelGroup: "conversion",
    description: "Notify when user is approaching their plan limit",
    entryEvent: "PLAN_LIMIT_APPROACHING",
    mutexGroup: "conversion",
    steps: [
      { stepNumber: 1, templateCode: "conv-approaching-limit", delayHours: 0, delayFrom: "funnel_entry" },
    ],
    exits: [
      { exitCondition: "SUBSCRIPTION_STARTED", isSuccess: true, description: "User upgraded" },
      { exitCondition: "USER_SET_OWN_KEYS", isSuccess: true, description: "User added their own Anthropic API key" },
    ],
  },
  {
    code: "4.2",
    name: "Limit Reached",
    funnelGroup: "conversion",
    description: "Notify when user hits their plan limit",
    entryEvent: "PLAN_LIMIT_REACHED",
    mutexGroup: "conversion",
    steps: [
      { stepNumber: 1, templateCode: "conv-limit-reached", delayHours: 0, delayFrom: "funnel_entry" },
    ],
    exits: [
      { exitCondition: "SUBSCRIPTION_STARTED", isSuccess: true, description: "User upgraded" },
      { exitCondition: "USER_SET_OWN_KEYS", isSuccess: true, description: "User added their own Anthropic API key" },
    ],
  },
];

async function main() {
  console.log("Seeding email templates...");

  // Upsert templates — natural key is (code, locale). Adding a new language is
  // a new row, never a migration. Renderer falls back to en when a locale row
  // is missing, so partial translations are safe.
  const allTemplates = [...templates, ...templatesHe];
  for (const tmpl of allTemplates) {
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
    console.log(`  ✓ Template: ${tmpl.code} [${tmpl.locale}] (${tmpl.name})`);
  }

  console.log("\nSeeding funnels...");

  for (const def of funnelDefs) {
    // Upsert funnel
    const [funnel] = await db
      .insert(emailFunnels)
      .values({
        code: def.code,
        name: def.name,
        funnelGroup: def.funnelGroup,
        description: def.description,
        entryEvent: def.entryEvent,
        mutexGroup: def.mutexGroup,
      })
      .onConflictDoUpdate({
        target: emailFunnels.code,
        set: {
          name: def.name,
          funnelGroup: def.funnelGroup,
          description: def.description,
          entryEvent: def.entryEvent,
          mutexGroup: def.mutexGroup,
        },
      })
      .returning();

    console.log(`  ✓ Funnel: ${def.code} (${def.name})`);

    // Delete existing steps and re-insert
    await db
      .delete(emailFunnelSteps)
      .where(eq(emailFunnelSteps.funnelId, funnel.id));

    for (const step of def.steps) {
      // Anchor the funnel-step FK on the English row. Hebrew (and future
      // locale) variants share the same `code` and are picked by the renderer
      // at send time based on the recipient's preferred_locale.
      const tmpl = await db.query.emailTemplates.findFirst({
        where: and(
          eq(emailTemplates.code, step.templateCode),
          eq(emailTemplates.locale, "en"),
        ),
      });
      if (!tmpl) {
        console.error(
          `    ✗ Template not found: ${step.templateCode} [en]`,
        );
        continue;
      }

      await db.insert(emailFunnelSteps).values({
        funnelId: funnel.id,
        stepNumber: step.stepNumber,
        emailTemplateId: tmpl.id,
        delayHours: step.delayHours,
        delayFrom: step.delayFrom,
      });
      console.log(`    Step ${step.stepNumber}: ${step.templateCode} (${step.delayHours}h delay)`);
    }

    // Delete existing exits and re-insert
    await db
      .delete(emailFunnelExits)
      .where(eq(emailFunnelExits.funnelId, funnel.id));

    for (const exit of def.exits) {
      await db.insert(emailFunnelExits).values({
        funnelId: funnel.id,
        exitCondition: exit.exitCondition,
        isSuccess: exit.isSuccess,
        description: exit.description,
      });
      console.log(`    Exit: ${exit.exitCondition}`);
    }
  }

  console.log("\nDone!");
  process.exit(0);
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
