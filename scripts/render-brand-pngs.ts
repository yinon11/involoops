/**
 * Render brand SVG lockups into PNGs for use in emails (Gmail / Outlook /
 * iOS Mail don't render <img src=*.svg> reliably, so emails ship the PNG).
 *
 * Run: `npx tsx scripts/render-brand-pngs.ts`
 *
 * The SVG wordmark is set in Inter SemiBold (with negative letter-spacing
 * tuned for that font). If fontconfig falls back to a different family the
 * letters collapse into garbage. We use sharp/libvips here because:
 *   - it's already a transitive dep (Next.js image optimization),
 *   - it parses SVG `font-family` quoting correctly (ImageMagick's MSVG
 *     fallback does not), and
 *   - it picks up Inter from the user fontconfig path.
 *
 * If the rendered PNG looks wrong, install Inter:
 *   ~/.local/share/fonts/inter/InterVariable.ttf  (+ Inter-SemiBold.ttf,
 *   Inter-Bold.ttf), then `fc-cache -f`.
 */

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const BRAND_DIR = path.join(process.cwd(), "public", "brand");

const TARGETS = [
  { svg: "involoops-lockup-horizontal.svg", png: "involoops-lockup-horizontal.png" },
  { svg: "involoops-lockup-horizontal-white.svg", png: "involoops-lockup-horizontal-white.png" },
] as const;

async function main() {
  for (const { svg, png } of TARGETS) {
    const src = await readFile(path.join(BRAND_DIR, svg));
    const out = await sharp(src, { density: 300 })
      .resize(800, 200, { fit: "inside", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
    await writeFile(path.join(BRAND_DIR, png), out);
    console.log(`  ✓ ${png}  (${out.byteLength} bytes)`);
  }
}

main().catch((err) => {
  console.error("Render failed:", err);
  process.exit(1);
});
