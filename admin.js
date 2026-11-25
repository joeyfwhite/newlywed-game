// Administrator dashboard. Every read and write here is checked by the
// database (RLS + is_admin()); the page itself grants no access.
import { auth, admin, isConfigured } from './api.js';
import { buildDeck, toPptx, slideHtml } from './slides.js';
import { tableRows, toCsv, toXlsx, download } from './export.js';
import { COUPLE_NAMES, ANNIVERSARY_DATE, SITE_URL } from './config.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ROLES = [{ role: 'mom', label: 'Mom' }, { role: 'dad', label: 'Dad' }];
const LINKS_KEY = 'nwg-new-links';

let data = null;   // { questions, participants, answers, settings }
let byRole = null; // { mom: {qid: row}, dad: {qid: row} }

function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2200);
}
const when = (ts) => (ts ? new Date(ts).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '');

async function copy(text) {
  try { await navigator.clipboard.writeText(text); }
  catch {
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    document.execCommand('copy'); ta.remove();
  }
  toast('Copied');
}

function surveyBaseUrl() {
  if (SITE_URL) return SITE_URL.replace(/#.*$/, '').replace(/\/?$/, '/');
  return location.origin + location.pathname.replace(/admin\.html$/, '');
}

function savedLinks() { try { return JSON.parse(sessionStorage.getItem(LINKS_KEY)) || {}; } catch { return {}; } }
function saveLink(role, url) { sessionStorage.setItem(LINKS_KEY, JSON.stringify({ ...savedLinks(), [role]: url })); }

// ------------------------------------------------------------------
async function guard(fn) {
  try { return await fn(); }
  catch (e) {
    if (e.message === 'signed_out') { showLogin('Your session ended. Please sign in again.'); return; }
    if (e.message === 'not_authorized') { toast('This account is not an administrator.'); return; }
    toast(e.message === 'network' ? 'Network problem. Check your connection.' : `Error: ${e.message}`);
    throw e;
  }
}

function showLogin(msg) {
  $('boot').hidden = true;
  $('dash').hidden = true;
  $('login').hidden = false;
  const err = $('login-error');
  err.hidden = !msg;
  err.textContent = msg || '';
}

$('login-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const btn = ev.submitter || ev.target.querySelector('button');
  btn.disabled = true;
  try {
    await auth.signIn($('email').value.trim(), $('password').value);
    $('password').value = '';
    await enter();
  } catch (e) {
    showLogin(e.message === 'network' ? 'Network problem. Check your connection.' : 'That email and password did not work.');
  } finally { btn.disabled = false; }
});

$('signout').onclick = async () => { await auth.signOut(); sessionStorage.removeItem(LINKS_KEY); showLogin(); };
$('refresh').onclick = () => guard(load).then(() => toast('Up to date'));

async function enter() {
  const ok = await admin.isAdmin();
  if (!ok) { await auth.signOut(); showLogin('This account is not an administrator. Ask the site owner to run make_admin.sql for it.'); return; }
  $('login').hidden = true;
  $('boot').hidden = true;
  $('dash').hidden = false;
  $('who').textContent = `Signed in as ${auth.session()?.email || ''}`;
  await load();
}

async function load() {
  data = await admin.loadAll();
  byRole = { mom: {}, dad: {} };
  for (const a of data.answers) byRole[a.role][a.question_id] = a;
  render();
}

// ------------------------------------------------------------------
const answeredCount = (role) => data.questions.filter((q) => (byRole[role][q.id]?.answer || '').trim()).length;
const participant = (role) => data.participants.find((p) => p.role === role) || {};
const bothDone = () => ROLES.every(({ role }) => participant(role).submitted_at);

function render() {
  const total = data.questions.length;
  const locked = data.settings.locked;

  // Status cards
  $('status').innerHTML = ROLES.map(({ role, label }) => {
    const p = participant(role);
    const n = answeredCount(role);
    const pill = p.submitted_at ? '<span class="pill pill-done">Completed</span>'
      : n || p.started_at ? '<span class="pill pill-progress">In progress</span>'
        : '<span class="pill pill-none">Not started</span>';
    const missing = data.questions.filter((q) => !(byRole[role][q.id]?.answer || '').trim()).map((q) => q.id);
    return `<div class="status-card" data-role="${role}">
      <h3>${label} ${pill}</h3>
      <div class="meter"><span style="width:${(n / total) * 100}%"></span></div>
      <p class="meta"><strong>${n} of ${total}</strong> questions answered</p>
      ${p.submitted_at ? `<p class="meta">Submitted ${esc(when(p.submitted_at))}</p>` : ''}
      ${p.updated_at ? `<p class="meta">Last saved ${esc(when(p.updated_at))}</p>` : ''}
      ${missing.length && missing.length < total ? `<p class="meta">Unanswered: ${missing.map((m) => `Q${m}`).join(', ')}</p>` : ''}
    </div>`;
  }).join('');

  const ready = bothDone();
  $('ready').className = `ready-banner ${ready ? 'ready' : 'waiting'}`;
  $('ready-text').textContent = ready
    ? 'Both surveys are complete. The slideshow is ready!'
    : `Waiting on ${ROLES.filter(({ role }) => !participant(role).submitted_at).map((r) => r.label).join(' and ')}. The slideshow will be ready when both have submitted.`;

  $('lock-state').innerHTML = locked
    ? `<span class="pill pill-locked">Locked</span> <span class="meta">since ${esc(when(data.settings.locked_at))}. Parents can no longer change answers.</span>`
    : '<span class="pill pill-done">Open</span> <span class="meta">Parents can still edit their answers.</span>';
  $('lock-btn').textContent = locked ? 'Reopen Submissions' : 'Lock Submissions';
  $('lock-btn').className = locked ? 'btn' : 'btn btn-ruby';

  renderLinks();
  renderTable();
  $('pptx-note').textContent = ready ? '' : 'Not everyone has submitted yet. You can still download a draft; missing answers show as “No answer yet”.';
  if ($('preview').childElementCount) renderPreview();
}

function renderLinks() {
  const links = savedLinks();
  $('links').innerHTML = ROLES.map(({ role, label }) => {
    const p = participant(role);
    const url = links[role];
    const msg = `Hi ${label}! Here is your private link for the Newlywed Game. Please answer on your own, no peeking! ${url}`;
    return `<div class="status-card">
      <h3>${label}’s link</h3>
      <p class="meta">${p.link_created_at ? `Link created ${esc(when(p.link_created_at))}` : 'No link created yet.'}</p>
      ${url ? `
        <div class="link-box"><input readonly value="${esc(url)}" aria-label="${label}'s private link"><button class="btn-small" data-copy="${esc(url)}">Copy</button></div>
        <div class="row" style="margin-top:8px">
          <a class="btn-small" href="sms:&body=${encodeURIComponent(msg)}">Text it</a>
          <a class="btn-small" href="${esc(url)}" target="_blank" rel="noopener">Open to test</a>
        </div>
        <p class="meta" style="margin-top:8px">Copy it now. For privacy, the link is only shown in this browser tab. If you lose it, create a new one.</p>`
        : p.link_created_at ? '<p class="meta">The link was created earlier and is not shown again. Create a new one if you need it (the old one will stop working).</p>' : ''}
      <button class="btn-ghost" style="margin-top:10px" data-gen="${role}">${p.link_created_at ? 'Create a new link' : `Create ${label}’s link`}</button>
    </div>`;
  }).join('');
}

function renderTable() {
  $('rows').innerHTML = data.questions.map((q) => {
    const cell = (role, label) => {
      const a = byRole[role][q.id];
      const text = (a?.answer || '').trim();
      return `<td><span class="who-label">${label}</span>
        ${text ? `<div class="ans">${esc(a.answer)}</div>` : '<div class="missing">Not answered yet</div>'}
        <div class="cell-tools">
          ${text ? `<button class="btn-small" data-copy-ans="${role}:${q.id}">Copy</button>` : ''}
          <button class="btn-small" data-edit="${role}:${q.id}">Edit</button>
          ${a?.updated_at && text ? `<span class="stamp">${esc(when(a.updated_at))}${a.updated_by === 'admin' ? ' (edited by you)' : ''}</span>` : ''}
        </div></td>`;
    };
    return `<tr><td class="q"><span class="num">QUESTION ${q.id}</span>${esc(q.prompt)}</td>${cell('mom', 'MOM')}${cell('dad', 'DAD')}</tr>`;
  }).join('');
}

function deckData() {
  const ans = { mom: {}, dad: {} };
  for (const r of ['mom', 'dad']) for (const [qid, row] of Object.entries(byRole[r])) ans[r][qid] = row.answer;
  return buildDeck(data.questions, ans, { coupleNames: COUPLE_NAMES, date: ANNIVERSARY_DATE });
}

function renderPreview() {
  const deck = deckData();
  $('preview').innerHTML = deck.map((s, i) => {
    const small = s.fits && ['mom', 'dad'].filter((r) => !s.fits[r].fits || s.fits[r].size < 16);
    const warn = small && small.length
      ? `<span class="warn">Long answer (${small.map((r) => r === 'mom' ? 'Mom' : 'Dad').join(', ')}): small text. Consider trimming.</span>` : '';
    const name = s.kind === 'title' ? 'Title' : s.kind === 'closing' ? 'Closing' : `Question ${s.questionId}`;
    return `<figure class="slide-wrap" data-i="${i}">${slideHtml(s)}<figcaption><span>${i + 1}. ${name}</span>${warn}</figcaption></figure>`;
  }).join('');
}

// ------------------------------------------------------------------
document.addEventListener('click', async (ev) => {
  const t = ev.target.closest('button, figure.slide-wrap, .lightbox');
  if (!t) return;

  if (t.classList.contains('lightbox')) { t.remove(); return; }
  if (t.matches('figure.slide-wrap')) {
    const box = document.createElement('div');
    box.className = 'lightbox';
    box.innerHTML = t.querySelector('.slide').outerHTML;
    document.body.appendChild(box);
    return;
  }
  if (t.dataset.copy) return copy(t.dataset.copy);
  if (t.dataset.copyAns) {
    const [role, qid] = t.dataset.copyAns.split(':');
    return copy(byRole[role][qid].answer);
  }
  if (t.dataset.gen) {
    const role = t.dataset.gen;
    const label = role === 'mom' ? 'Mom' : 'Dad';
    if (participant(role).link_created_at && !confirm(`Create a new link for ${label}? The old link will stop working. Saved answers are kept.`)) return;
    await guard(async () => {
      const token = await admin.generateLink(role);
      saveLink(role, `${surveyBaseUrl()}#k=${token}`);
      await load();
      toast(`${label}’s link is ready`);
    });
    return;
  }
  if (t.dataset.edit) {
    const [role, qid] = t.dataset.edit.split(':');
    const td = t.closest('td');
    const current = byRole[role][qid]?.answer || '';
    td.innerHTML = `<span class="who-label">${role.toUpperCase()}</span>
      <textarea class="edit-area">${esc(current)}</textarea>
      <div class="cell-tools"><button class="btn-small" data-save="${role}:${qid}">Save</button><button class="btn-small" data-cancel="1">Cancel</button></div>`;
    td.querySelector('textarea').focus();
    return;
  }
  if (t.dataset.save) {
    const [role, qid] = t.dataset.save.split(':');
    const text = t.closest('td').querySelector('textarea').value;
    await guard(async () => { await admin.updateAnswer(role, Number(qid), text); await load(); toast('Answer updated'); });
    return;
  }
  if (t.dataset.cancel) { renderTable(); return; }
  if (t.dataset.reset) {
    const label = t.dataset.reset === 'mom' ? 'Mom' : 'Dad';
    if (!confirm(`Erase ALL of ${label}’s answers? This cannot be undone.`)) return;
    await guard(async () => { await admin.resetSurvey(t.dataset.reset); await load(); toast(`${label}’s answers erased`); });
    return;
  }

  switch (t.id) {
    case 'lock-btn':
      await guard(async () => { await admin.setLocked(!data.settings.locked); await load(); toast(data.settings.locked ? 'Submissions locked' : 'Submissions reopened'); });
      break;
    case 'preview-btn':
      await guard(load);
      renderPreview();
      $('preview').scrollIntoView({ behavior: 'smooth', block: 'start' });
      break;
    case 'pptx-btn': {
      t.disabled = true;
      const old = t.textContent;
      t.textContent = 'Building…';
      try {
        await guard(load); // always use the newest answers
        if (!window.PptxGenJS) throw new Error('PowerPoint library did not load. Refresh the page.');
        const pres = toPptx(deckData(), window.PptxGenJS);
        await pres.writeFile({ fileName: `Newlywed-Game-40-Years-${new Date().toISOString().slice(0, 10)}.pptx` });
        toast('PowerPoint downloaded');
      } catch (e) { toast(e.message); } finally { t.disabled = false; t.textContent = old; }
      break;
    }
    case 'csv-btn':
      await guard(load);
      download('newlywed-game-answers.csv', toCsv(tableRows(data.questions, byRole)), 'text/csv;charset=utf-8');
      break;
    case 'xlsx-btn':
      await guard(load);
      download('newlywed-game-answers.xlsx', await toXlsx(tableRows(data.questions, byRole), window.JSZip));
      break;
    case 'json-btn':
      await guard(load);
      download('newlywed-game-raw.json', JSON.stringify({ exported_at: new Date().toISOString(), ...data }, null, 2), 'application/json');
      break;
    default:
  }
});

// ------------------------------------------------------------------
(async () => {
  if (!isConfigured()) { showLogin('This site is not connected to Supabase yet. Edit js/config.js first.'); return; }
  if (!auth.session()) { showLogin(); return; }
  try { await enter(); } catch { showLogin(); }
})();
