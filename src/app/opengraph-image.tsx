import { ImageResponse } from "next/og";

export const runtime = "edge";

export const alt = "InvoLoops — Free invoicing and business insights";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          justifyContent: "center",
          padding: "72px 80px",
          background:
            "linear-gradient(135deg, #0f0a1e 0%, #1a1040 40%, #2d1b69 100%)",
          position: "relative",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "radial-gradient(ellipse 70% 50% at 80% 20%, rgba(124, 58, 237, 0.4), transparent 50%), radial-gradient(ellipse 50% 40% at 10% 90%, rgba(124, 58, 237, 0.15), transparent 45%)",
          }}
        />
        <div
          style={{
            position: "relative",
            display: "flex",
            flexDirection: "column",
            gap: 20,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 16,
            }}
          >
            <div
              style={{
                width: 88,
                height: 88,
                borderRadius: 22,
                background: "#7C3AED",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <svg
                width="64"
                height="64"
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
                fontSize: 64,
                fontWeight: 600,
                color: "#ffffff",
                letterSpacing: "-2.2px",
              }}
            >
              involoops
            </span>
          </div>
          <span
            style={{
              fontSize: 72,
              fontWeight: 700,
              lineHeight: 1.1,
              color: "#ffffff",
              maxWidth: 900,
            }}
          >
            Free invoicing. Full business insights.
          </span>
          <span
            style={{
              fontSize: 32,
              fontWeight: 600,
              color: "#a78bfa",
              lineHeight: 1.3,
            }}
          >
            ITA allocation numbers · Spend per vendor · Open source
          </span>
          <span
            style={{
              marginTop: 8,
              fontSize: 22,
              color: "rgba(255,255,255,0.55)",
              lineHeight: 1.5,
              maxWidth: 700,
            }}
          >
            Issue invoices for free, and see where every shekel goes
          </span>
        </div>
      </div>
    ),
    { ...size },
  );
}
