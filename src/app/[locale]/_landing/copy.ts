/**
 * Hand-localised copy for the merged home page (Studio + Insights).
 *
 * Kept next to the page rather than in the shared dictionary because only the
 * landing page reads it. Both locales must keep the same shape: the page and
 * the mockups index into `landingCopy[locale]` without per-locale branching.
 *
 * ITA-approval claims live under `ita` and in the third FAQ item of each
 * locale. Re-check both if the approval status ever needs different wording.
 */
export const landingCopy = {
  en: {
    meta: {
      title: "Free Invoice Software for Israel, ITA-Approved | InvoLoops",
      description:
        "Free, ITA-approved invoicing: tax invoices, receipts, credit notes and proformas with automatic allocation numbers, plus spend-per-vendor insights. Open source.",
      ogAlt: "InvoLoops: free invoicing with ITA allocation numbers, and insights into your business",
      ogEyebrow: "InvoLoops · Studio + Insights",
      ogTitle: "Free invoicing. And the full picture of your business.",
      ogSub: "ITA allocation numbers · Spend per vendor · Issue from Claude (MCP) · Open source",
      appStudio: "Free invoicing software for Israeli businesses: tax invoices, receipts, credit notes, proformas and delivery notes with automatic ITA allocation numbers.",
      appInsights: "AI expense insights: reads supplier invoices, shows spend per vendor, profit and a VAT estimate, with instant search and ZIP download.",
    },
    ita: {
      badge: "ITA-approved invoicing software",
      proof: "Approved by the Israel Tax Authority",
    },
    nav: {
      studio: "Invoicing",
      insights: "Insights",
      ai: "AI & MCP",
      pricing: "Pricing",
      faq: "FAQ",
      license: "License",
      login: "Log in",
      cta: "Join free",
    },
    hero: {
      titleLead: "Free invoicing.",
      titleAccent: "And the full picture of your business.",
      subtitle:
        "Issue tax invoices, receipts, credit notes and proformas at no cost, with the ITA allocation number requested for you. Every supplier invoice you receive turns into insight: what you paid each vendor, what you actually kept, and where money is leaking.",
      primaryCta: "Create a free account",
      secondaryCta: "See how it works",
      micro: ["No credit card", "No monthly subscription", "Open source"],
    },
    proof: [
      "Automatic allocation numbers",
      "Digital signature + QR",
      "Tamper-proof archive",
      "Open source · AGPL-3.0",
    ],
    loop: {
      title: "Two sides of your business. One loop.",
      subtitle:
        "Most tools see only half: what you sell, or what you buy. InvoLoops sees both, so it can tell you what you really earned.",
      items: [
        {
          tag: "Money in",
          product: "Studio",
          body: "Issue and send legal documents to your customers. Track who still owes you.",
        },
        {
          tag: "Money out",
          product: "Insights",
          body: "Supplier invoices arrive by email or upload, and AI reads them for you.",
        },
        {
          tag: "Profit",
          product: "Both",
          body: "What's left in your pocket, month by month, without waiting for your accountant.",
        },
      ],
    },
    studio: {
      eyebrow: "InvoLoops Studio · 100% free",
      title: "Every document an Israeli business needs. For ₪0.",
      body: "Not a trial, not a paid tier, not \"5 invoices a month\". Every document type, unlimited customers, no subscription.",
      docTypesLabel: "Document types",
      docTypes: [
        "Tax invoice",
        "Tax invoice / receipt",
        "Receipt",
        "Credit invoice",
        "Proforma invoice",
        "Delivery note",
      ],
      features: [
        {
          title: "Allocation number, automatically",
          body: "Above the Israel Invoice threshold, the number is requested from the Tax Authority the moment you issue and printed on the document. Your customer can claim the VAT, and you never open a government portal.",
        },
        {
          title: "Reverse charge, done right",
          body: "Your buyer signs a digital consent to carry the VAT, and the invoice goes out at 0% with a special allocation number. A flow most invoicing tools simply don't support.",
        },
        {
          title: "Credit, never delete",
          body: "An issued document is signed and locked. Made a mistake? Issue a linked credit invoice in one click, with the full audit trail the law expects.",
        },
        {
          title: "Your brand, your language",
          body: "Logo, accent colour and template. Hebrew or English per customer, and ₪, $, € or any other currency.",
        },
        {
          title: "Email delivery & collections",
          body: "Send the signed PDF straight to your customer. The \"Who owes you\" view shows what's still unpaid, and one click marks it paid.",
        },
        {
          title: "Signed, archived, verifiable",
          body: "Every document is digitally signed, carries a QR verification code, and is kept in a tamper-protected archive with a full audit log.",
        },
      ],
      mockup: {
        windowTitle: "New document",
        typeLabel: "Document type",
        type: "Tax invoice",
        customerLabel: "Customer",
        customer: "Cohen Design Studio Ltd.",
        lineLabel: "Item",
        line: "Design consulting · September 2026",
        qty: "1",
        price: "₪3,500.00",
        issue: "Issue & send",
        previewBusiness: "Your Business Ltd.",
        previewDocTitle: "Tax Invoice",
        previewNumber: "2026-TI-000143",
        previewTo: "Bill to",
        subtotal: "Subtotal",
        vat: "VAT 18%",
        total: "Total",
        subtotalValue: "₪3,500.00",
        vatValue: "₪630.00",
        totalValue: "₪4,130.00",
        allocation: "Allocation no.",
        allocationValue: "Received from ITA",
        signed: "Digitally signed",
      },
    },
    insights: {
      eyebrow: "InvoLoops Insights",
      title: "The insights no invoice generator gives you.",
      body: "Forward supplier invoices by email, drop a PDF or snap a photo of a receipt. AI pulls out the vendor, date, amount and VAT, and you get a live picture of your business.",
      highlights: [
        {
          key: "vendors",
          title: "How much you paid each vendor",
          body: "Vendors ranked by spend, monthly trend, and period-over-period comparison. You'll spot the subscription you forgot to cancel within a minute.",
        },
        {
          key: "search",
          title: "Search and download in a second",
          body: "Type \"insurance\" and get every insurance invoice of the year. Filter by vendor, date or amount, then download them all as one ZIP, or as Excel for your accountant.",
        },
        {
          key: "profit",
          title: "Real profit, not a gut feeling",
          body: "Income next to expenses, month over month, plus a VAT estimate, all from the same records.",
        },
      ],
      more: [
        {
          title: "Email intake",
          body: "A personal forwarding address. Send supplier invoices to it and you're done.",
        },
        {
          title: "Duplicate catcher",
          body: "Same invoice arrived twice? You'll know before you pay it twice.",
        },
        {
          title: "Nothing counts until you approve",
          body: "Every extracted field shows a confidence score. Nothing reaches your reports until you've checked it.",
        },
        {
          title: "Your accountant, inside",
          body: "Invite them with their own login and permissions. Export the Uniform Structure (מבנה אחיד) and PCN874 files.",
        },
        {
          title: "Multi-currency",
          body: "Each invoice keeps its original currency. The dashboard shows totals in the currency you choose.",
        },
      ],
      vendorMockup: {
        title: "Spend by vendor",
        period: "Last 12 months",
        rows: [
          { name: "CloudDirect Hosting", value: "₪18,420", pct: 100 },
          { name: "Office Plus", value: "₪9,860", pct: 54 },
          { name: "Galil Printing", value: "₪7,240", pct: 39 },
          { name: "Mobile & Internet", value: "₪4,980", pct: 27 },
          { name: "Design Tools Pro", value: "₪2,310", pct: 13 },
        ],
        alert: "Design Tools Pro: +38% vs last quarter",
      },
      searchMockup: {
        query: "insurance",
        results: "4 invoices · ₪12,640",
        rows: [
          { vendor: "Magen Business Insurance", date: "2026-09-02", amount: "₪3,160" },
          { vendor: "Magen Business Insurance", date: "2026-06-01", amount: "₪3,160" },
          { vendor: "Magen Business Insurance", date: "2026-03-03", amount: "₪3,160" },
          { vendor: "Magen Business Insurance", date: "2026-01-04", amount: "₪3,160" },
        ],
        zip: "Download ZIP",
        excel: "Excel",
      },
      profitMockup: {
        income: "Income",
        expenses: "Expenses",
        profit: "Profit",
        incomeValue: "₪48,250",
        expensesValue: "₪19,730",
        profitValue: "₪28,520",
        months: ["Apr", "May", "Jun", "Jul", "Aug", "Sep"],
      },
    },
    ai: {
      eyebrow: "New · MCP",
      title: "Issue an invoice without opening the app.",
      body: "Connect InvoLoops to Claude, or any MCP client, once. From then on you just say what you need, and the invoice goes out. No forms, no menus.",
      steps: [
        {
          title: "Add the connector",
          body: "One address:",
          code: "involoops.com/api/mcp",
        },
        {
          title: "Sign in once",
          body: "A secure OAuth approval against your account. No passwords or keys to copy.",
        },
        {
          title: "Just ask",
          body: "Claude prepares a draft, shows it to you, and issues only after you confirm.",
        },
      ],
      askAlso: "You can ask questions too:",
      questions: [
        "How much did I pay suppliers last quarter?",
        "Who hasn't paid me yet?",
        "Which vendor grew the most this year?",
      ],
      devCta: "Developers: full REST API, webhooks and OpenAPI",
      chat: {
        appName: "Claude",
        user1:
          "Issue a tax invoice to Cohen Design Studio for ₪3,500 + VAT, design consulting for September, and email it to them.",
        assistant1: "Here's the draft:",
        draftType: "Tax invoice · Cohen Design Studio Ltd.",
        draftLine: "Design consulting · September 2026",
        draftTotal: "Total incl. 18% VAT",
        draftTotalValue: "₪4,130.00",
        confirm: "Issue and send?",
        user2: "Yes",
        doneTitle: "Issued",
        doneNumber: "2026-TI-000143",
        doneAllocation: "Allocation number received",
        doneSent: "Sent to office@cohen-design.co.il",
        tools: ["create_outbound_invoice_draft", "issue_outbound_invoice", "send_outbound_invoice"],
      },
    },
    audience: {
      title: "Built for the way Israeli businesses work",
      items: [
        {
          tag: "Osek Patur",
          body: "Receipts and documents without paying for software. Income and expenses in one place.",
        },
        {
          tag: "Osek Murshe",
          body: "Tax invoices with allocation numbers, a VAT estimate, and a clear view of your spend.",
        },
        {
          tag: "Companies (Ltd.)",
          body: "Team members with permissions, one consistent template, API and webhooks for your systems.",
        },
        {
          tag: "Accountants",
          body: "Access to a client's books without their password, Uniform Structure export, and every invoice in one place.",
        },
      ],
    },
    pricing: {
      title: "What does it cost? Most likely nothing.",
      subtitle: "No subscriptions. No feature paywalls.",
      studio: {
        tag: "Studio · Invoicing",
        price: "₪0",
        note: "Forever. Really.",
        bullets: [
          "All 6 document types",
          "ITA allocation numbers",
          "Unlimited customers",
          "Branded templates + email delivery",
          "MCP and REST API",
        ],
        cta: "Start issuing",
      },
      byok: {
        tag: "Insights · your Claude key",
        price: "₪0",
        note: "You pay Anthropic directly, typically a few cents per invoice.",
        bullets: [
          "Every Insights feature",
          "Your key is encrypted at rest",
          "Remove it anytime",
        ],
        cta: "Connect your key",
      },
      ourKey: {
        tag: "Insights · our key",
        price: "Symbolic fee",
        note: "The real AI cost plus a tiny margin to keep the lights on.",
        bullets: [
          "Zero setup",
          "Transparent per-invoice pricing",
          "Switch to your own key anytime",
        ],
        cta: "Use our key",
      },
      footnote: "PDFs that already contain text are read without any AI key.",
      recommended: "Start here",
    },
    trust: {
      title: "Why is it free? (And what's the catch?)",
      body: "The catch is in plain sight. InvoLoops is open source under AGPL-3.0: anyone can read the code and see exactly what happens to their data. We believe a small business shouldn't need a monthly subscription just to comply with the law. Two things pay for it: a small AI fee from those who choose to use our key, and sponsored offers from partners such as accountants and banks, always marked as sponsored. A partner gets your details only if you ask them to contact you.",
      items: [
        {
          title: "Your data is yours",
          body: "Every record is scoped to your account, and you can export everything anytime.",
        },
        {
          title: "Open code, on GitHub",
          body: "Read it, audit it, contribute to it. Nothing about your books happens in a black box.",
        },
        {
          title: "Built for Israeli law",
          body: "Gapless numbering, digital signatures, a locked archive and allocation numbers, by design rather than as an afterthought.",
        },
      ],
      github: "View the code on GitHub",
    },
    faq: {
      title: "Questions people ask",
      items: [
        {
          q: "Is it really free?",
          a: "Yes. Issuing documents in Studio is free with no limit on customers or document types. Insights is free when you bring your own Claude API key; if you use ours, there is a small, transparent per-invoice fee. PDFs that already contain text are read without any key.",
        },
        {
          q: "Will it stay free?",
          a: "Honestly, we can't promise what the future holds, but right now we have no plans to charge for it. And whatever happens, you're never locked in: there's no contract and no commitment, you can export all your data, and you're free to leave anytime.",
        },
        {
          q: "Is InvoLoops approved by the Israel Tax Authority?",
          a: "Yes. InvoLoops is registered with the ITA as invoicing software. To receive allocation numbers you authorize InvoLoops once from your personal area on gov.il. It takes about two minutes and is renewed every 90 days, and we remind you before it expires.",
        },
        {
          q: "What is an allocation number, and when do I need one?",
          a: "Under the Israel Invoice (חשבונית ישראל) reform, a tax invoice above a threshold needs a 9-digit allocation number from the Tax Authority, or your customer cannot deduct the VAT on it. Since June 2026 the threshold is ₪5,000 before VAT. InvoLoops requests the number automatically when you issue and prints it on the document.",
        },
        {
          q: "Tax invoice, tax invoice / receipt, or receipt: which one do I issue?",
          a: "A tax invoice when you charge VAT and haven't been paid yet. A tax invoice / receipt when you charge VAT and are paid at the same time. A receipt when you receive a payment, for example against a tax invoice you already issued, or as an Osek Patur.",
        },
        {
          q: "What is a proforma invoice (חשבון עסקה)?",
          a: "A request for payment that isn't a tax document. You send it before you're paid, and issue the tax invoice once the payment arrives. InvoLoops issues proformas, and delivery notes, alongside its tax documents.",
        },
        {
          q: "I made a mistake on an issued invoice. What now?",
          a: "Issued documents can't be edited or deleted, as the law requires. Issue a credit invoice against it in one click, then issue a corrected one. Drafts can be edited freely.",
        },
        {
          q: "Can I really issue an invoice without logging in?",
          a: "Yes. After a one-time connection of InvoLoops to Claude (or another MCP client), you ask in plain language and Claude prepares the draft, shows it to you, and issues it once you confirm. The document is the same signed, numbered document you would issue from the app.",
        },
        {
          q: "Can my accountant get access?",
          a: "Yes. Invite them from Settings → Team with their own login. You decide whether they can change settings.",
        },
        {
          q: "Do I have to use both products?",
          a: "No. Use only invoicing, only expense insights, or both, all under the same account. Using both is what unlocks the profit view.",
        },
        {
          q: "Is there a limit on how many documents I can issue?",
          a: "Up to 100 documents per customer per calendar day. It guards against a stuck automation and isn't a plan limit. If you genuinely need more, ask us.",
        },
        {
          q: "Does it work outside Israel?",
          a: "Yes. Templates, multi-currency, customers, email delivery, credit notes and all of Insights work for any business. The Tax Authority integration simply stays off.",
        },
      ],
    },
    finalCta: {
      title: "Your next invoice can go out in two minutes.",
      sub: "Create a free account, fill in your business details, and issue. No credit card.",
      primary: "Create a free account",
      secondary: "Talk to us",
    },
  },
  he: {
    meta: {
      title: "הפקת חשבוניות בחינם עם מספר הקצאה | InvoLoops",
      description:
        "תוכנה להפקת חשבוניות בחינם, מאושרת ע״י רשות המסים: חשבונית מס, קבלה, זיכוי וחשבון עסקה עם מספר הקצאה אוטומטי, ותובנות על ההוצאות לפי ספק. קוד פתוח.",
      ogAlt: "InvoLoops: הפקת חשבוניות בחינם עם מספר הקצאה, ותובנות על העסק",
      ogEyebrow: "InvoLoops · Studio + Insights",
      ogTitle: "חשבוניות בחינם. ותמונה מלאה של העסק.",
      ogSub: "מספרי הקצאה · הוצאות לפי ספק · הפקה מתוך Claude · קוד פתוח",
      appStudio: "תוכנה חינמית להפקת חשבוניות לעסקים בישראל: חשבונית מס, קבלה, חשבונית זיכוי, חשבון עסקה ותעודת משלוח, עם מספר הקצאה אוטומטי מרשות המסים.",
      appInsights: "תובנות הוצאות מבוססות AI: קריאת חשבוניות ספקים, הוצאות לפי ספק, רווח והערכת מע״מ, עם חיפוש מיידי והורדה כ־ZIP.",
    },
    ita: {
      badge: "תוכנה מאושרת ע״י רשות המסים",
      proof: "מאושרת ע״י רשות המסים",
    },
    nav: {
      studio: "הפקת חשבוניות",
      insights: "תובנות",
      ai: "AI ו־MCP",
      pricing: "מחיר",
      faq: "שאלות",
      license: "רישיון",
      login: "כניסה",
      cta: "הצטרפו בחינם",
    },
    hero: {
      titleLead: "חשבוניות בחינם.",
      titleAccent: "ותמונה מלאה של העסק.",
      subtitle:
        "מפיקים חשבונית מס, קבלה, זיכוי או חשבון עסקה בלי לשלם שקל, ומספר ההקצאה מרשות המסים מתבקש בשבילכם. וכל חשבונית ספק שנכנסת הופכת לתובנה: כמה שילמתם לכל ספק, כמה באמת נשאר לכם, ואיפה הכסף בורח.",
      primaryCta: "פתחו חשבון בחינם",
      secondaryCta: "ראו איך זה עובד",
      micro: ["בלי כרטיס אשראי", "בלי מנוי חודשי", "קוד פתוח"],
    },
    proof: [
      "מספרי הקצאה אוטומטיים",
      "חתימה דיגיטלית + QR",
      "ארכיון מוגן מפני שינויים",
      "קוד פתוח · AGPL-3.0",
    ],
    loop: {
      title: "שני הצדדים של העסק. לולאה אחת.",
      subtitle:
        "רוב הכלים רואים רק חצי: או את מה שאתם מוכרים, או את מה שאתם קונים. InvoLoops רואה את שניהם, ולכן יודע להגיד לכם כמה באמת הרווחתם.",
      items: [
        {
          tag: "כסף נכנס",
          product: "Studio",
          body: "מפיקים ושולחים ללקוחות מסמכים כחוק, ורואים מי עוד חייב לכם.",
        },
        {
          tag: "כסף יוצא",
          product: "Insights",
          body: "חשבוניות הספקים מגיעות במייל או בהעלאה, וה־AI קורא אותן בשבילכם.",
        },
        {
          tag: "רווח",
          product: "שניהם",
          body: "מה נשאר לכם בכיס, חודש אחרי חודש, בלי לחכות לרואה החשבון.",
        },
      ],
    },
    studio: {
      eyebrow: "InvoLoops Studio · חינם לגמרי",
      title: "כל מסמך שעסק בישראל צריך. ב־0 ₪.",
      body: "לא תקופת ניסיון, לא מסלול פרימיום ולא ״עד 5 חשבוניות בחודש״. כל סוגי המסמכים, לקוחות ללא הגבלה, בלי מנוי.",
      docTypesLabel: "סוגי מסמכים",
      docTypes: [
        "חשבונית מס",
        "חשבונית מס / קבלה",
        "קבלה",
        "חשבונית זיכוי",
        "חשבון עסקה (פרופורמה)",
        "תעודת משלוח",
      ],
      features: [
        {
          title: "מספר הקצאה, אוטומטית",
          body: "מעל סף חשבונית ישראל, המספר מתבקש מרשות המסים ברגע ההפקה ומודפס על המסמך. הלקוח שלכם יכול לקזז מע״מ, ואתם לא נכנסים לאף פורטל ממשלתי.",
        },
        {
          title: "חיוב הפוך (Reverse charge)",
          body: "הקונה חותם דיגיטלית על הסכמה לשאת במס, והחשבונית יוצאת ב־0% מע״מ עם מספר הקצאה מיוחד. תהליך שרוב תוכנות החשבוניות פשוט לא תומכות בו.",
        },
        {
          title: "זיכוי, אף פעם לא מחיקה",
          body: "מסמך שהופק נחתם וננעל. טעיתם? מפיקים חשבונית זיכוי מקושרת בלחיצה, עם תיעוד מלא בדיוק כמו שהחוק דורש.",
        },
        {
          title: "המיתוג שלכם, השפה שלכם",
          body: "לוגו, צבע ותבנית. עברית או אנגלית לכל לקוח, ו־₪, $, € או כל מטבע אחר.",
        },
        {
          title: "שליחה במייל ומעקב גבייה",
          body: "שולחים את ה־PDF החתום ישירות ללקוח. מסך ״מי חייב לי״ מראה מה עוד לא שולם, ובלחיצה מסמנים ששולם.",
        },
        {
          title: "חתום, מאורכב, ניתן לאימות",
          body: "כל מסמך נחתם דיגיטלית, מקבל קוד QR לאימות ונשמר בארכיון מוגן עם יומן ביקורת מלא.",
        },
      ],
      mockup: {
        windowTitle: "מסמך חדש",
        typeLabel: "סוג מסמך",
        type: "חשבונית מס",
        customerLabel: "לקוח",
        customer: "סטודיו כהן לעיצוב בע״מ",
        lineLabel: "פריט",
        line: "ייעוץ עיצוב · ספטמבר 2026",
        qty: "1",
        price: "3,500.00 ₪",
        issue: "הפקה ושליחה",
        previewBusiness: "העסק שלכם בע״מ",
        previewDocTitle: "חשבונית מס",
        previewNumber: "2026-TI-000143",
        previewTo: "לכבוד",
        subtotal: "סכום לפני מע״מ",
        vat: "מע״מ 18%",
        total: "סה״כ לתשלום",
        subtotalValue: "3,500.00 ₪",
        vatValue: "630.00 ₪",
        totalValue: "4,130.00 ₪",
        allocation: "מספר הקצאה",
        allocationValue: "התקבל מרשות המסים",
        signed: "חתום דיגיטלית",
      },
    },
    insights: {
      eyebrow: "InvoLoops Insights",
      title: "התובנות שאף מחולל חשבוניות לא נותן לכם.",
      body: "מעבירים חשבוניות ספקים במייל, גוררים PDF או מצלמים קבלה. ה־AI מחלץ ספק, תאריך, סכום ומע״מ, ואתם מקבלים תמונה חיה של העסק.",
      highlights: [
        {
          key: "vendors",
          title: "כמה שילמתם לכל ספק",
          body: "דירוג ספקים לפי הוצאה, מגמה חודשית והשוואה בין תקופות. תוך דקה תמצאו את המנוי ששכחתם לבטל.",
        },
        {
          key: "search",
          title: "חיפוש והורדה בשנייה",
          body: "מקלידים ״ביטוח״ ומקבלים את כל חשבוניות הביטוח של השנה. מסננים לפי ספק, תאריך או סכום, ומורידים הכול כ־ZIP אחד, או כקובץ Excel לרואה החשבון.",
        },
        {
          key: "profit",
          title: "רווח אמיתי, לא תחושת בטן",
          body: "הכנסות מול הוצאות, חודש מול חודש, והערכת מע״מ, הכול מאותם נתונים בדיוק.",
        },
      ],
      more: [
        {
          title: "קליטה מהמייל",
          body: "כתובת העברה אישית. שולחים אליה את חשבוניות הספקים, וזהו.",
        },
        {
          title: "תופס כפילויות",
          body: "אותה חשבונית הגיעה פעמיים? תדעו לפני שתשלמו פעמיים.",
        },
        {
          title: "שום דבר לא נספר בלי אישור",
          body: "לכל שדה שחולץ יש רמת ודאות. שום דבר לא נכנס לדוחות לפני שבדקתם.",
        },
        {
          title: "רואה החשבון בפנים",
          body: "הזמינו אותו עם כניסה והרשאות משלו. ייצוא מבנה אחיד וקובץ PCN874.",
        },
        {
          title: "ריבוי מטבעות",
          body: "כל חשבונית נשמרת במטבע המקורי, והדשבורד מציג סכומים במטבע שתבחרו.",
        },
      ],
      vendorMockup: {
        title: "הוצאות לפי ספק",
        period: "12 החודשים האחרונים",
        rows: [
          { name: "ענן ישיר אחסון", value: "18,420 ₪", pct: 100 },
          { name: "משרדים פלוס", value: "9,860 ₪", pct: 54 },
          { name: "דפוס הגליל", value: "7,240 ₪", pct: 39 },
          { name: "סלולר ואינטרנט", value: "4,980 ₪", pct: 27 },
          { name: "כלי עיצוב פרו", value: "2,310 ₪", pct: 13 },
        ],
        alert: "כלי עיצוב פרו: עלייה של 38% מהרבעון הקודם",
      },
      searchMockup: {
        query: "ביטוח",
        results: "4 חשבוניות · 12,640 ₪",
        rows: [
          { vendor: "מגן ביטוח עסקים", date: "02.09.2026", amount: "3,160 ₪" },
          { vendor: "מגן ביטוח עסקים", date: "01.06.2026", amount: "3,160 ₪" },
          { vendor: "מגן ביטוח עסקים", date: "03.03.2026", amount: "3,160 ₪" },
          { vendor: "מגן ביטוח עסקים", date: "04.01.2026", amount: "3,160 ₪" },
        ],
        zip: "הורדת ZIP",
        excel: "Excel",
      },
      profitMockup: {
        income: "הכנסות",
        expenses: "הוצאות",
        profit: "רווח",
        incomeValue: "48,250 ₪",
        expensesValue: "19,730 ₪",
        profitValue: "28,520 ₪",
        months: ["אפר׳", "מאי", "יוני", "יולי", "אוג׳", "ספט׳"],
      },
    },
    ai: {
      eyebrow: "חדש · MCP",
      title: "מפיקים חשבונית בלי להיכנס לאפליקציה.",
      body: "מחברים את InvoLoops ל־Claude, או לכל לקוח MCP, פעם אחת. מאותו רגע פשוט כותבים מה צריך, והחשבונית יוצאת. בלי טפסים ובלי תפריטים.",
      steps: [
        {
          title: "מוסיפים מחבר",
          body: "כתובת אחת:",
          code: "involoops.com/api/mcp",
        },
        {
          title: "מתחברים פעם אחת",
          body: "אישור מאובטח (OAuth) מול החשבון שלכם. בלי להעתיק סיסמאות או מפתחות.",
        },
        {
          title: "פשוט מבקשים",
          body: "Claude מכין טיוטה, מראה לכם, ומפיק רק אחרי שאישרתם.",
        },
      ],
      askAlso: "ואפשר גם לשאול:",
      questions: [
        "כמה שילמתי לספקים ברבעון האחרון?",
        "מי עוד לא שילם לי?",
        "איזה ספק עלה הכי הרבה השנה?",
      ],
      devCta: "מפתחים: REST API מלא, Webhooks ו־OpenAPI",
      chat: {
        appName: "Claude",
        user1:
          "תפיק חשבונית מס לסטודיו כהן על 3,500 ₪ + מע״מ, ייעוץ עיצוב לספטמבר, ותשלח להם במייל",
        assistant1: "הכנתי טיוטה:",
        draftType: "חשבונית מס · סטודיו כהן לעיצוב בע״מ",
        draftLine: "ייעוץ עיצוב · ספטמבר 2026",
        draftTotal: "סה״כ כולל מע״מ 18%",
        draftTotalValue: "4,130.00 ₪",
        confirm: "להפיק ולשלוח?",
        user2: "כן",
        doneTitle: "הופקה חשבונית",
        doneNumber: "2026-TI-000143",
        doneAllocation: "התקבל מספר הקצאה",
        doneSent: "נשלחה ל־office@cohen-design.co.il",
        tools: ["create_outbound_invoice_draft", "issue_outbound_invoice", "send_outbound_invoice"],
      },
    },
    audience: {
      title: "בנוי בדיוק לאיך שעסקים בישראל עובדים",
      items: [
        {
          tag: "עוסק פטור",
          body: "קבלות ומסמכים בלי לשלם על תוכנה. הכנסות והוצאות במקום אחד.",
        },
        {
          tag: "עוסק מורשה",
          body: "חשבוניות מס עם מספר הקצאה, הערכת מע״מ ותמונה ברורה של ההוצאות.",
        },
        {
          tag: "חברה בע״מ",
          body: "חברי צוות עם הרשאות, תבנית אחידה לכולם, API ו־Webhooks למערכות שלכם.",
        },
        {
          tag: "רואי חשבון",
          body: "גישה לספרים של הלקוח בלי הסיסמה שלו, ייצוא מבנה אחיד וכל החשבוניות במקום אחד.",
        },
      ],
    },
    pricing: {
      title: "כמה זה עולה? כנראה כלום.",
      subtitle: "בלי מנויים. בלי פיצ׳רים נעולים מאחורי תשלום.",
      studio: {
        tag: "Studio · הפקת חשבוניות",
        price: "0 ₪",
        note: "לתמיד. באמת.",
        bullets: [
          "כל 6 סוגי המסמכים",
          "מספרי הקצאה מרשות המסים",
          "לקוחות ללא הגבלה",
          "תבניות ממותגות ושליחה במייל",
          "MCP ו־REST API",
        ],
        cta: "מתחילים להפיק",
      },
      byok: {
        tag: "Insights · מפתח Claude שלכם",
        price: "0 ₪",
        note: "משלמים ישירות ל־Anthropic, בדרך כלל אגורות בודדות לחשבונית.",
        bullets: [
          "כל יכולות Insights",
          "המפתח שלכם מוצפן",
          "מסירים אותו מתי שרוצים",
        ],
        cta: "מחברים מפתח משלכם",
      },
      ourKey: {
        tag: "Insights · המפתח שלנו",
        price: "דמי שימוש סמליים",
        note: "עלות ה־AI האמיתית ועוד מרווח קטן שמחזיק את השירות.",
        bullets: [
          "בלי שום הגדרה",
          "תמחור שקוף לכל חשבונית",
          "עוברים למפתח שלכם מתי שרוצים",
        ],
        cta: "משתמשים במפתח שלנו",
      },
      footnote: "קובצי PDF שכבר מכילים טקסט נקראים גם בלי מפתח AI.",
      recommended: "מתחילים כאן",
    },
    trust: {
      title: "למה זה בחינם? (ומה הקאץ׳?)",
      body: "הקאץ׳ גלוי לעין. InvoLoops הוא קוד פתוח ברישיון AGPL-3.0: כל אחד יכול לקרוא את הקוד ולראות בדיוק מה קורה עם הנתונים שלו. אנחנו מאמינים שעסק קטן לא צריך לשלם מנוי חודשי רק כדי לעמוד בחוק. שני דברים מממנים את השירות: דמי AI סמליים ממי שבוחר להשתמש במפתח שלנו, והצעות ממומנות של שותפים כמו רואי חשבון ובנקים, שתמיד מסומנות כממומנות. שותף מקבל את הפרטים שלכם רק אם ביקשתם שייצור איתכם קשר.",
      items: [
        {
          title: "הנתונים שלכם שייכים לכם",
          body: "כל רשומה משויכת לחשבון שלכם בלבד, ואפשר לייצא הכול בכל רגע.",
        },
        {
          title: "קוד פתוח ב־GitHub",
          body: "קראו, בדקו, תרמו. שום דבר בספרים שלכם לא קורה בקופסה שחורה.",
        },
        {
          title: "נבנה לחוק הישראלי",
          body: "מספור רציף, חתימה דיגיטלית, ארכיון נעול ומספרי הקצאה, כחלק מהתכנון ולא כתוספת מאוחרת.",
        },
      ],
      github: "לקוד ב־GitHub",
    },
    faq: {
      title: "שאלות שאנשים שואלים",
      items: [
        {
          q: "זה באמת בחינם?",
          a: "כן. הפקת מסמכים ב־Studio חינמית, בלי הגבלה על לקוחות או על סוגי מסמכים. Insights חינמי כשמחברים מפתח Claude משלכם; אם משתמשים במפתח שלנו, יש דמי שימוש קטנים ושקופים לכל חשבונית. קובצי PDF שכבר מכילים טקסט נקראים גם בלי מפתח.",
        },
        {
          q: "זה יישאר בחינם?",
          a: "בכנות, אנחנו לא יכולים להבטיח מה יהיה בעתיד, אבל כרגע אין לנו שום תוכנית לגבות על זה כסף. ובכל מקרה, אתם לא מתחייבים לכלום: אין חוזה ואין התחייבות, אפשר לייצא את כל הנתונים ולעזוב מתי שרוצים.",
        },
        {
          q: "האם InvoLoops מאושרת ע״י רשות המסים?",
          a: "כן. InvoLoops רשומה ברשות המסים כתוכנה להפקת חשבוניות. כדי לקבל מספרי הקצאה מאשרים את InvoLoops פעם אחת מהאזור האישי ב־gov.il. זה לוקח כשתי דקות ומתחדש כל 90 יום, ואנחנו מזכירים לכם לפני שזה פג.",
        },
        {
          q: "מה זה מספר הקצאה ומתי צריך אותו?",
          a: "במסגרת רפורמת חשבונית ישראל, חשבונית מס מעל סכום מסוים צריכה מספר הקצאה בן 9 ספרות מרשות המסים, אחרת הלקוח לא יוכל לקזז את המע״מ. מיוני 2026 הסף הוא 5,000 ₪ לפני מע״מ. InvoLoops מבקשת את המספר אוטומטית ברגע ההפקה ומדפיסה אותו על המסמך.",
        },
        {
          q: "חשבונית מס, חשבונית מס / קבלה או קבלה: מה להפיק?",
          a: "חשבונית מס, כשגובים מע״מ והתשלום עוד לא התקבל. חשבונית מס / קבלה, כשגובים מע״מ והתשלום מתקבל באותו רגע. קבלה, כשמקבלים תשלום, למשל מול חשבונית מס שכבר הופקה, או כעוסק פטור.",
        },
        {
          q: "מה זה חשבון עסקה (פרופורמה)?",
          a: "דרישת תשלום שאינה מסמך מס. שולחים אותה לפני שמקבלים את הכסף, ומפיקים חשבונית מס כשהתשלום מגיע. InvoLoops מפיקה חשבונות עסקה ותעודות משלוח לצד מסמכי המס.",
        },
        {
          q: "טעיתי בחשבונית שכבר הופקה. מה עושים?",
          a: "מסמך שהופק לא ניתן לעריכה או למחיקה, כפי שהחוק דורש. מפיקים מולו חשבונית זיכוי בלחיצה, ואז חשבונית מתוקנת. טיוטות אפשר לערוך בחופשיות.",
        },
        {
          q: "באמת אפשר להפיק חשבונית בלי להתחבר לאתר?",
          a: "כן. אחרי חיבור חד־פעמי של InvoLoops ל־Claude (או ללקוח MCP אחר), מבקשים בשפה פשוטה, ו־Claude מכין טיוטה, מראה לכם ומפיק אחרי שאישרתם. המסמך זהה למסמך שהייתם מפיקים מהאפליקציה: חתום וממוספר.",
        },
        {
          q: "רואה החשבון שלי יכול לקבל גישה?",
          a: "כן. מזמינים אותו מהגדרות ← צוות, עם כניסה משלו. אתם מחליטים אם הוא יכול לשנות הגדרות.",
        },
        {
          q: "חייבים להשתמש בשני המוצרים?",
          a: "לא. אפשר רק להפיק חשבוניות, רק לנהל הוצאות, או את שניהם, תחת אותו חשבון. השילוב של שניהם הוא מה שפותח את מסך הרווח.",
        },
        {
          q: "יש הגבלה על כמות המסמכים?",
          a: "עד 100 מסמכים ללקוח ביום קלנדרי. זו הגנה מפני אוטומציה תקועה ולא מגבלת חבילה. אם באמת צריך יותר, פנו אלינו.",
        },
        {
          q: "זה עובד גם מחוץ לישראל?",
          a: "כן. תבניות, ריבוי מטבעות, לקוחות, שליחה במייל, זיכויים וכל Insights עובדים לכל עסק. החיבור לרשות המסים פשוט נשאר כבוי.",
        },
      ],
    },
    finalCta: {
      title: "החשבונית הבאה שלכם יכולה לצאת בעוד שתי דקות.",
      sub: "פותחים חשבון בחינם, ממלאים פרטי עסק, ומפיקים. בלי כרטיס אשראי.",
      primary: "פתחו חשבון בחינם",
      secondary: "דברו איתנו",
    },
  },
} as const;

export type LandingCopy = (typeof landingCopy)[keyof typeof landingCopy];
