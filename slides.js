// Builds the 13-slide anniversary deck as a simple list of shapes and
// text boxes. The SAME model drives both the on-screen preview and the
// PowerPoint file, so what you preview is what you download.
// Units are inches on a 13.333 x 7.5 (16:9) slide; font sizes are points.

export const SLIDE_W = 13.333;
export const SLIDE_H = 7.5;

const C = {
  cream: 'F7F1E5', paper: 'FFFDF8', navy: '1F2A44', gold: 'B08A4F',
  goldSoft: 'E6D7B8', goldLight: 'D9C08F', ruby: '9B1B30', white: 'FFFFFF',
};
// Fonts available in Google Slides, PowerPoint for the web, and Google Fonts.
export const FONTS = { serif: 'Lora', sans: 'Montserrat' };

// Rough average character widths (as a fraction of the font size) for the
// two fonts. Slightly generous so text is never cut off.
const CHAR_EM = { serif: 0.53, sans: 0.55 };

function normalize(text) {
  return String(text ?? '').replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function estimateLines(text, fontPt, widthIn, font = 'sans') {
  const maxChars = Math.max(1, Math.floor((widthIn * 72) / (fontPt * CHAR_EM[font])));
  let lines = 0;
  for (const para of text.split('\n')) {
    const words = para.trim().split(/\s+/).filter(Boolean);
    if (!words.length) { lines += 1; continue; }
    let cur = 0;
    let n = 1;
    for (const w of words) {
      let len = w.length;
      if (cur === 0) cur = len;
      else if (cur + 1 + len <= maxChars) cur += 1 + len;
      else { n += 1; cur = len; }
      while (cur > maxChars) { n += 1; cur -= maxChars; }
    }
    lines += n;
  }
  return lines;
}

// Largest font size (max..min) at which the text fits in the box.
export function fitFont(text, widthIn, heightIn, { max, min, font = 'sans', lineSpacing = 1.15 }) {
  const lineH = 1.2 * lineSpacing; // line box height relative to font size
  for (let s = max; s >= min; s -= 1) {
    if (estimateLines(text, s, widthIn, font) * s * lineH <= heightIn * 72) return { size: s, fits: true };
  }
  return { size: min, fits: false };
}

// ------------------------------------------------------------------
function frame(color) {
  return { type: 'rect', x: 0.28, y: 0.28, w: SLIDE_W - 0.56, h: SLIDE_H - 0.56, line: color, lineW: 1 };
}
function divider(cx, y, half, lineColor, gemColor) {
  return [
    { type: 'line', x: cx - half, y, w: half - 0.16, color: lineColor, lineW: 1 },
    { type: 'line', x: cx + 0.16, y, w: half - 0.16, color: lineColor, lineW: 1 },
    { type: 'diamond', x: cx - 0.07, y: y - 0.07, w: 0.14, h: 0.14, fill: gemColor },
  ];
}
const T = (o) => ({ type: 'text', align: 'center', valign: 'middle', font: 'sans', color: C.navy, ...o });

function titleSlide({ coupleNames, date }) {
  const els = [
    frame(C.gold),
    { type: 'rect', x: 0.4, y: 0.4, w: SLIDE_W - 0.8, h: SLIDE_H - 0.8, line: C.gold, lineW: 0.5 },
    T({ x: 1, y: 1.35, w: SLIDE_W - 2, h: 0.4, text: '40TH ANNIVERSARY', size: 16, bold: true, color: C.goldLight, charSpacing: 6 }),
    T({ x: 1, y: 1.95, w: SLIDE_W - 2, h: 2.1, text: '40 Years of Love,\nLaughter & Memories', font: 'serif', size: 54, color: C.cream, lineSpacing: 1.05 }),
    ...divider(SLIDE_W / 2, 4.45, 1.6, C.gold, 'C2334B'),
    T({ x: 1, y: 4.75, w: SLIDE_W - 2, h: 0.7, text: 'The Newlywed Game', font: 'serif', italic: true, size: 32, color: C.goldLight }),
  ];
  const sub = [coupleNames, date].filter(Boolean).join('  •  ');
  els.push(T({ x: 1, y: 5.55, w: SLIDE_W - 2, h: 0.5, text: sub || 'A few questions about four decades of love, laughter, and family.', size: 18, color: C.cream }));
  return { kind: 'title', bg: C.navy, els };
}

function closingSlide() {
  return {
    kind: 'closing', bg: C.navy,
    els: [
      frame(C.gold),
      { type: 'rect', x: 0.4, y: 0.4, w: SLIDE_W - 0.8, h: SLIDE_H - 0.8, line: C.gold, lineW: 0.5 },
      T({ x: 1, y: 2.0, w: SLIDE_W - 2, h: 2.3, text: 'Here’s to 40 Years…\nand Many More!', font: 'serif', size: 58, color: C.cream, lineSpacing: 1.05 }),
      ...divider(SLIDE_W / 2, 4.75, 1.6, C.gold, 'C2334B'),
      T({ x: 1, y: 5.1, w: SLIDE_W - 2, h: 0.45, text: '40 YEARS • ONE BEAUTIFUL STORY', size: 16, bold: true, color: C.goldLight, charSpacing: 5 }),
    ],
  };
}

function questionSlide(q, n, total, momText, dadText) {
  const prompt = normalize(q.prompt);
  const qFit = fitFont(prompt, 11.6, 1.2, { max: 32, min: 22, font: 'serif', lineSpacing: 1.05 });

  const cardY = 2.5;
  const cardH = 4.2;
  const cardW = 5.85;
  const gap = 0.3;
  const leftX = (SLIDE_W - (cardW * 2 + gap)) / 2;
  const padX = 0.4;
  const textW = cardW - padX * 2;
  const textY = cardY + 0.85;
  const textH = cardH - 0.85 - 0.3;

  const card = (x, label, raw) => {
    const text = normalize(raw);
    const empty = !text;
    const shown = empty ? 'No answer yet' : text;
    const fit = fitFont(shown, textW, textH, { max: 28, min: 12, font: 'sans', lineSpacing: 1.15 });
    return {
      fit,
      els: [
        { type: 'rect', x, y: cardY, w: cardW, h: cardH, fill: C.paper, line: C.goldSoft, lineW: 1 },
        { type: 'rect', x, y: cardY, w: cardW, h: 0.07, fill: C.ruby },
        T({ x: x + padX, y: cardY + 0.25, w: textW, h: 0.45, text: label, size: 18, bold: true, color: C.ruby, charSpacing: 6, align: 'left' }),
        T({ x: x + padX, y: textY, w: textW, h: textH, text: shown, size: fit.size, color: empty ? '8A8F9C' : C.navy, italic: empty, align: 'left', valign: 'top', lineSpacing: 1.15 }),
      ],
    };
  };
  const mom = card(leftX, 'MOM', momText);
  const dad = card(leftX + cardW + gap, 'DAD', dadText);

  return {
    kind: 'question', bg: C.cream, questionId: q.id,
    fits: { mom: mom.fit, dad: dad.fit, question: qFit },
    els: [
      frame(C.goldSoft),
      T({ x: 1, y: 0.5, w: SLIDE_W - 2, h: 0.35, text: `QUESTION ${n} OF ${total}`, size: 12, bold: true, color: C.gold, charSpacing: 5 }),
      T({ x: (SLIDE_W - 11.6) / 2, y: 0.85, w: 11.6, h: 1.2, text: prompt, font: 'serif', size: qFit.size, color: C.navy, lineSpacing: 1.05 }),
      ...divider(SLIDE_W / 2, 2.25, 1.1, C.gold, C.ruby),
      ...mom.els,
      ...dad.els,
      T({ x: 1, y: 6.83, w: SLIDE_W - 2, h: 0.3, text: '40 YEARS • ONE BEAUTIFUL STORY', size: 10, bold: true, color: C.gold, charSpacing: 4 }),
    ],
  };
}

// questions: [{id, prompt}], answers: {mom: {id: text}, dad: {id: text}}
export function buildDeck(questions, answers, opts = {}) {
  const qs = [...questions].sort((a, b) => a.id - b.id);
  return [
    titleSlide(opts),
    ...qs.map((q, i) => questionSlide(q, i + 1, qs.length, answers.mom?.[q.id], answers.dad?.[q.id])),
    closingSlide(),
  ];
}

// ------------------------------------------------------------------
// PowerPoint output (PptxGenJS). Works in the browser and in Node.
export function toPptx(deck, PptxGenJS) {
  const pres = new PptxGenJS();
  pres.layout = 'LAYOUT_WIDE'; // 13.333 x 7.5 in
  pres.title = 'The Newlywed Game: 40 Years of Love';
  pres.subject = '40th anniversary slideshow';
  const S = pres.ShapeType || pres.shapes;

  for (const s of deck) {
    const slide = pres.addSlide();
    slide.background = { color: s.bg };
    for (const e of s.els) {
      if (e.type === 'rect') {
        slide.addShape(S.rect, {
          x: e.x, y: e.y, w: e.w, h: e.h,
          fill: e.fill ? { color: e.fill } : { type: 'none' },
          line: e.line ? { color: e.line, width: e.lineW || 1 } : { type: 'none' },
        });
      } else if (e.type === 'line') {
        slide.addShape(S.line, { x: e.x, y: e.y, w: e.w, h: 0, line: { color: e.color, width: e.lineW || 1 } });
      } else if (e.type === 'diamond') {
        slide.addShape(S.diamond, { x: e.x, y: e.y, w: e.w, h: e.h, fill: { color: e.fill }, line: { type: 'none' } });
      } else if (e.type === 'text') {
        slide.addText(e.text, {
          x: e.x, y: e.y, w: e.w, h: e.h,
          fontFace: FONTS[e.font], fontSize: e.size, color: e.color,
          bold: !!e.bold, italic: !!e.italic,
          align: e.align, valign: e.valign,
          charSpacing: e.charSpacing || 0,
          lineSpacingMultiple: e.lineSpacing || 1,
          margin: 0, wrap: true, fit: 'none',
        });
      }
    }
  }
  return pres;
}

// ------------------------------------------------------------------
// HTML preview. Font sizes use container-width units so the preview
// scales like the real slide (960pt = slide width).
const pct = (v, total) => `${(v / total) * 100}%`;
const ptToCqw = (pt) => `${(pt / (SLIDE_W * 72)) * 100}cqw`;
const escHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function slideHtml(s) {
  const parts = s.els.map((e) => {
    const box = `left:${pct(e.x, SLIDE_W)};top:${pct(e.y, SLIDE_H)};width:${pct(e.w, SLIDE_W)};`;
    if (e.type === 'rect') {
      return `<div class="el" style="${box}height:${pct(e.h, SLIDE_H)};background:${e.fill ? '#' + e.fill : 'transparent'};${e.line ? `border:${Math.max(1, e.lineW || 1)}px solid #${e.line};` : ''}"></div>`;
    }
    if (e.type === 'line') {
      return `<div class="el" style="${box}height:0;border-top:1px solid #${e.color};"></div>`;
    }
    if (e.type === 'diamond') {
      return `<div class="el" style="${box}height:${pct(e.h, SLIDE_H)};background:#${e.fill};clip-path:polygon(50% 0,100% 50%,50% 100%,0 50%);"></div>`;
    }
    const justify = { top: 'flex-start', middle: 'center', bottom: 'flex-end' }[e.valign || 'middle'];
    return `<div class="el txt" style="${box}height:${pct(e.h, SLIDE_H)};justify-content:${justify};text-align:${e.align || 'left'};` +
      `font-family:${e.font === 'serif' ? 'var(--serif)' : 'var(--sans)'};font-size:${ptToCqw(e.size)};color:#${e.color};` +
      `font-weight:${e.bold ? 700 : 400};font-style:${e.italic ? 'italic' : 'normal'};` +
      `letter-spacing:${ptToCqw(e.charSpacing || 0)};line-height:${1.2 * (e.lineSpacing || 1)};">${escHtml(e.text)}</div>`;
  });
  return `<div class="slide" style="background:#${s.bg}">${parts.join('')}</div>`;
}
