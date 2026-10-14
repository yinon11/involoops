# Involoops — Brand Assets

From the Claude Design handoff bundle. Source project: `Involoops Studio Lockup.html`.

## Product family colors

| Product | Purpose | Primary | Dark | Soft |
|---|---|---|---|---|
| **Insights** | Expenses / AI extraction | `#7C3AED` (violet) | — | — |
| **Studio** | Invoice generator / issuing | `#0D9488` (teal) | `#0F766E` | `#CCFBF1` |

Neutrals — **Ink** `#0B1220`, **Paper** `#FAFAF7`.

## SVG assets

### Base marks (Möbius loop, no arrow — used for Insights & generic brand)
- `involoops-mark-violet.svg` — primary mark, Insights violet
- `involoops-mark-teal.svg` — primary mark, Studio teal
- `involoops-mark-black.svg` — monochrome black (ink)
- `involoops-mark-white.svg` — reverse, for dark backgrounds

### Studio marks (Möbius + outgoing arrowhead — option A, locked)
- `involoops-studio-mark.svg` — Studio mark in teal
- `involoops-studio-favicon.svg` — 32×32 favicon (heavier stroke for small sizes)
- `involoops-studio-appicon-512.svg` — 512×512 rounded-square app icon, white mark on teal

### Lockups (mark + "involoops" wordmark)
- `involoops-lockup-horizontal.svg` — violet mark + ink wordmark, light bg
- `involoops-lockup-horizontal-reverse.svg` — for dark navy bg
- `involoops-lockup-horizontal-white.svg` — white mark + white wordmark (on transparent)
- `involoops-studio-lockup-horizontal.svg` — teal Studio mark + ink wordmark + "STUDIO" sub-label

### Lockup PNG rasters (for email / clients that don't render SVG)
- `involoops-lockup-horizontal.png` — PNG of the light lockup, used in email
  templates (Gmail/Outlook/iOS don't render SVG).
- `involoops-lockup-horizontal-white.png` — PNG of the white lockup.

  Regenerate these two with `npx tsx scripts/render-brand-pngs.ts` after
  editing the corresponding SVGs.

### Full-bleed icons
- `involoops-appicon-512.svg` — Insights (violet) rounded-square
- `involoops-favicon.svg` — 32×32 browser tab favicon (Insights)

## PNG rasters (`png/`)

Pre-rendered PNGs from the design bundle, in multiple sizes:

- `favicon-16.png`, `favicon-32.png`, `favicon-48.png` — browser tab
- `appicon-180.png` — iOS touch icon
- `appicon-192.png` — Android / PWA
- `appicon-512.png`, `appicon-1024.png`, `appicon-ink-512.png` — stores / hi-dpi
- `mark-violet-32.png` → `mark-violet-1024.png` — Insights mark at common sizes
- `mark-black-256.png`, `mark-black-512.png` — monochrome black
- `mark-white-256.png`, `mark-white-512.png` — reverse / on dark

## Typography

- **Wordmark**: Geist (Google Fonts), weight 600, letter-spacing `-0.035em`.
- **Sub-brand** (e.g. "Studio", "Insights"): Geist Mono, weight 600, letter-spacing `0.22em`, uppercase.
- Fallback: Inter for the wordmark, JetBrains Mono for the sub-brand.

## Clear space

Keep a minimum margin equal to the stroke-width (one loop's thickness) around the mark in every direction.

## Minimum size

- Mark alone: 14px
- Horizontal lockup: 100px wide

## In-code usage

The Studio mark is also available as a React component at
`src/components/brand/involoops-studio-mark.tsx` — prefer that inside the app
so it inherits `currentColor` and can be tinted dynamically. Use these static
files for metadata (favicons, social cards, og images, emails, PDFs).
