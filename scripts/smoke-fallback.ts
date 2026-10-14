/* eslint-disable */
import fs from 'node:fs';
import { extractTextFromPdf } from '../src/lib/extraction/text-extractor';
import { extractVendorNameFallbackLine } from '../src/lib/extraction/field-parser';
import { normalizeHebrewText } from '../src/lib/extraction/hebrew-parser';

async function main() {
  const path = process.argv[2];
  const ownNamesArg = process.argv[3] ?? '';
  if (!path) {
    console.error('usage: tsx scripts/smoke-fallback.ts <pdf-path> [own,names,comma,separated]');
    process.exit(1);
  }
  const ownNames = ownNamesArg
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const buf = fs.readFileSync(path);
  const r = await extractTextFromPdf(buf);

  // Call site in pipeline.ts passes raw layoutText now (no normalization)
  // so wide-whitespace column gaps survive into the splitter.
  const flatPick = extractVendorNameFallbackLine(r.text, ownNames);
  const layoutPick = extractVendorNameFallbackLine(r.layoutText, ownNames);

  console.log('own_business_names:', ownNames);
  console.log('\nfallback on FLAT text  ->', JSON.stringify(flatPick));
  console.log('fallback on LAYOUT text ->', JSON.stringify(layoutPick));
}

main();
