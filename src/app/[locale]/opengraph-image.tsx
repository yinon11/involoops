import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { getLocaleEdge } from "@/lib/i18n/edge";
import { landingCopy } from "./_landing/copy";

export const alt = landingCopy.en.meta.ogAlt;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * Heebo Bold (SIL OFL, licence beside the file) covers Hebrew and Latin.
 * Read from disk rather than fetched from Google Fonts: their URLs are
 * versioned, and the one this card used to fetch started returning 404.
 */
const HEEBO_PATH = join(process.cwd(), "src/app/[locale]/_landing/fonts/Heebo-Bold.ttf");

const HEBREW = /[\u0590-\u05FF]/;

/**
 * Satori (the renderer behind ImageResponse) has no bidi algorithm: it draws
 * every word's characters left to right, so Hebrew comes out mirrored. Lay
 * the words out right to left ourselves and reverse the characters of each
 * Hebrew word; Latin words such as "Claude" keep their order.
 */
function RtlLine({ text, style }: { text: string; style: React.CSSProperties }) {
  return (
    <div
      style={{
        ...style,
        display: "flex",
        flexDirection: "row-reverse",
        flexWrap: "wrap",
        columnGap: "0.28em",
      }}
    >
      {text.split(" ").map((word, i) => (
        <span key={i}>{HEBREW.test(word) ? [...word].reverse().join("") : word}</span>
      ))}
    </div>
  );
}

/**
 * Per-locale share card for the home page, and for the other `[locale]`
 * pages that don't define their own.
 */
export default async function OpenGraphImage() {
  const locale = await getLocaleEdge();
  const t = landingCopy[locale].meta;
  const rtl = locale === "he";
  const heebo = await readFile(HEEBO_PATH);

  const titleStyle: React.CSSProperties = {
    fontSize: 72,
    fontWeight: 700,
    lineHeight: 1.08,
    color: "#ffffff",
    maxWidth: 1040,
    letterSpacing: rtl ? "0" : "-1.5px",
  };
  const subStyle: React.CSSProperties = {
    marginTop: 8,
    fontSize: 28,
    color: "rgba(255,255,255,0.7)",
    lineHeight: 1.4,
    maxWidth: 1000,
  };

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "72px 80px",
          background:
            "linear-gradient(135deg, #0f0a1e 0%, #1a1040 45%, #0d4f5c 100%)",
          position: "relative",
          fontFamily: "Heebo",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "radial-gradient(ellipse 70% 50% at 85% 15%, rgba(124, 58, 237, 0.45), transparent 50%), radial-gradient(ellipse 50% 40% at 10% 90%, rgba(20, 184, 166, 0.3), transparent 45%)",
          }}
        />
        <div
          style={{
            position: "relative",
            display: "flex",
            flexDirection: "column",
            gap: 24,
            alignItems: rtl ? "flex-end" : "flex-start",
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: rtl ? "row-reverse" : "row",
              alignItems: "center",
              gap: 16,
            }}
          >
            <div
              style={{
                width: 72,
                height: 72,
                borderRadius: 18,
                background: "#7C3AED",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <svg
                width="48"
                height="48"
                viewBox="0 0 120 120"
                xmlns="http://www.w3.org/2000/svg"
              >
                <g
                  fill="none"
                  stroke="#FFFFFF"
                  strokeWidth="10"
                  strokeLinecap="round"
                >
                  <path d="M30 60c0-14 10-24 22-24 8 0 14 5 18 12 4 7 10 12 18 12 12 0 22-10 22-22" />
                  <path d="M90 60c0 14-10 24-22 24-8 0-14-5-18-12-4-7-10-12-18-12-12 0-22 10-22 22" />
                </g>
              </svg>
            </div>
            <span
              style={{
                fontSize: 26,
                fontWeight: 700,
                color: "#5eead4",
                letterSpacing: "0.5px",
              }}
            >
              {t.ogEyebrow}
            </span>
          </div>
          {rtl ? (
            <RtlLine text={t.ogTitle} style={titleStyle} />
          ) : (
            <span style={titleStyle}>{t.ogTitle}</span>
          )}
          {rtl ? (
            <RtlLine text={t.ogSub} style={subStyle} />
          ) : (
            <span style={subStyle}>{t.ogSub}</span>
          )}
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [{ name: "Heebo", data: heebo, weight: 700, style: "normal" }],
    },
  );
}
