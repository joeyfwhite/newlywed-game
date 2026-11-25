// Parent survey. The private link looks like  https://site/#k=<token>
// The token is sent to the database, which decides who the parent is.
// Nothing in this file can reach the other parent's answers.
import { survey, isConfigured } from './api.js';
import { ORGANIZER_NAME } from './config.js';

const card = document.getElementById('card');
const rings = () => document.getElementById('rings-tpl').innerHTML;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const contact = () => (ORGANIZER_NAME ? ` Questions? Text ${esc(ORGANIZER_NAME)}.` : '');

const INTRO_TEXT = 'Mom and Dad, we’re celebrating 40 years of marriage! Before the big celebration, we’d love for each of you to answer a few questions about your life together. Answer independently, and we’ll reveal your answers at the anniversary party!';
const THANK_YOU = 'Thank you! Your answers have been submitted. We can’t wait to celebrate 40 years of love with you!';

const state = {
  token: readToken(),
  label: '',
  questions: [],
  answers: {},      // question id (string) -> text
  submittedAt: null,
  locked: false,
  index: 0,
};

function readToken() {
  const fromHash = new URLSearchParams(location.hash.replace(/^#/, '')).get('k');
  const fromQuery = new URLSearchParams(location.search).get('k');
  return (fromHash || fromQuery || '').trim().toLowerCase();
}

// ------------------------------------------------------------------
// Saving: answers are saved to the database a moment after typing stops,
// and immediately when moving between questions.
// ------------------------------------------------------------------
let pending = {};
let inflight = null;
let timer = null;

function queueSave(qid, text) {
  pending[qid] = text;
  setSaveState('typing');
  clearTimeout(timer);
  timer = setTimeout(() => flush().catch(() => {}), 1200);
}

async function flush() {
  clearTimeout(timer);
  while (inflight) { try { await inflight; } catch { /* handled below */ } }
  if (!Object.keys(pending).length) return;
  const batch = pending;
  pending = {};
  setSaveState('saving');
  inflight = survey.save(state.token, batch)
    .then((r) => {
      state.submittedAt = r.submitted_at;
      setSaveState(Object.keys(pending).length ? 'typing' : 'saved');
    })
    .catch((e) => {
      pending = { ...batch, ...pending };
      handleFatal(e);
      setSaveState('error');
      throw e;
    })
    .finally(() => { inflight = null; });
  return inflight;
}

function setSaveState(s) {
  const el = document.querySelector('.save-state');
  if (!el) return;
  el.classList.toggle('error', s === 'error');
  el.textContent = {
    typing: '',
    saving: 'Saving…',
    saved: 'Saved ✓',
    error: 'Not saved yet. Check your internet.',
  }[s] || '';
}

// Save when the phone switches apps or the page is closed.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flush().catch(() => {});
});

function handleFatal(e) {
  if (e && e.message === 'survey_locked') { state.locked = true; renderLocked(); return true; }
  if (e && e.message === 'invalid_link') { renderInvalid(); return true; }
  return false;
}

// ------------------------------------------------------------------
// Screens
// ------------------------------------------------------------------
function show(html) {
  card.innerHTML = `<div class="screen">${html}</div>`;
  window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
}

const answered = (id) => (state.answers[String(id)] || '').trim().length > 0;
const answeredCount = () => state.questions.filter((q) => answered(q.id)).length;
const firstUnanswered = () => Math.max(0, state.questions.findIndex((q) => !answered(q.id)));

function header() {
  return `
    ${rings()}
    <div class="eyebrow">40th Anniversary</div>
    <h1 class="title-xl">40 Years of Love, Laughter &amp; Memories</h1>
    <p class="subtitle">The Newlywed Game</p>`;
}

function renderIntro() {
  const count = answeredCount();
  const started = count > 0;
  show(`
    <div class="center">
      ${header()}
      <p class="tagline">A few questions about four decades of love, laughter, and family.</p>
      <div class="ornament"><span class="gem"></span></div>
      <div class="for-chip">For ${esc(state.label)}</div>
    </div>
    <p class="intro-text">${esc(INTRO_TEXT)}</p>
    <div class="stack">
      ${started
        ? `<button class="btn" id="go">Continue where I left off</button>
           <p class="meta">${count} of ${state.questions.length} answered</p>
           <button class="btn-link" id="restart">Start from question 1</button>`
        : `<button class="btn" id="go">Let’s Begin</button>`}
    </div>
    <p class="small-note center">
      This link is just for ${esc(state.label)}. If you are not ${esc(state.label)}, please use the link that was sent to you.
      Your answers save automatically, so you can stop and come back any time with this same link.
    </p>`);
  document.getElementById('go').onclick = () => {
    state.index = started ? (count === state.questions.length ? state.questions.length - 1 : firstUnanswered()) : 0;
    renderQuestion();
  };
  const restart = document.getElementById('restart');
  if (restart) restart.onclick = () => { state.index = 0; renderQuestion(); };
}

function renderQuestion() {
  const total = state.questions.length;
  const i = state.index;
  const q = state.questions[i];
  const isLast = i === total - 1;
  const bar = state.questions.map((qq, j) =>
    `<span class="${j === i ? 'current' : answered(qq.id) ? 'done' : ''}"></span>`).join('');

  show(`
    <div class="progress" aria-label="Question ${i + 1} of ${total}">
      <div class="progress-top">
        <span class="progress-label">Question ${i + 1} of ${total}</span>
        <span class="progress-who">${esc(state.label)}</span>
      </div>
      <div class="progress-bar" aria-hidden="true">${bar}</div>
    </div>
    <h2 class="question" id="qtext">${esc(q.prompt)}</h2>
    <label class="sr-only" for="answer">Your answer</label>
    <textarea class="answer" id="answer" aria-labelledby="qtext" maxlength="4000"
      placeholder="Type your answer here…" autocapitalize="sentences" spellcheck="true">${esc(state.answers[String(q.id)] || '')}</textarea>
    <div class="hint"><span>Write as much as you like.</span><span class="save-state" aria-live="polite"></span></div>
    <div class="notice notice-error field-error" id="err" hidden></div>
    <div class="nav">
      <button class="btn-ghost" id="back">Back</button>
      <button class="btn" id="next">${isLast ? 'Review &amp; Submit' : 'Next'}</button>
    </div>
    <div class="later"><button class="btn-link" id="later">Save &amp; finish later</button></div>`);

  const ta = document.getElementById('answer');
  const err = document.getElementById('err');
  const grow = () => { ta.style.height = 'auto'; ta.style.height = Math.max(190, ta.scrollHeight + 4) + 'px'; };
  grow();
  ta.addEventListener('input', () => {
    state.answers[String(q.id)] = ta.value;
    err.hidden = true;
    grow();
    queueSave(String(q.id), ta.value);
  });

  document.getElementById('back').onclick = async () => {
    flush().catch(() => {});
    if (i === 0) renderIntro(); else { state.index = i - 1; renderQuestion(); }
  };
  document.getElementById('next').onclick = async () => {
    if (!ta.value.trim()) {
      err.textContent = 'Please write an answer before moving on. You can also tap “Save & finish later” and come back to it.';
      err.hidden = false;
      ta.focus();
      return;
    }
    flush().catch(() => {});
    if (isLast) renderReview(); else { state.index = i + 1; renderQuestion(); }
  };
  document.getElementById('later').onclick = async () => {
    try { await flush(); renderSavedForLater(); }
    catch (e) {
      if (!handleFatal(e)) { err.textContent = 'We couldn’t save just now. Please check your internet connection and try again.'; err.hidden = false; }
    }
  };
}

function renderReview() {
  const missing = state.questions.filter((q) => !answered(q.id));
  const items = state.questions.map((q, j) =>
    `<li class="${answered(q.id) ? '' : 'missing'}" data-j="${j}" aria-label="Question ${j + 1} ${answered(q.id) ? 'answered' : 'not answered'}">${answered(q.id) ? '✓' : j + 1}</li>`).join('');
  show(`
    <div class="center">
      <div class="eyebrow">Almost there</div>
      <h2 class="thanks-big">${missing.length ? 'Just a few more' : 'You’re all done!'}</h2>
      <p>${missing.length
        ? `You have ${missing.length} question${missing.length > 1 ? 's' : ''} left. Tap a red number to answer it.`
        : `You’ve answered all ${state.questions.length} questions. Ready to send them in?`}</p>
    </div>
    <ul class="check-list">${items}</ul>
    <div class="notice notice-error" id="err" hidden></div>
    <div class="stack">
      <button class="btn btn-ruby" id="submit" ${missing.length ? 'disabled' : ''}>Submit My Answers</button>
      <button class="btn-link" id="back">Go back to my answers</button>
    </div>
    <p class="small-note center">Your answers stay private until the party.</p>`);

  card.querySelectorAll('.check-list li.missing').forEach((li) => {
    li.onclick = () => { state.index = Number(li.dataset.j); renderQuestion(); };
  });
  document.getElementById('back').onclick = () => { state.index = state.questions.length - 1; renderQuestion(); };
  const btn = document.getElementById('submit');
  btn.onclick = async () => {
    btn.disabled = true;
    btn.textContent = 'Sending…';
    clearTimeout(timer);
    try {
      while (inflight) { try { await inflight; } catch { /* retry below */ } }
      pending = {};
      await survey.submit(state.token, state.answers);
      state.submittedAt = new Date().toISOString();
      renderThanks(true);
    } catch (e) {
      if (handleFatal(e)) return;
      const err = document.getElementById('err');
      err.textContent = e.message === 'incomplete'
        ? 'A question is still empty. Please go back and answer it.'
        : 'We couldn’t send your answers just now. Please check your internet connection and tap Submit again.';
      err.hidden = false;
      btn.disabled = false;
      btn.textContent = 'Submit My Answers';
    }
  };
}

function renderThanks(justSubmitted) {
  show(`
    <div class="center">
      ${rings()}
      <div class="eyebrow">${justSubmitted ? 'Submitted' : 'All set'}</div>
      <p class="thanks-big">${esc(THANK_YOU)}</p>
      <div class="ornament"><span class="gem"></span></div>
      ${state.locked ? '' : `
        <p class="small-note">Need to change something? You can use this same link until the answers are finalized.</p>
        <button class="btn-link" id="edit">Edit my answers</button>`}
    </div>`);
  const edit = document.getElementById('edit');
  if (edit) edit.onclick = () => { state.index = 0; renderQuestion(); };
}

function renderSavedForLater() {
  show(`
    <div class="center">
      ${rings()}
      <div class="eyebrow">Progress saved</div>
      <h2 class="thanks-big">Your answers are saved.</h2>
      <p>Come back any time by opening the same link you used today. You’ll pick up right where you left off.</p>
      <div class="stack" style="margin-top:22px"><button class="btn" id="go">Keep going</button></div>
    </div>`);
  document.getElementById('go').onclick = renderQuestion;
}

function renderLocked() {
  show(`
    <div class="center">
      ${rings()}
      <div class="eyebrow">Answers finalized</div>
      <h2 class="thanks-big">${state.submittedAt ? 'Your answers are locked in!' : 'The survey is now closed.'}</h2>
      <p>${state.submittedAt
        ? 'Thank you for playing. We can’t wait to celebrate 40 years of love with you!'
        : `Answers have been finalized for the party.${contact()}`}</p>
    </div>`);
}

function renderInvalid() {
  show(`
    <div class="center">
      ${rings()}
      <h2 class="thanks-big">This link isn’t working</h2>
      <p>Please open the exact link that was sent to you. If it still doesn’t work, ask for a new one.${contact()}</p>
    </div>`);
}

function renderProblem(msg) {
  show(`
    <div class="center">
      ${rings()}
      <h2 class="thanks-big">Something went wrong</h2>
      <p>${esc(msg)}</p>
      <div class="stack" style="margin-top:20px"><button class="btn" onclick="location.reload()">Try again</button></div>
    </div>`);
}

// ------------------------------------------------------------------
async function start() {
  if (!isConfigured()) { renderProblem('This site has not been connected to its database yet (see js/config.js).'); return; }
  if (!/^[0-9a-f]{64}$/.test(state.token)) { renderInvalid(); return; }
  try {
    const d = await survey.get(state.token);
    state.label = d.label;
    state.questions = d.questions;
    state.answers = d.answers || {};
    state.submittedAt = d.submitted_at;
    state.locked = d.locked;
    document.title = `For ${d.label}: The Newlywed Game`;
    if (state.locked) renderLocked();
    else if (state.submittedAt) renderThanks(false);
    else renderIntro();
  } catch (e) {
    if (!handleFatal(e)) renderProblem('We couldn’t load your questions. Please check your internet connection and try again.');
  }
}

start();
