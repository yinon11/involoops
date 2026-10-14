/* eslint-disable */
import fs from 'node:fs';
import { extractTextFromPdf } from '../src/lib/extraction/text-extractor';

async function main() {
  const path = process.argv[2];
  if (!path) {
    console.error('usage: tsx scripts/smoke-extract.ts <pdf-path>');
    process.exit(1);
  }
  const buf = fs.readFileSync(path);
  const r = await extractTextFromPdf(buf);
  console.log('pages:', r.pageCount, ' isTextBased:', r.isTextBased);
  console.log('=== flat text ===');
  console.log(r.text);
  console.log('\n=== layoutText (what the LLM now sees) ===');
  console.log(r.layoutText);
}

main();
