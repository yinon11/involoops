import type { Metadata } from "next";
import Link from "next/link";
import { buildMetadata, localePath } from "@/lib/seo/metadata";
import { getLocale } from "@/lib/i18n/server";
import { legalContactEmail } from "@/lib/legal/contact";

export async function generateMetadata(): Promise<Metadata> {
  return buildMetadata({
    path: "/terms",
    copy: {
      en: {
        title: "Terms of Service",
        description:
          "Terms and conditions governing your use of InvoLoops, operated by TTP GO LTD. Read before creating an account or using the service.",
      },
      he: {
        title: "תנאי שימוש",
        description:
          "תנאים והתניות החלים על השימוש שלכם ב־InvoLoops, מופעל על ידי TTP GO LTD. קראו לפני יצירת חשבון או שימוש בשירות.",
      },
    },
  });
}

const LAST_UPDATED = "October 5, 2026";

export default async function TermsPage() {
  const locale = await getLocale();
  const contact = legalContactEmail();
  return (
    <>
      <h1 className="text-3xl font-bold text-gray-900">Terms of Service</h1>
      <p className="text-sm text-gray-500">Last updated: {LAST_UPDATED}</p>

      <p>
        These Terms of Service (&ldquo;Terms&rdquo;) constitute a binding
        agreement between you (&ldquo;you&rdquo; or &ldquo;User&rdquo;) and{" "}
        <strong>TTP GO LTD</strong>, an Israeli private limited company
        (&ldquo;TTP GO&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;, or
        &ldquo;our&rdquo;), governing your access to and use of InvoLoops and
        related services (collectively, the &ldquo;Service&rdquo;). By creating an account or using the Service,
        you agree to these Terms. If you do not agree, do not use the Service.
      </p>

      <h2>1. The Service</h2>
      <p>
        The Service is a web-based platform for managing a business&rsquo;s
        documents and money. It lets Users:
      </p>
      <ul>
        <li>
          receive and upload expense invoices (including by email
          forwarding), automatically extract data from them,
          and manage vendors, approvals, duplicates and accounting periods;
        </li>
        <li>
          issue their own documents, such as tax invoices, receipts, credit
          invoices, proforma invoices and delivery notes, including requesting
          allocation numbers from the Israel Tax Authority, and send them to
          customers;
        </li>
        <li>
          view income, expenses, VAT and profit, and export data and reports
          (for example uniform-structure and PCN874 files);
        </li>
        <li>
          give access to team members and accountants, and connect other
          software through API keys, webhooks and the Service&rsquo;s MCP
          server.
        </li>
      </ul>
      <p>
        The Service also shows sponsored offers from third parties (see
        Section 9). It is designed primarily for Israeli businesses and
        supports Hebrew and English.
      </p>

      <h2>2. Eligibility</h2>
      <p>
        You must be at least <strong>18 years old</strong> and legally capable
        of entering into a binding contract to use the Service. By using the
        Service, you represent and warrant that you meet these requirements.
        The Service is intended for business use.
      </p>

      <h2>3. Accounts and Security</h2>
      <ul>
        <li>You must provide accurate and complete information when creating an account.</li>
        <li>You are responsible for maintaining the confidentiality of your credentials and for all activities under your account.</li>
        <li>You agree to notify us immediately at <a href={`mailto:${contact}`}>{contact}</a> of any unauthorized access or security breach.</li>
        <li>We reserve the right to suspend or terminate accounts that violate these Terms or are used in a manner harmful to the Service or other users.</li>
      </ul>

      <h2>4. Fees, Plans, and Usage Limits</h2>
      <p>
        The Service may be offered on a <strong>free tier</strong>, paid
        subscription tiers, promotional or grandfathered pricing, and/or
        arrangements where you supply your own third-party API keys (for
        example, an Anthropic/Claude key) in exchange for higher usage limits
        or reduced charges from us. All such offerings are subject to usage
        limits, feature availability, and the terms shown in the Service.
        Sponsored offers (Section 9) may appear on every plan, including paid
        plans; paying for a plan does not remove them unless the plan
        expressly says so.
      </p>
      <p>
        <strong>Free access is provided at our discretion.</strong> Any free
        tier, trial, promotional access, credit, or other no-cost use of the
        Service is provided <strong>gratuitously, as a revocable accommodation,
        and at our sole discretion</strong>. It constitutes a personal,
        non-exclusive, non-transferable, revocable licence to use the Service on
        the terms then in effect, and confers <strong>no vested right,
        entitlement, or property interest</strong> of any kind. We may, at any
        time and in our sole discretion, with or without cause and — to the
        maximum extent permitted by applicable law — without prior notice:
      </p>
      <ul>
        <li>
          (a) modify, reduce, or withdraw any feature, allowance, quota, usage
          limit, or storage made available on a free basis;
        </li>
        <li>
          (b) impose, increase, or vary charges for access or usage previously
          provided free of charge;
        </li>
        <li>
          (c) suspend, limit, or <strong>discontinue the free tier in whole or
          in part</strong>, whether temporarily or permanently; and
        </li>
        <li>
          (d) determine, vary, or revoke eligibility for free access, whether
          generally, by category of user, or for an individual account, without
          being obliged to apply the same treatment to any other user.
        </li>
      </ul>
      <p>
        <strong>No commitment as to duration.</strong> The free tier is offered
        <strong> only for so long as we elect to offer it</strong>. Nothing in
        these Terms, in any pricing page, marketing material, or other
        communication, nor our past or continued provision of free access,
        shall be construed as a commitment to provide free access for any
        minimum period, as a course of dealing or established practice, as a
        waiver of this Section, or as creating any expectation or reliance that
        free access will continue on the same terms or at all.
      </p>
      <p>
        <strong>No liability for withdrawal.</strong> To the maximum extent
        permitted by applicable law, we shall have no liability to you or to any
        third party for any modification, suspension, limitation, or
        discontinuation of free access, including for any loss of data, revenue,
        profits, goodwill, or anticipated savings.
      </p>
      <p>
        <strong>Scope of this provision.</strong> This provision applies to
        no-cost access only. It does not affect a paid subscription in respect
        of a billing period for which you have already paid, which is governed
        by the remainder of this Section 4. Where mandatory provisions of
        applicable law — including Israeli consumer protection law, to the
        extent it applies to you — require notice, a cure period, or a refund,
        those provisions prevail over this provision to the extent of the
        conflict.
      </p>
      <p>
        <strong>Pricing changes.</strong> We reserve the right, in our sole
        discretion, to <strong>change prices, fees, plan names, invoice
        limits, and billing practices at any time</strong>, including for users
        who previously paid a lower or different rate, users on a free tier,
        users who do not currently pay us, and users who use their own API keys
        or other third-party services to power parts of the Service. We may
        decide to charge fees for access or usage that was previously free or
        discounted, including for accounts that rely on bring-your-own-key
        arrangements. Where required by applicable law, we will provide notice;
        otherwise, updates may be posted in the Service or these Terms.
      </p>
      <p>
        Continued use of the Service after a change constitutes your acceptance
        of the updated fees and limits, except where applicable law gives you
        additional rights.
      </p>

      <h2>5. User Content</h2>
      <p>
        &ldquo;User Content&rdquo; means any files, invoices, vendor data,
        notes, or other information you upload or submit to the Service. You
        retain all ownership rights in your User Content.
      </p>
      <p>
        By uploading User Content, you grant TTP GO a limited, non-exclusive,
        worldwide, royalty-free license to host, store, process, transmit,
        display, and otherwise use your User Content solely as necessary to
        provide, maintain, and improve the Service for you, and to perform
        automated data extraction on your behalf.
      </p>
      <p>You represent and warrant that:</p>
      <ul>
        <li>You own or have all necessary rights to your User Content;</li>
        <li>Your User Content and its processing do not violate any law, contract, or third-party right (including privacy, data protection, intellectual property, or confidentiality rights);</li>
        <li>You will not upload content that is unlawful, infringing, defamatory, malicious, or contains viruses or harmful code.</li>
      </ul>

      <h2>6. Automated Data Extraction</h2>
      <p>
        The Service uses automated text parsing and, when necessary, an
        AI-powered vision model to extract fields from your documents. Extracted
        data is provided on an &ldquo;as-is&rdquo; basis and may contain errors
        or omissions. You are solely responsible for reviewing and verifying
        the accuracy of extracted data before relying on it for any accounting,
        tax, legal, or financial purpose.
      </p>

      <h2>7. Documents You Issue</h2>
      <p>
        The Service is a tool; the documents you issue through it are yours.
        You are responsible for their content and correctness, including
        amounts, VAT, customer details, document type and dates, for issuing
        them on time, and for meeting your obligations under tax and VAT law.
        An allocation number from the Israel Tax Authority, or the absence of
        one, is the Tax Authority&rsquo;s decision; we pass on its response
        and are not responsible for it. Issued documents cannot be edited or
        deleted, only cancelled or credited, as the law requires.
      </p>
      <p>
        Tax law requires issued documents and the records behind them to be
        kept for at least 7 years from the end of the tax year. We keep them
        for that period even if you close your account (see Section 14), and
        you should keep your own copies as well.
      </p>

      <h2>8. Access You Give Others</h2>
      <p>
        You may invite team members or an accountant to your account, create
        API keys, register webhooks, and connect apps to the Service (for
        example through its MCP server). Anyone or anything you give access to
        acts on your behalf: you are responsible for what they do within that
        access, for choosing the permissions you grant, and for keeping API
        keys and secrets confidential. You can revoke access at any time in
        the Service. Data you direct us to send to a webhook or connected app
        leaves the Service at your instruction.
      </p>

      <h2>9. Sponsored Offers</h2>
      <p>
        The Service shows sponsored offers from third-party businesses
        (&ldquo;Partners&rdquo;), such as accountants, banks, insurers and
        financing providers. Offers are clearly labelled &ldquo;Sponsored&rdquo;
        and may be chosen using figures in your account, as described in our
        Privacy Policy. We may be paid by Partners, including when you ask to
        be contacted.
      </p>
      <ul>
        <li>
          Partners are independent of us. We do not endorse them or guarantee
          their products, prices, availability or conduct, and showing an
          offer is not financial, tax or legal advice.
        </li>
        <li>
          Your details are sent to a Partner only if you ask to be contacted
          and confirm the details shown to you. Any agreement you then make is
          between you and the Partner, under the Partner&rsquo;s terms.
        </li>
        <li>
          You can hide any offer, or stop your figures being used to choose
          offers in Settings &rarr; Data; you will then see only offers shown
          to all users. Offers are not a condition of using the
          Service&rsquo;s features.
        </li>
      </ul>

      <h2>10. Acceptable Use</h2>
      <p>You agree not to:</p>
      <ul>
        <li>Use the Service for any unlawful purpose or in violation of these Terms;</li>
        <li>Upload content you do not have the right to upload;</li>
        <li>Attempt to gain unauthorized access to the Service, other accounts, or underlying infrastructure;</li>
        <li>Interfere with, disrupt, or overload the Service (including by excessive automated requests);</li>
        <li>Scrape or harvest data from the Service, or access it other than through its user interface, published API, or MCP server;</li>
        <li>Circumvent any usage limits, access controls, or security measures.</li>
      </ul>
      <p>
        These rules concern your use of the hosted Service operated by us.
        They do not limit the rights the open-source licence gives you over
        the Service&rsquo;s source code (Section 11).
      </p>

      <h2>11. Intellectual Property and Open Source</h2>
      <p>
        The Service&rsquo;s source code is open source, published under the
        GNU Affero General Public License, version 3 (AGPL-3.0). Your rights
        to use, study, modify and share that code come from that licence, and
        nothing in these Terms restricts them.
      </p>
      <p>
        The names &ldquo;InvoLoops&rdquo; and &ldquo;TTP GO&rdquo;, the logos,
        and the content of the hosted Service other than the source code and
        your User Content are owned by TTP GO LTD and are not licensed to you,
        except as needed to use the Service. If you run your own copy of the
        software, do not present it as the Service or as operated by us.
      </p>

      <h2>12. Privacy</h2>
      <p>
        Your use of the Service is also governed by our{" "}
        <Link href={localePath("/privacy", locale)} className="underline">
          Privacy Policy
        </Link>
        , which describes how we collect, use, and protect your personal data.
      </p>

      <h2>13. Third-Party Services</h2>
      <p>
        The Service relies on certain third-party providers (including cloud
        hosting, email delivery, payments, AI extraction, and the Israel Tax
        Authority&rsquo;s systems), and shows offers from Partners (Section
        9). We are not
        responsible for the availability, content, or practices of third-party
        services, except to the extent required by applicable data protection
        law.
      </p>

      <h2>14. Suspension and Termination</h2>
      <p>
        You may stop using the Service and request account deletion at any
        time by contacting{" "}
        <a href={`mailto:${contact}`}>{contact}</a>. We may suspend
        or terminate your access, with or without notice, if you violate these
        Terms, misuse the Service, or if we are required to do so by law. Upon
        termination, your right to use the Service ceases immediately. Before
        closing your account, export anything you need. Issued documents and
        the records the law requires us to keep are retained for the legal
        period (Section 7) and then deleted.
        Provisions that by their nature should survive termination (including
        ownership, disclaimers, liability limitations, and governing law) will
        survive.
      </p>

      <h2>15. Disclaimers</h2>
      <p>
        THE SERVICE IS PROVIDED ON AN &ldquo;AS IS&rdquo; AND &ldquo;AS
        AVAILABLE&rdquo; BASIS, WITHOUT WARRANTIES OF ANY KIND, EXPRESS OR
        IMPLIED, INCLUDING WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
        PARTICULAR PURPOSE, ACCURACY, NON-INFRINGEMENT, OR UNINTERRUPTED
        OPERATION. WE DO NOT WARRANT THAT DATA EXTRACTION WILL BE ACCURATE OR
        COMPLETE. THE SERVICE IS NOT A SUBSTITUTE FOR PROFESSIONAL ACCOUNTING,
        TAX, OR LEGAL ADVICE.
      </p>

      <h2>16. Limitation of Liability</h2>
      <p>
        TO THE MAXIMUM EXTENT PERMITTED BY LAW, TTP GO LTD AND ITS DIRECTORS,
        EMPLOYEES, AND AGENTS SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL,
        SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR ANY LOSS OF PROFITS,
        REVENUE, DATA, OR GOODWILL, ARISING OUT OF OR RELATING TO YOUR USE OF
        THE SERVICE, WHETHER BASED ON WARRANTY, CONTRACT, TORT, OR ANY OTHER
        LEGAL THEORY. TO THE EXTENT LIABILITY CANNOT BE EXCLUDED, OUR TOTAL
        AGGREGATE LIABILITY TO YOU FOR ALL CLAIMS ARISING OUT OF OR RELATING
        TO THESE TERMS OR THE SERVICE SHALL NOT EXCEED ONE HUNDRED US DOLLARS
        (USD 100). BECAUSE THE SERVICE IS OFFERED ON A FREE TIER, YOU
        ACKNOWLEDGE THAT THIS LIMITATION IS REASONABLE.
      </p>

      <h2>17. Indemnification</h2>
      <p>
        You agree to indemnify, defend, and hold harmless TTP GO LTD and its
        affiliates from any claims, damages, liabilities, and expenses
        (including reasonable legal fees) arising out of your User Content,
        your use of the Service, or your violation of these Terms or any
        applicable law.
      </p>

      <h2>18. Governing Law and Jurisdiction</h2>
      <p>
        These Terms and any dispute arising out of or relating to them or the
        Service shall be governed by and construed in accordance with the laws
        of the <strong>State of Israel</strong>, without regard to conflict of
        laws principles. The competent courts of <strong>Tel Aviv-Jaffa,
        Israel</strong> shall have exclusive jurisdiction over any dispute
        arising from or in connection with these Terms or the Service.
      </p>

      <h2>19. Changes to the Terms</h2>
      <p>
        We may update these Terms <strong>at any time</strong>, including
        provisions relating to <strong>fees, payment, eligibility for free or
        discounted access, and bring-your-own-key or similar programs</strong>.
        If we make material changes, we will use reasonable efforts to notify you
        through the Service or by email where appropriate. Your continued use of
        the Service after the effective date of the updated Terms constitutes
        your acceptance of them, unless applicable law requires a different
        process. No provision in these Terms guarantees a permanent price,
        grandfathered rate, or perpetual free access for any category of user.
      </p>

      <h2>20. Miscellaneous</h2>
      <ul>
        <li>If any provision of these Terms is held to be unenforceable, the remaining provisions will remain in full force and effect.</li>
        <li>Our failure to enforce any right or provision is not a waiver of that right.</li>
        <li>You may not assign these Terms without our prior written consent. We may assign these Terms in connection with a merger, acquisition, or sale of assets.</li>
        <li>These Terms, together with the Privacy Policy, constitute the entire agreement between you and TTP GO LTD regarding the Service.</li>
      </ul>

      <h2>21. Contact</h2>
      <p>
        TTP GO LTD
        <br />
        Email: <a href={`mailto:${contact}`}>{contact}</a>
      </p>

      <hr />
      <p className="text-sm">
        See also our{" "}
        <Link href={localePath("/privacy", locale)} className="underline">
          Privacy Policy
        </Link>
        .
      </p>
    </>
  );
}
