import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { Geist, Geist_Mono } from "next/font/google";
import "vanilla-cookieconsent/dist/cookieconsent.css";
import "@/styles/cookieconsent-invoice.css";
import "./globals.css";
import { Footer } from "@/components/footer";
import { AppToaster } from "@/components/ui/sonner";
import { LocaleAutoSetToast } from "@/components/shared/locale-auto-set-toast";
import CookieConsentProvider from "@/components/cookie-consent-provider";
import AccessibilityWidget from "@/components/accessibility-widget";
import { I18nProvider } from "@/lib/i18n/client";
import { getDictionary, getLocale } from "@/lib/i18n/server";
import { localeConfig } from "@/lib/i18n";

const geistSans = Geist({
  subsets: ["latin"],
  variable: "--font-geist-sans",
  display: "swap",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
  display: "swap",
});

// Deliberately no fallback container id. A self-hosted instance must not
// load someone else's GTM container: that would send its users' activity to
// a third party the operator never chose, and would make us a recipient of
// data we have no business receiving. Unset means no GTM at all.
const GTM_ID = process.env.NEXT_PUBLIC_GTM_ID?.trim() || null;

const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://localhost:3000";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0f0a1e" },
  ],
};

export async function generateMetadata(): Promise<Metadata> {
  const [locale, dict] = await Promise.all([getLocale(), getDictionary()]);
  const tag = localeConfig[locale].tag;
  return {
    metadataBase: new URL(siteUrl),
    title: {
      default: dict.meta.titleDefault,
      template: dict.meta.titleTemplate,
    },
    description: dict.meta.description,
    applicationName: dict.common.appName,
    authors: [{ name: "TTP GO LTD" }],
    creator: "InvoLoops",
    formatDetection: {
      telephone: false,
      email: false,
      address: false,
    },
    openGraph: {
      type: "website",
      locale: tag.replace("-", "_"),
      siteName: dict.common.appName,
      title: dict.meta.titleDefault,
      description: dict.meta.description,
      url: siteUrl,
    },
    twitter: {
      card: "summary_large_image",
      title: dict.meta.titleDefault,
      description: dict.meta.description,
    },
    robots: {
      index: true,
      follow: true,
    },
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const [locale, dict] = await Promise.all([getLocale(), getDictionary()]);
  const cfg = localeConfig[locale];

  return (
    <html
      lang={cfg.tag.split("-")[0]}
      dir={cfg.dir}
      className={`h-full antialiased ${geistSans.variable} ${geistMono.variable}`}
    >
      <head>
        {/* GTM ships its own JS + the consent shim further down — preconnecting
            shaves the TLS handshake off the critical path (~150ms on cold). */}
        {GTM_ID && (
          <>
            <link rel="preconnect" href="https://www.googletagmanager.com" crossOrigin="" />
            <link rel="dns-prefetch" href="https://www.googletagmanager.com" />
          </>
        )}
        {/* next/font already self-hosts Geist via /_next/static, but Google
            Fonts CSS still loads at build-time from fonts.googleapis.com. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      </head>
      <body className="min-h-full flex flex-col font-sans">
        <I18nProvider locale={locale} dict={dict}>
        {/* Google Tag Manager (noscript) — immediately after opening body */}
        {GTM_ID && (
          <noscript>
            <iframe
              src={`https://www.googletagmanager.com/ns.html?id=${GTM_ID}`}
              height={0}
              width={0}
              title="Google Tag Manager"
              style={{ display: "none", visibility: "hidden" }}
            />
          </noscript>
        )}
        {/* Console ring buffer for the "I have a problem with this invoice"
            report — patches console.* synchronously before any other client
            JS runs so hydration / fetch errors get captured. Mirror the
            store shape in src/lib/client-logs.ts. */}
        <Script id="client-log-capture" strategy="beforeInteractive">
          {`(function(){var MAX=500;var s=window.__clientLogStore=window.__clientLogStore||{entries:[],patched:false};if(s.patched)return;s.patched=true;function fmt(a){try{if(a instanceof Error)return a.name+': '+a.message+'\\n'+(a.stack||'');if(typeof a==='string')return a;return JSON.stringify(a);}catch(e){return String(a);}}function push(level,args){try{s.entries.push({timestamp:new Date().toISOString(),level:level,message:Array.prototype.map.call(args,fmt).join(' ')});if(s.entries.length>MAX)s.entries.splice(0,s.entries.length-MAX);}catch(e){}}push('log',['[client-log-capture] installed at '+new Date().toISOString()+' on '+location.pathname+' ua='+(navigator.userAgent||'?')]);['log','info','warn','error'].forEach(function(level){var orig=console[level].bind(console);console[level]=function(){push(level,arguments);orig.apply(console,arguments);};});window.addEventListener('error',function(ev){push('error',['[window.error] '+ev.message+' @ '+ev.filename+':'+ev.lineno+':'+ev.colno]);});window.addEventListener('unhandledrejection',function(ev){push('error',['[unhandledrejection] '+fmt(ev.reason)]);});if(typeof window.fetch==='function'){var origFetch=window.fetch.bind(window);var BLOCK=/google-analytics\\.com|googletagmanager\\.com|doubleclick\\.net|cookieyes\\.com|cookielaw\\.org|hotjar\\.com|sentry\\.io|segment\\.com|fullstory\\.com/;function shouldLogFetch(method,url,status){if(BLOCK.test(url))return false;if(/[?&]_rsc=/.test(url))return false;if(/\\/api\\/files\\/preview/.test(url))return false;if(method!=='GET')return true;return status>=400;}window.fetch=function(input,init){var url=typeof input==='string'?input:(input&&input.url)||String(input);var method=((init&&init.method)||(input&&input.method)||'GET').toUpperCase();var t0=Date.now();return origFetch(input,init).then(function(res){if(shouldLogFetch(method,url,res.status))push(res.status>=400?'error':'log',['[fetch] '+method+' '+url+' -> '+res.status+' ('+(Date.now()-t0)+'ms)']);return res;},function(err){if(!BLOCK.test(url))push('error',['[fetch] '+method+' '+url+' -> threw '+(err&&err.message||err)+' ('+(Date.now()-t0)+'ms)']);throw err;});};}var origPush=history.pushState;history.pushState=function(){push('log',['[nav] pushState '+arguments[2]]);return origPush.apply(this,arguments);};window.addEventListener('popstate',function(){push('log',['[nav] popstate '+location.pathname+location.search]);});})();`}
        </Script>
        {/* Consent Mode defaults before GTM loads tags */}
        <Script id="gtm-consent-default" strategy="beforeInteractive">
          {`
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('consent', 'default', {
              analytics_storage: 'denied',
              ad_storage: 'denied',
              ad_user_data: 'denied',
              ad_personalization: 'denied',
              functionality_storage: 'granted',
              security_storage: 'granted',
              wait_for_update: 500
            });
          `}
        </Script>
        {/* Google Tag Manager — only when an operator has configured a container */}
        {GTM_ID && (
          <Script id="google-tag-manager" strategy="beforeInteractive">
            {`(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
})(window,document,'script','dataLayer','${GTM_ID}');`}
          </Script>
        )}
        <div id="a11y-page-content" className="flex min-h-0 flex-1 flex-col">
          {children}
        </div>
        <Footer />
        <AppToaster />
        <LocaleAutoSetToast />
        <CookieConsentProvider />
        <AccessibilityWidget />
        </I18nProvider>
      </body>
    </html>
  );
}
