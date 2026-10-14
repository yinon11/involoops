"use client";

import React, { useState, useEffect, useCallback } from "react";

import Link from "next/link";
import { useI18n } from "@/lib/i18n/client";

// ── Types ──────────────────────────────────────────────────────────────────
type Settings = {
  fontSize: number;        // 0 = normal, 1 = +1, 2 = +2, 3 = +3
  highContrast: boolean;
  invertColors: boolean;
  grayscale: boolean;
  dyslexiaFont: boolean;
  highlightLinks: boolean;
  bigCursor: boolean;
  stopAnimations: boolean;
  lineHeight: number;      // 0 = normal, 1 = medium, 2 = large
  letterSpacing: number;   // 0 = normal, 1 = medium, 2 = large
};

const DEFAULT_SETTINGS: Settings = {
  fontSize: 0,
  highContrast: false,
  invertColors: false,
  grayscale: false,
  dyslexiaFont: false,
  highlightLinks: false,
  bigCursor: false,
  stopAnimations: false,
  lineHeight: 0,
  letterSpacing: 0,
};

// ── Constants ──────────────────────────────────────────────────────────────
const FONT_SIZES = ["100%", "115%", "130%", "150%"];
const LINE_HEIGHTS = ["normal", "1.8", "2.2"];
const LETTER_SPACINGS = ["normal", "0.1em", "0.2em"];

/**
 * Read saved settings during state initialisation rather than in an effect.
 * Safe despite running on the server (where `sessionStorage` does not exist)
 * and despite the client reading a different value than the server: the
 * first client render returns `null` regardless, so no markup depends on
 * this until after hydration.
 */
function readSavedSettings(): Settings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const saved = window.sessionStorage.getItem("a11y-settings");
    if (!saved) return DEFAULT_SETTINGS;
    // Merged over the defaults so a stored blob written by an older version
    // cannot leave a field undefined.
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(saved) as Partial<Settings>) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

// ── Main Component ─────────────────────────────────────────────────────────
export default function AccessibilityWidget() {
  const { dict, dir } = useI18n();
  const t = dict.a11yWidget;
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState<Settings>(readSavedSettings);

  // Post-hydration flag. The server cannot read sessionStorage, so this
  // widget renders `null` until the client takes over (see the `!mounted`
  // return below) — that is what keeps the server HTML and the client's
  // first render identical. `mounted` therefore HAS to start false on both
  // and flip afterwards, and an effect is the only thing that runs
  // exclusively on the client.
  //
  // react-hooks objects because setState in an effect costs an extra render
  // pass. True, and here that pass renders `null`, so it costs nothing. The
  // rule is flagging a pattern React itself documents, which is what a
  // targeted suppression is for.
  //
  // An earlier version used `useSyncExternalStore(noopSubscribe, () => true,
  // () => false)`, which is correct and needs no suppression, but reads as a
  // puzzle to anyone who has not met the idiom. Not worth it for one render
  // of nothing.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- see above
    setMounted(true);
  }, []);

  // Apply settings to <html>
  useEffect(() => {
    if (!mounted) return;
    const html = document.documentElement;
    const body = document.body;

    // Font size
    html.style.fontSize = FONT_SIZES[settings.fontSize];

    // High contrast
    if (settings.highContrast) {
      body.setAttribute("data-a11y-contrast", "high");
    } else {
      body.removeAttribute("data-a11y-contrast");
    }

    // Filters — apply to page content only so the widget stays visible
    const filters: string[] = [];
    if (settings.invertColors) filters.push("invert(1) hue-rotate(180deg)");
    if (settings.grayscale) filters.push("grayscale(1)");
    const filterValue = filters.join(" ");
    const pageContent = document.getElementById("a11y-page-content");
    if (pageContent) {
      pageContent.style.filter = filterValue;
    }
    body.style.filter = pageContent ? "" : filterValue;

    // Dyslexia font
    if (settings.dyslexiaFont) {
      body.style.fontFamily = "'OpenDyslexic', 'Arial', sans-serif";
    } else {
      body.style.fontFamily = "";
    }

    // Highlight links
    if (settings.highlightLinks) {
      body.setAttribute("data-a11y-links", "highlight");
    } else {
      body.removeAttribute("data-a11y-links");
    }

    // Big cursor
    if (settings.bigCursor) {
      body.style.cursor = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='48' height='48' viewBox='0 0 48 48'%3E%3Cpath d='M6 6l12 36 6-12 12 6z' fill='%23000' stroke='%23fff' stroke-width='2'/%3E%3C/svg%3E\") 6 6, auto";
    } else {
      body.style.cursor = "";
    }

    // Stop animations
    if (settings.stopAnimations) {
      body.setAttribute("data-a11y-motion", "stop");
    } else {
      body.removeAttribute("data-a11y-motion");
    }

    // Line height
    body.style.lineHeight = LINE_HEIGHTS[settings.lineHeight];

    // Letter spacing — inject/update style tag
    let styleEl = document.getElementById("a11y-spacing") as HTMLStyleElement | null;
    if (!styleEl) {
      styleEl = document.createElement("style");
      styleEl.id = "a11y-spacing";
      document.head.appendChild(styleEl);
    }
    styleEl.textContent = settings.letterSpacing > 0
      ? `* { letter-spacing: ${LETTER_SPACINGS[settings.letterSpacing]} !important; }`
      : "";

    // Persist
    try { sessionStorage.setItem("a11y-settings", JSON.stringify(settings)); } catch {}
  }, [settings, mounted]);

  const toggle = useCallback(<K extends keyof Settings>(key: K) => {
    setSettings(prev => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const cycle = useCallback(<K extends keyof Settings>(key: K, max: number) => {
    setSettings(prev => ({ ...prev, [key]: ((prev[key] as number) + 1) % (max + 1) }));
  }, []);

  const reset = useCallback(() => {
    setSettings(DEFAULT_SETTINGS);
    document.documentElement.style.fontSize = "";
    document.body.style.cssText = "";
    document.body.removeAttribute("data-a11y-contrast");
    document.body.removeAttribute("data-a11y-links");
    document.body.removeAttribute("data-a11y-motion");
    const pageContent = document.getElementById("a11y-page-content");
    if (pageContent) pageContent.style.filter = "";
    const styleEl = document.getElementById("a11y-spacing");
    if (styleEl) styleEl.textContent = "";
    try { sessionStorage.removeItem("a11y-settings"); } catch {}
  }, []);

  const activeCount = Object.entries(settings).filter(([k, v]) =>
    k === "fontSize" || k === "lineHeight" || k === "letterSpacing"
      ? (v as number) > 0
      : v === true
  ).length;

  if (!mounted) return null;

  return (
    <>
      {/* Global CSS for accessibility states */}
      <style>{`
        [data-a11y-contrast="high"] {
          background: #000 !important;
          color: #fff !important;
        }
        [data-a11y-contrast="high"] * {
          background-color: #000 !important;
          color: #fff !important;
          border-color: #fff !important;
        }
        [data-a11y-contrast="high"] a { color: #ff0 !important; }
        [data-a11y-contrast="high"] button,
        [data-a11y-contrast="high"] input,
        [data-a11y-contrast="high"] select {
          background: #111 !important;
          color: #fff !important;
          border: 2px solid #fff !important;
        }

        /* Exclude accessibility widget from high contrast so it stays visible to toggle settings back */
        [data-a11y-contrast="high"] [data-a11y-widget] > button {
          background: hsl(var(--primary)) !important;
          color: white !important;
          border: none !important;
        }
        [data-a11y-contrast="high"] [data-a11y-widget] [role="dialog"] {
          background: white !important;
          color: #1a1a1a !important;
          border: 1px solid #E4E7ED !important;
        }
        [data-a11y-contrast="high"] [data-a11y-widget] [role="dialog"] * {
          background-color: transparent !important;
          color: inherit !important;
          border-color: #E4E7ED !important;
        }
        [data-a11y-contrast="high"] [data-a11y-widget] [role="dialog"] > div:first-of-type {
          background: hsl(var(--primary)) !important;
          color: white !important;
        }
        [data-a11y-contrast="high"] [data-a11y-widget] [role="dialog"] > div:first-of-type * {
          color: white !important;
          background-color: transparent !important;
          border-color: transparent !important;
        }
        [data-a11y-contrast="high"] [data-a11y-widget] [role="dialog"] .a11y-btn[aria-checked="true"] {
          background: #EEF1F8 !important;
          color: hsl(var(--primary)) !important;
          border-color: hsl(var(--primary)) !important;
        }
        [data-a11y-contrast="high"] [data-a11y-widget] [role="dialog"] .a11y-btn[aria-checked="false"] {
          background: white !important;
          color: #3D4556 !important;
          border-color: #E4E7ED !important;
        }
        [data-a11y-contrast="high"] [data-a11y-widget] [role="dialog"] > div:last-of-type {
          background: #F7F7F6 !important;
        }
        [data-a11y-contrast="high"] [data-a11y-widget] [role="dialog"] > div:last-of-type * {
          background-color: transparent !important;
          color: hsl(var(--primary)) !important;
        }

        [data-a11y-links="highlight"] a {
          text-decoration: underline !important;
          text-decoration-thickness: 2px !important;
          text-underline-offset: 3px !important;
          outline: 2px solid currentColor !important;
          outline-offset: 2px !important;
          border-radius: 2px !important;
        }

        [data-a11y-motion="stop"] *,
        [data-a11y-motion="stop"] *::before,
        [data-a11y-motion="stop"] *::after {
          animation-duration: 0.001ms !important;
          animation-iteration-count: 1 !important;
          transition-duration: 0.001ms !important;
          scroll-behavior: auto !important;
        }

        /* Slide-in animation for panel */
        @keyframes a11y-slide-in {
          from { opacity: 0; transform: translateY(12px) scale(0.97); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes a11y-fade-in {
          from { opacity: 0; }
          to   { opacity: 1; }
        }

        /* Focus visible ring */
        .a11y-btn:focus-visible {
          outline: 3px solid hsl(var(--primary)) !important;
          outline-offset: 2px !important;
        }
      `}</style>

      {/* Wrapper excludes widget from high contrast so it stays visible to toggle settings */}
      <div data-a11y-widget style={{ display: "contents" }}>
      {/* Trigger button */}
      <button
        className="a11y-btn"
        onClick={() => setOpen(o => !o)}
        aria-label={t.openMenu}
        aria-expanded={open}
        aria-haspopup="dialog"
        style={{
          position: "fixed",
          bottom: "28px",
          left: dir === "rtl" ? "24px" : undefined,
          right: dir === "rtl" ? undefined : "24px",
          zIndex: 9998,
          width: "52px",
          height: "52px",
          borderRadius: "50%",
          border: "none",
          background: "hsl(var(--primary))",
          color: "white",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: "0 4px 20px rgba(27,45,91,0.35)",
          transition: "transform 0.2s ease, box-shadow 0.2s ease",
        }}
        onMouseEnter={e => {
          (e.currentTarget as HTMLButtonElement).style.transform = "scale(1.08)";
          (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 6px 28px rgba(27,45,91,0.45)";
        }}
        onMouseLeave={e => {
          (e.currentTarget as HTMLButtonElement).style.transform = "scale(1)";
          (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 4px 20px rgba(27,45,91,0.35)";
        }}
      >
        {/* Badge */}
        {activeCount > 0 && (
          <span style={{
            position: "absolute", top: "-4px", right: "-4px",
            width: "18px", height: "18px", borderRadius: "50%",
            background: "#E53E3E", color: "white",
            fontSize: "0.65rem", fontWeight: 700,
            display: "flex", alignItems: "center", justifyContent: "center",
            border: "2px solid white",
          }}>
            {activeCount}
          </span>
        )}
        {/* Accessibility icon */}
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="4.5" r="1.8" fill="white" />
          <path d="M5 8.5h14M12 8.5v11M8 14.5l-3 5M16 14.5l3 5" stroke="white" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      </button>

      {/* Panel */}
      {open && (
        <div
          role="dialog"
          aria-label={t.panelLabel}
          aria-modal="true"
          style={{
            position: "fixed",
            bottom: "88px",
            left: dir === "rtl" ? "24px" : undefined,
            right: dir === "rtl" ? undefined : "24px",
            zIndex: 9999,
            width: "300px",
            background: "white",
            borderRadius: "20px",
            boxShadow: "0 20px 60px rgba(8,12,20,0.18), 0 4px 16px rgba(8,12,20,0.1)",
            border: "1px solid #E4E7ED",
            overflow: "hidden",
            animation: "a11y-slide-in 0.25s ease",
            direction: "ltr",
            fontFamily: "ui-sans-serif, system-ui, sans-serif",
          }}
        >
          {/* Header */}
          <div style={{
            background: "hsl(var(--primary))",
            padding: "16px 20px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle cx="12" cy="4.5" r="1.8" fill="white" />
                <path d="M5 8.5h14M12 8.5v11M8 14.5l-3 5M16 14.5l3 5" stroke="white" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
              <span style={{ color: "white", fontWeight: 600, fontSize: "0.95rem" }}>{t.heading}</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              {activeCount > 0 && (
                <button
                  className="a11y-btn"
                  onClick={reset}
                  aria-label={t.resetLabel}
                  style={{
                    background: "rgba(255,255,255,0.15)",
                    border: "1px solid rgba(255,255,255,0.25)",
                    borderRadius: "100px",
                    color: "white",
                    fontSize: "0.72rem",
                    fontWeight: 500,
                    padding: "4px 10px",
                    cursor: "pointer",
                    letterSpacing: "0.03em",
                  }}
                >
                  {t.reset}
                </button>
              )}
              <button
                className="a11y-btn"
                onClick={() => setOpen(false)}
                aria-label={t.closeMenu}
                style={{
                  background: "rgba(255,255,255,0.12)",
                  border: "1px solid rgba(255,255,255,0.2)",
                  borderRadius: "50%",
                  width: "28px", height: "28px",
                  color: "white",
                  cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}
              >
                <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          {/* Scrollable content */}
          <div style={{ padding: "16px", maxHeight: "calc(100vh - 280px)", overflowY: "auto" }}>

            {/* Display */}
            <SectionLabel>{t.sections.display}</SectionLabel>

            {/* Font size */}
            <div style={{ marginBottom: "10px" }}>
              <div style={rowStyle}>
                <span style={labelStyle}>{t.textSize}</span>
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <StepBtn
                    label={t.decreaseTextSize}
                    onClick={() => setSettings(p => ({ ...p, fontSize: Math.max(0, p.fontSize - 1) }))}
                    disabled={settings.fontSize === 0}
                  >
                    <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M5 12h14" /></svg>
                  </StepBtn>
                  <span style={{ fontSize: "0.78rem", fontWeight: 600, color: "hsl(var(--primary))", minWidth: "28px", textAlign: "center" }}>
                    {[t.steps.normal, "+1", "+2", "+3"][settings.fontSize]}
                  </span>
                  <StepBtn
                    label={t.increaseTextSize}
                    onClick={() => setSettings(p => ({ ...p, fontSize: Math.min(3, p.fontSize + 1) }))}
                    disabled={settings.fontSize === 3}
                  >
                    <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>
                  </StepBtn>
                </div>
              </div>
            </div>

            {/* Line height */}
            <ToggleRow
              label={t.lineHeight}
              icon={<svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M3 6h18M3 12h18M3 18h18" /></svg>}
              active={settings.lineHeight > 0}
              onClick={() => cycle("lineHeight", 2)}
              badge={settings.lineHeight > 0 ? ["", t.steps.medium, t.steps.large][settings.lineHeight] : undefined}
            />

            {/* Letter spacing */}
            <ToggleRow
              label={t.letterSpacing}
              icon={<svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M4 12h16M4 6l4 6-4 6M20 6l-4 6 4 6" /></svg>}
              active={settings.letterSpacing > 0}
              onClick={() => cycle("letterSpacing", 2)}
              badge={settings.letterSpacing > 0 ? ["", t.steps.medium, t.steps.large][settings.letterSpacing] : undefined}
            />

            {/* Contrast */}
            <SectionLabel>{t.sections.contrast}</SectionLabel>

            <ToggleRow
              label={t.highContrast}
              icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5"/><path d="M12 2a10 10 0 010 20V2z" fill="currentColor"/></svg>}
              active={settings.highContrast}
              onClick={() => toggle("highContrast")}
            />

            <ToggleRow
              label={t.invertColors}
              icon={<svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M12 3v18M3 12h18" /><path d="M12 3C7 3 3 7 3 12s4 9 9 9"/></svg>}
              active={settings.invertColors}
              onClick={() => toggle("invertColors")}
            />

            <ToggleRow
              label={t.grayscale}
              icon={<svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 3v18M3 9h18M3 15h18"/></svg>}
              active={settings.grayscale}
              onClick={() => toggle("grayscale")}
            />

            {/* Reading & motion */}
            <SectionLabel>{t.sections.reading}</SectionLabel>

            <ToggleRow
              label={t.dyslexiaFont}
              icon={<svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M4 7V4h16v3M9 20h6M12 4v16"/></svg>}
              active={settings.dyslexiaFont}
              onClick={() => toggle("dyslexiaFont")}
            />

            <ToggleRow
              label={t.highlightLinks}
              icon={<svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>}
              active={settings.highlightLinks}
              onClick={() => toggle("highlightLinks")}
            />

            <ToggleRow
              label={t.stopAnimations}
              icon={<svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>}
              active={settings.stopAnimations}
              onClick={() => toggle("stopAnimations")}
            />

            <ToggleRow
              label={t.bigCursor}
              icon={<svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M4 4l7 19 3-7 7-3z"/></svg>}
              active={settings.bigCursor}
              onClick={() => toggle("bigCursor")}
            />

          </div>

          {/* Footer */}
          <div style={{
            padding: "12px 16px",
            borderTop: "1px solid #E4E7ED",
            background: "#F7F7F6",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}>
            <Link
              href="/accessibility"
              style={{
                fontSize: "0.75rem",
                color: "hsl(var(--primary))",
                fontWeight: 500,
                textDecoration: "underline",
                textUnderlineOffset: "2px",
              }}
            >
              {t.statementLink}
            </Link>
            <span style={{ fontSize: "0.68rem", color: "#8490A8" }}>
              {t.footnote}
            </span>
          </div>
        </div>
      )}
      </div>
    </>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p style={{
      fontSize: "0.68rem",
      fontWeight: 600,
      letterSpacing: "0.1em",
      textTransform: "uppercase",
      color: "#8490A8",
      margin: "14px 0 8px",
    }}>
      {children}
    </p>
  );
}

function ToggleRow({
  label, icon, active, onClick, badge,
}: {
  label: string;
  icon: React.ReactNode;
  active: boolean;
  onClick: () => void;
  badge?: string;
}) {
  return (
    <button
      className="a11y-btn"
      role="switch"
      aria-checked={active}
      aria-label={label}
      onClick={onClick}
      style={{
        width: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "9px 12px",
        marginBottom: "6px",
        borderRadius: "10px",
        border: `1px solid ${active ? "hsl(var(--primary))" : "#E4E7ED"}`,
        background: active ? "#EEF1F8" : "white",
        cursor: "pointer",
        transition: "all 0.15s ease",
        textAlign: "left",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
        <span style={{ color: active ? "hsl(var(--primary))" : "#8490A8", display: "flex" }}>
          {icon}
        </span>
        <span style={{ fontSize: "0.83rem", fontWeight: active ? 500 : 400, color: active ? "hsl(var(--primary))" : "#3D4556" }}>
          {label}
        </span>
        {badge && (
          <span style={{
            fontSize: "0.68rem", fontWeight: 600,
            background: "hsl(var(--primary))", color: "white",
            padding: "1px 7px", borderRadius: "100px",
          }}>
            {badge}
          </span>
        )}
      </div>
      {/* Toggle pill */}
      <div style={{
        width: "34px", height: "20px",
        borderRadius: "100px",
        background: active ? "hsl(var(--primary))" : "#CDD2DC",
        position: "relative",
        transition: "background 0.2s ease",
        flexShrink: 0,
      }}>
        <div style={{
          position: "absolute",
          top: "3px",
          right: active ? "3px" : "15px",
          width: "14px", height: "14px",
          borderRadius: "50%",
          background: "white",
          transition: "right 0.2s ease",
          boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
        }} />
      </div>
    </button>
  );
}

function StepBtn({
  children, onClick, disabled, label,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      className="a11y-btn"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      style={{
        width: "28px", height: "28px",
        borderRadius: "8px",
        border: "1px solid #E4E7ED",
        background: disabled ? "#F7F7F6" : "white",
        color: disabled ? "#CDD2DC" : "hsl(var(--primary))",
        cursor: disabled ? "not-allowed" : "pointer",
        display: "flex", alignItems: "center", justifyContent: "center",
        transition: "all 0.15s",
      }}
    >
      {children}
    </button>
  );
}

const rowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "9px 12px",
  marginBottom: "6px",
  borderRadius: "10px",
  border: "1px solid #E4E7ED",
  background: "white",
};

const labelStyle: React.CSSProperties = {
  fontSize: "0.83rem",
  fontWeight: 400,
  color: "#3D4556",
  display: "flex",
  alignItems: "center",
  gap: "10px",
};