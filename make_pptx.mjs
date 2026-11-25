// TEST ONLY. Builds the deck from sample answers in Node and checks it.
// Usage: node tests/make_pptx.mjs out.pptx
import { createRequire } from 'node:module';
import { buildDeck, toPptx } from '../js/slides.js';
import { MOM, DAD } from './sample_data.mjs';

const require = createRequire(import.meta.url);
const PptxGenJS = require(process.env.PPTXGENJS || 'pptxgenjs');

const QUESTIONS = [
  'What is your favorite memory from your wedding day?',
  'What is the secret to a happy 40-year marriage?',
  'If you could relive one vacation or trip together, which would it be?',
  'What is one thing your spouse would say you haven’t changed about yourself since you first met?',
  'What is the one quality your spouse has that you admire most?',
  'What is your favorite family tradition?',
  'What is your favorite thing about each of your grandchildren?',
  'What is your spouse’s favorite movie?',
  'If you had to describe your spouse in three words, what would they be?',
  'If your spouse were arrested, what would the most likely reason be?',
  'What is your spouse’s catchphrase or the phrase they repeat so often that you could impersonate them?',
].map((prompt, i) => ({ id: i + 1, prompt }));

const deck = buildDeck(QUESTIONS, { mom: MOM, dad: DAD }, { coupleNames: 'Linda & Mike', date: 'December 2026' });
if (deck.length !== 13) throw new Error(`expected 13 slides, got ${deck.length}`);
for (const s of deck.filter((d) => d.kind === 'question')) {
  const f = s.fits;
  console.log(`Q${s.questionId}: question ${f.question.size}pt, mom ${f.mom.size}pt${f.mom.fits ? '' : ' (OVERFLOW)'}, dad ${f.dad.size}pt${f.dad.fits ? '' : ' (OVERFLOW)'}`);
}
const out = process.argv[2] || 'sample.pptx';
await toPptx(deck, PptxGenJS).writeFile({ fileName: out });
console.log('wrote', out);
