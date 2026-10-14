import type { Metadata } from "next";
import Link from "next/link";
import { buildMetadata, localePath } from "@/lib/seo/metadata";
import { getLocale } from "@/lib/i18n/server";
import { legalContactEmail } from "@/lib/legal/contact";

export async function generateMetadata(): Promise<Metadata> {
  return buildMetadata({
    path: "/privacy",
    copy: {
      en: {
        title: "Privacy Policy",
        description:
          "How TTP GO LTD collects, uses, stores, and protects your data in InvoLoops. Compliant with the Israeli Protection of Privacy Law and GDPR where applicable.",
      },
      he: {
        title: "מדיניות פרטיות",
        description:
          "כיצד TTP GO LTD אוספת, משתמשת, שומרת ומגנה על המידע שלכם ב־InvoLoops. תואם לחוק הגנת הפרטיות הישראלי ול־GDPR במקומות הרלוונטיים.",
      },
    },
  });
}

const LAST_UPDATED = "October 5, 2026";

export default async function PrivacyPage() {
  const locale = await getLocale();
  const contact = legalContactEmail();
  return (
    <>
      <h1 className="text-3xl font-bold text-gray-900">Privacy Policy</h1>
      <p className="text-sm text-gray-500">Last updated: {LAST_UPDATED}</p>

      <p>
        This Privacy Policy explains how <strong>TTP GO LTD</strong>{" "}
        (&ldquo;TTP GO&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;, or
        &ldquo;our&rdquo;) collects, uses, stores, and protects personal data
        when you use InvoLoops (the &ldquo;Service&rdquo;). The
        Service is a platform for managing a business&rsquo;s documents and
        money: receiving and extracting data from expense invoices, issuing
        tax invoices, receipts and other documents (including allocation
        numbers from the Israel Tax Authority), and reporting on income,
        expenses and VAT. It also shows sponsored offers from partner
        businesses (see Sections 3 and 7).
      </p>

      <p>
        We are committed to protecting your privacy and handling your data in
        accordance with the Israeli Protection of Privacy Law, 5741-1981 and
        its regulations, and, where applicable, the EU General Data Protection
        Regulation (GDPR).
      </p>

      <h2>1. Who We Are (Data Controller)</h2>
      <p>
        The data controller responsible for your personal data is TTP GO LTD,
        an Israeli private limited company. For any privacy-related inquiries,
        requests, or complaints, please contact us at{" "}
        <a href={`mailto:${contact}`}>{contact}</a>.
      </p>

      <p>
        Under the Israeli Protection of Privacy Law, TTP GO is the owner of
        the database (&ldquo;בעל המאגר&rdquo;) for the data about you as a
        user of the Service: your account, billing and usage. The documents
        and records you enter about your own customers and suppliers belong
        to your business: for that data you are the owner, and we hold and
        process it on your behalf and on your instructions
        (&ldquo;מחזיק&rdquo;).
      </p>

      <h2>2. Information We Collect</h2>
      <p>We collect the following categories of information:</p>

      <h3>2.1 Account Information</h3>
      <ul>
        <li>Full name</li>
        <li>Email address</li>
        <li>
          Password (stored only as a salted bcrypt hash; we never see or store
          your plaintext password)
        </li>
        <li>Profile image (if provided)</li>
        <li>Account creation and email verification timestamps</li>
      </ul>

      <h3>2.2 Business Details</h3>
      <p>
        The details of your business that appear on the documents you issue:
        legal name, business type, VAT or company registration number,
        address, phone, email, logo, and document settings.
      </p>

      <h3>2.3 Invoice and Customer Data</h3>
      <p>
        When you upload invoices or other documents, we collect and store the
        files themselves and the data contained within them, which may include:
      </p>
      <ul>
        <li>Invoice files (PDF, PNG, JPEG, WebP, TIFF)</li>
        <li>Vendor and supplier names, aliases, and categories</li>
        <li>
          Invoice numbers, dates, amounts, currency, VAT amounts, and
          descriptions
        </li>
        <li>Extracted text, extraction method, and confidence scores</li>
        <li>Review notes, approval status, and rejection reasons</li>
        <li>
          A cryptographic hash (SHA-256) of each uploaded file, used to detect
          duplicates
        </li>
        <li>
          Documents you issue (tax invoices, receipts, credit invoices and
          others): their contents, amounts, dates, allocation numbers and
          status
        </li>
        <li>
          Your customers&rsquo; details: names, VAT or ID numbers, email
          addresses, phone numbers and addresses
        </li>
      </ul>
      <p>
        Because invoices are business records, they contain personal data about
        third parties (for example vendor contacts and your customers). You
        are responsible for ensuring you have the legal right to enter such
        data into the Service.
      </p>

      <h3>2.4 Usage and Technical Data</h3>
      <ul>
        <li>Session cookies required for authentication</li>
        <li>
          Audit logs of actions you take in the Service (e.g., approving,
          rejecting, updating, or deleting invoices)
        </li>
        <li>
          Server logs (IP address, browser type, timestamps) used for security
          and debugging
        </li>
        <li>
          Aggregated analytics and product usage data collected through the
          third-party tools described in Section 13 (Cookies, Analytics &amp;
          Tracking), subject to your consent choices
        </li>
      </ul>

      <h3>2.5 Email Forwarding Service</h3>
      <p>
        When you create an account, the Service generates a unique email address
        for your use. Invoices and documents you forward to this address are
        automatically received and processed by our servers. To protect against
        spoofing, we verify DKIM signatures on incoming emails; messages that
        fail cryptographic sender verification are rejected. We collect and
        store the email message metadata (sender address, subject line,
        timestamps), file attachments, and extracted invoice data. Duplicate
        messages are automatically detected and ignored. You are responsible for
        ensuring that any third-party information contained in forwarded emails
        is shared lawfully.
      </p>
      <p>
        The mailbox that receives these emails is operated by us on Google
        Workspace (Gmail), so Google processes the forwarded messages as our
        service provider.
      </p>

      <h3>2.6 API Keys and Connected Apps</h3>
      <p>
        If you choose to provide your own API key for AI extraction services,
        we encrypt the key at rest using industry-standard encryption. The key
        is decrypted only momentarily when making requests on your behalf and
        is never logged, displayed in full, or shared. You may remove your API
        key at any time, and removal takes effect immediately.
      </p>
      <p>
        If you create InvoLoops API keys or register webhooks, we store the
        key or signing secret only in hashed form, together with the
        permissions you granted, the addresses you registered, when and from
        which IP address a key was last used, and a log of webhook
        deliveries. If you connect an app through our MCP server, we store
        the access you granted it and the tokens issued to it. Data you
        direct us to send to a webhook or connected app is sent at your
        instruction.
      </p>

      <h3>2.7 Payment Information</h3>
      <p>
        If you subscribe to a paid plan, payment processing is handled by
        Stripe, Inc. We do not store your full credit card number.
        Stripe&rsquo;s use of your payment data is governed by Stripe&rsquo;s
        privacy policy (
        <a
          href="https://stripe.com/privacy"
          target="_blank"
          rel="noopener noreferrer"
        >
          https://stripe.com/privacy
        </a>
        ). We receive from Stripe only the information necessary to manage
        your subscription, such as payment status, last four digits of your
        card, and billing cycle dates.
      </p>

      <h3>2.8 Reverse-Charge Consent (Your Customers&rsquo; Signatures)</h3>
      <p>
        When a user asks one of their customers to agree to a reverse-charge
        invoice, the customer receives a link and signs on a page of the
        Service. We record the signer&rsquo;s name, role (if given), drawn
        signature, the time, their IP address and browser, the email address
        the link was sent to, and the text they agreed to. The purpose is to
        keep evidence of the consent the VAT rules require for a
        reverse-charge invoice. The record belongs to the user who requested
        it and is kept with that invoice for as long as tax law requires the
        invoice to be kept (at least 7 years from the end of the tax year).
        A signer may ask that user, or us, to see or correct it.
      </p>

      <h3>2.9 Team Members and Accountants</h3>
      <p>
        If you invite someone to your account, we store their email address,
        the permissions you gave them, and a record of the actions they take
        in your account.
      </p>

      <h3>2.10 Sponsored Offers</h3>
      <p>
        We record which sponsored offers were shown to you, which you hid,
        and which you asked to be contacted about. When you ask to be
        contacted, we keep a copy of exactly the details you agreed to share
        with that partner, as a record of your consent.
      </p>

      <h3>2.11 Is Providing This Information Required?</h3>
      <p>
        No law requires you to give us personal data. Without account
        information we cannot open an account, and without the details a tax
        document must carry (for example, a customer&rsquo;s name and, above
        the allocation threshold, their VAT number) the Service cannot issue
        that document.
      </p>

      <h2>3. How We Use Your Data</h2>
      <p>We process your personal data for the following purposes:</p>
      <ul>
        <li>To create and manage your account and authenticate you</li>
        <li>
          To provide the core Service: storing, organizing, extracting, and
          displaying invoice data
        </li>
        <li>
          To automatically extract structured data from uploaded documents
          using text parsing and AI-based vision models (see Section 5)
        </li>
        <li>To detect duplicate uploads via file hashing</li>
        <li>To maintain audit trails for accounting and compliance</li>
        <li>To secure the Service, prevent abuse, and troubleshoot issues</li>
        <li>
          To show sponsored offers from partner businesses (such as
          accountants, banks, insurers or financing providers). Some offers
          are shown to all users. Others we choose from figures in your
          account, for example unpaid invoices, VAT due, revenue so far this
          year, your business type, or whether an accountant is connected.
          This matching runs on our servers; partners do not see your account
          or these figures.
        </li>
        <li>
          To send you emails about your account and the Service, and, if you
          agreed to receive them, marketing emails (you can unsubscribe at any
          time)
        </li>
        <li>
          To comply with legal obligations under Israeli and, where
          applicable, EU law
        </li>
      </ul>

      <h2>4. Legal Basis for Processing (GDPR)</h2>
      <p>Where GDPR applies, we rely on the following legal bases:</p>
      <ul>
        <li>
          <strong>Contract:</strong> processing necessary to provide the
          Service you signed up for.
        </li>
        <li>
          <strong>Legitimate interests:</strong> securing the Service, preventing
          fraud, improving functionality, and choosing which sponsored offer to
          show you (which you can object to, see Section 10).
        </li>
        <li>
          <strong>Legal obligation:</strong> where we must retain or disclose
          data under applicable law.
        </li>
        <li>
          <strong>Consent:</strong> where you have explicitly consented, such as
          marketing emails, optional cookies, and sharing your details with a
          sponsored partner (you may withdraw consent at any time).
        </li>
      </ul>

      <h2>5. Automated Data Extraction</h2>
      <p>
        To extract fields such as vendor, date, and amount from your uploaded
        documents, the Service uses a combination of text-based parsing and, as
        a fallback for scanned or image-based documents, a third-party
        AI-powered vision model. When vision-based extraction is used, the
        contents of the relevant document are transmitted to the AI provider
        solely for the purpose of extracting structured data, and are not used
        by us or the provider to train public models. No decisions with legal
        or similarly significant effects are made about you based solely on
        automated processing.
      </p>
      <p>
        AI extraction is currently provided by Anthropic, PBC (Claude), San
        Francisco, USA. If you supply your own Anthropic API key, the request
        is made under your own account with Anthropic. We will update this
        Policy before using another provider.
      </p>
      <p>
        The provider processes document data solely for extraction purposes. We
        maintain a Data Processing Agreement or equivalent contractual
        safeguards with it. Where your data is transferred to providers located
        outside the European Economic Area, such transfers are made subject to
        appropriate safeguards as described in Section 6.
      </p>

      <h2>6. Where Your Data Is Stored</h2>
      <p>
        Account data, invoice data, vendors, uploaded files and audit logs are
        stored on a server we rent from OVHcloud, in its data centre in
        Canada. TTP GO LTD administers the server; the database and the file
        storage both run on it, and data is logically isolated per account.
      </p>
      <p>
        Keeping the data in Canada is a transfer of data outside Israel. We
        make it under the Protection of Privacy (Transfer of Data to Databases
        Abroad) Regulations, 5761-2001: Canada is a country to which personal
        data may be transferred from the European Union, and the European
        Commission recognises it as providing an adequate level of protection
        &mdash; which is also the basis for EU residents&rsquo; data.
      </p>
      <p>
        Connections to the Israel Tax Authority, for allocation numbers, pass
        through a server of ours in Israel. Other providers listed in
        section 7 process the data they receive where they operate. If we move
        where your data is stored, we will update this Policy first.
      </p>

      <h2>7. Data Sharing and Disclosure</h2>
      <p>We may share data only with:</p>
      <ul>
        <li>
          <strong>Service providers (processors)</strong> acting on our behalf,
          such as hosting, database, object storage, and AI extraction
          providers, each bound by confidentiality and data protection
          obligations.
        </li>
        <li>
          <strong>Legal and regulatory authorities</strong> where required by
          Israeli law, court order, or valid legal process.
        </li>
        <li>
          <strong>The Israel Tax Authority</strong>: when you issue a tax
          invoice that needs an allocation number, the invoice&rsquo;s details
          (including your customer&rsquo;s VAT number and the amounts) are sent
          to the Tax Authority, as VAT law requires. Reports you choose to
          produce (such as the uniform-structure export or the PCN874 file)
          are files you submit yourself.
        </li>
        <li>
          <strong>Email delivery (Amazon Web Services &mdash; Amazon SES)</strong>{" "}
          for sending invoices, signature requests and account emails: the
          recipient&rsquo;s address and the message.
        </li>
        <li>
          <strong>Google (Google Workspace)</strong>, which operates the
          mailbox that receives emails you forward to your InvoLoops address,
          as our service provider.
        </li>
        <li>
          <strong>Sponsored partners</strong>, only when you ask to be
          contacted about one of their offers. Before anything is sent, we
          show you the exact details the partner will receive (for example
          your name, email, phone number, business name, or the total of your
          unpaid invoices), and nothing is sent unless you confirm. We keep a
          record of what you agreed to share. After that, the partner handles
          those details under its own privacy policy.
        </li>
        <li>
          <strong>People and apps you give access to</strong>: team members
          and accountants you invite see your account within the permissions
          you grant, and apps you connect through API keys, webhooks or our
          MCP server receive the data you authorise.
        </li>
        <li>
          <strong>Successors</strong> in connection with a merger, acquisition,
          or sale of assets, subject to this Policy.
        </li>
        <li>
          <strong>Payment processor (Stripe, Inc.)</strong> for subscription
          billing, bound by their Data Processing Agreement.
        </li>
        <li>
          <strong>AI extraction provider (Anthropic)</strong> for automated
          document processing, bound by a Data Processing Agreement or
          equivalent contractual safeguards.
        </li>
      </ul>

      <h2>8. Data Retention</h2>
      <p>We retain your data according to the following schedule:</p>
      <p>
        Account information is retained for as long as your account remains
        active, and deleted within 30 days of account closure, unless longer
        retention is required by law.
      </p>
      <p>
        Invoice data and uploaded files are retained for as long as your account
        remains active. Upon account deletion, invoice data is deleted within 30
        days, except where we are required to retain records for tax or
        accounting purposes under Israeli law (typically 7 years from the end of
        the relevant tax year).
      </p>
      <p>
        Server logs are retained for up to 12 months for security and debugging
        purposes.
      </p>
      <p>
        Audit logs are retained for as long as your account is active plus 7
        years, to comply with accounting record-keeping requirements.
      </p>
      <p>
        Records of sponsored offers shown, hidden and confirmed, including the
        copy of details you agreed to share, are kept while your account is
        active and deleted with it.
      </p>
      <p>
        You may request deletion of your account and associated data at any time
        by contacting us at{" "}
        <a href={`mailto:${contact}`}>{contact}</a>. We will
        process deletion requests within 30 days, subject to any legal retention
        obligations.
      </p>

      <h2>9. Security</h2>
      <h3>9.1 Technical and organizational measures</h3>
      <p>
        We implement technical and organizational measures designed to protect
        your data, including encryption in transit (HTTPS), bcrypt password
        hashing, server-side session validation, per-user data isolation,
        parameterized database queries, and access controls. However, no method
        of transmission or storage is 100% secure, and we cannot guarantee
        absolute security.
      </p>
      <p>
        Additionally, login attempts and password reset requests are
        rate-limited to prevent brute-force attacks. Password reset links are
        single-use, cryptographically random, and expire within one hour.
      </p>
      <p>
        Your identity is re-verified on every request using a signed session
        token. Changes to your account status (such as role changes or access
        revocation) take effect immediately.
      </p>
      <h3>9.2 Data Breach Notification</h3>
      <p>
        In the event of a personal data breach that is likely to result in a
        risk to your rights and freedoms, we will notify the relevant
        supervisory authority (the Israeli Privacy Protection Authority or,
        where applicable, an EU data protection authority) within 72 hours of
        becoming aware of the breach. Where the breach is likely to result in a
        high risk to you, we will also notify you directly without undue delay,
        providing information about the nature of the breach and steps you can
        take to protect yourself.
      </p>

      <h2>10. Your Rights</h2>
      <p>
        Under the Israeli Protection of Privacy Law you may review the data
        about you held in our database (section 13) and ask us to correct or
        delete data that is wrong, incomplete, unclear or out of date (section
        14). Subject to applicable law, you also have the right to:
      </p>
      <ul>
        <li>Access the personal data we hold about you</li>
        <li>Request correction of inaccurate or incomplete data</li>
        <li>
          Request deletion (&ldquo;right to be forgotten&rdquo;) of your data
        </li>
        <li>Restrict or object to certain processing</li>
        <li>Request portability of your data in a machine-readable format</li>
        <li>Withdraw consent where processing is based on consent</li>
        <li>
          Object to your data being used to choose sponsored offers for you.
          You can hide any single offer, or turn off &ldquo;Use my figures to
          choose offers&rdquo; in Settings &rarr; Data. We then stop using your
          data to choose offers, and you see only offers shown to all users.
        </li>
        <li>
          Lodge a complaint with the Israeli Privacy Protection Authority or, if
          you are in the EU, your local data protection authority
        </li>
      </ul>
      <p>
        To exercise any of these rights, contact{" "}
        <a href={`mailto:${contact}`}>{contact}</a>. We will respond
        within the timeframes required by applicable law.
      </p>

      <h2>11. Children</h2>
      <p>
        The Service is intended solely for users who are{" "}
        <strong>18 years of age or older</strong>. We do not knowingly collect
        personal data from children under 18.
        If you believe a minor has provided us with personal data, please
        contact us and we will delete it.
      </p>

      <h2>12. Business Use</h2>
      <p>
        The Service is designed for business and professional use. If you use
        the Service on behalf of a company or organization, you represent that
        you have authority to bind that entity to this Privacy Policy and our
        Terms of Service.
      </p>

      <h2>13. Cookies, Analytics &amp; Tracking</h2>
      <p>
        The Service uses cookies and similar technologies in three categories:
      </p>
      <ul>
        <li>
          <strong>Strictly necessary cookies.</strong> Required for core
          functionality such as authentication, session management, security,
          and remembering your cookie preferences. These are always on and do
          not require your consent.
        </li>
        <li>
          <strong>Analytics cookies (optional, consent-based).</strong> Used to
          understand how users interact with the Service so we can improve it.
          These are loaded only if you grant consent via our cookie banner.
        </li>
        <li>
          <strong>Advertising cookies (optional, consent-based).</strong> Used
          to measure and run our own advertising on other sites, as described
          in Section 13.1. These are separate from the sponsored offers shown
          inside the Service, which use no cookies.
        </li>
      </ul>

      <h3>13.1 Consent Categories and Google Consent Mode v2</h3>
      <p>Our cookie banner exposes three categories:</p>
      <ul>
        <li>
          <strong>Strictly necessary</strong> — always on.
        </li>
        <li>
          <strong>Analytics</strong> — off by default; when you opt in, tools
          such as Google Analytics and Microsoft Clarity are loaded through
          Google Tag Manager.
        </li>
        <li>
          <strong>Advertising</strong> — off by default; when you opt in, tools
          such as the Meta (Facebook) Pixel and Google Ads conversion tags are
          loaded through Google Tag Manager for conversion measurement, audience
          building, and retargeting.
        </li>
      </ul>
      <p>
        We implement Google&rsquo;s Consent Mode v2. By default,{" "}
        <code>analytics_storage</code>, <code>ad_storage</code>,{" "}
        <code>ad_user_data</code>, and <code>ad_personalization</code> are set
        to denied until you make a choice in our cookie banner. Only{" "}
        <code>functionality_storage</code> and <code>security_storage</code> are
        granted by default, as they are strictly necessary. Your choices in the
        Analytics and Advertising categories directly control which of these
        signals are updated to granted.
      </p>

      <h3>13.2 Third-Party Analytics and Tag Management Tools</h3>
      <p>
        Subject to your consent, the Service may load the following third-party
        tools:
      </p>
      <ul>
        <li>
          <strong>Google Tag Manager (GTM).</strong> Provided by Google Ireland
          Limited. GTM is a tag container used to deploy and manage tags; it
          does not set tracking cookies on its own but can load other tags
          (such as Google Analytics) based on your consent choices.
        </li>
        <li>
          <strong>Google Analytics 4 (GA4).</strong> Provided by Google Ireland
          Limited. Used to collect aggregated usage statistics such as page
          views, session duration, device type, approximate geolocation (based on
          IP), and interactions with the Service. GA4 sets cookies such as{" "}
          <code>_ga</code>, <code>_gid</code>, and <code>_gat</code>, which are
          automatically cleared if you withdraw analytics consent. IP addresses
          are truncated/anonymized where supported.
        </li>
        <li>
          <strong>Microsoft Clarity.</strong> Provided by Microsoft Corporation.
          Used to understand how users interact with the Service through
          aggregated metrics, heatmaps, and session replays. Clarity may record
          interactions such as mouse movements, clicks, scrolls, and page
          navigation. We configure Clarity to mask sensitive input fields by
          default, but you should avoid entering highly sensitive personal data
          into fields that are not clearly required.
        </li>
        <li>
          <strong>Meta (Facebook) Pixel.</strong> Provided by Meta Platforms
          Ireland Ltd. Used, subject to your consent, for conversion
          measurement, audience building, and retargeting advertising on
          Facebook, Instagram, and other Meta properties. The Meta Pixel may set
          cookies such as <code>_fbp</code> and <code>fr</code>, and may
          transmit events (such as page views, sign-ups, or other interactions)
          to Meta. Meta is a joint controller with us for certain
          pixel-collected data under the Meta Controller Addendum.
        </li>
        <li>
          <strong>Additional tags (future integrations).</strong> We may, from
          time to time, add further measurement, analytics, error-monitoring,
          advertising, or marketing tags through GTM. Any such tag will only be
          loaded under an existing consent category you have already approved
          (for example, an additional analytics provider under the
          &ldquo;analytics&rdquo; category). We will update this Policy to name
          the specific provider when we add a tag that: (i) introduces a new
          consent category; (ii) materially changes the scope of data collected;
          or (iii) transfers data to a new jurisdiction or recipient not already
          listed here. Minor additions within an existing category may be
          reflected only in a future revision of this Policy.
        </li>
      </ul>
      <p>
        These providers act as independent or joint data controllers for the
        data they collect through their own tools. Their use of data is governed
        by their own privacy policies:
      </p>
      <ul>
        <li>
          Google:{" "}
          <a
            href="https://policies.google.com/privacy"
            target="_blank"
            rel="noopener noreferrer"
          >
            https://policies.google.com/privacy
          </a>
        </li>
        <li>
          Microsoft Clarity:{" "}
          <a
            href="https://privacy.microsoft.com/privacystatement"
            target="_blank"
            rel="noopener noreferrer"
          >
            https://privacy.microsoft.com/privacystatement
          </a>
        </li>
        <li>
          Meta (Facebook):{" "}
          <a
            href="https://www.facebook.com/privacy/policy/"
            target="_blank"
            rel="noopener noreferrer"
          >
            https://www.facebook.com/privacy/policy/
          </a>
        </li>
      </ul>

      <h3>13.3 International Transfers</h3>
      <p>
        Google, Microsoft, and Meta may process data outside the European
        Economic Area and Israel, including in the United States. Where such
        transfers involve personal data of EU or Israeli residents, they are
        made subject to appropriate safeguards, such as the European
        Commission&rsquo;s Standard Contractual Clauses and Israeli Privacy
        Protection Regulations (Transfer of Data to Databases Abroad),
        5761-2001.
      </p>

      <h3>13.4 Managing Your Choices</h3>
      <p>
        You can accept, reject, or customize your cookie preferences at any time
        via the cookie banner and the &ldquo;Preferences&rdquo; link it
        provides. Rejecting analytics cookies will not affect your ability to
        use the core features of the Service. You can also block or delete
        cookies directly in your browser settings.
      </p>

      <h2>14. Changes to This Policy</h2>
      <p>
        We may update this Privacy Policy from time to time. Material changes
        will be notified through the Service or by email. The &ldquo;Last
        updated&rdquo; date at the top reflects the latest revision.
      </p>

      <h2>15. Contact</h2>
      <p>
        TTP GO LTD
        <br />
        Email: <a href={`mailto:${contact}`}>{contact}</a>
      </p>

      <hr />
      <p className="text-sm">
        See also our{" "}
        <Link href={localePath("/terms", locale)} className="underline">
          Terms of Service
        </Link>
        .
      </p>
      <p className="text-sm text-gray-500">
        © 2026 TTP GO LTD. All rights reserved.
      </p>
    </>
  );
}
