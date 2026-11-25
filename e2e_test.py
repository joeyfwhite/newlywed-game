#!/usr/bin/env python3
"""TEST ONLY. Full workflow test in a real browser against the mock API.
Runs: admin login checks -> create links -> Mom saves, leaves, returns,
submits -> Dad submits -> privacy probes -> admin views, edits, locks,
reopens -> preview -> PowerPoint/CSV/Excel downloads verified.
Usage: python3 tests/e2e_test.py <outdir>
"""
import html, json, os, re, subprocess, sys, time, zipfile
from playwright.sync_api import sync_playwright, expect

sys.path.insert(0, os.path.dirname(__file__))
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else 'e2e-out')
os.makedirs(OUT, exist_ok=True)
DB, PORT = 'newlywed_e2e', 8787
BASE = f'http://127.0.0.1:{PORT}/'
PSQL = ['psql', '-h', '/tmp', '-p', '54329', '-U', 'postgres', '-X', '-q', '-v', 'ON_ERROR_STOP=1']

# Sample answers (same as sample_data.mjs)
def load_answers():
    out = subprocess.run(['node', '-e', "import('./sample_data.mjs').then(m=>console.log(JSON.stringify({mom:m.MOM,dad:m.DAD})))"], cwd=HERE, capture_output=True, text=True, check=True).stdout
    d = json.loads(out)
    return {r: {int(k): v for k, v in d[r].items()} for r in d}
ANS = load_answers()
MOM, DAD = ANS['mom'], ANS['dad']

TEST_CONFIG = """
export const SUPABASE_URL = 'http://127.0.0.1:%d';
export const SUPABASE_ANON_KEY = 'test-anon-key';
export const ORGANIZER_NAME = 'Joey';
export const COUPLE_NAMES = 'Linda & Mike';
export const ANNIVERSARY_DATE = 'December 2026';
export const SITE_URL = '';
""" % PORT

results = []
def check(cond, label):
    results.append((bool(cond), label))
    print(('PASS ' if cond else 'FAIL ') + label, flush=True)
    if not cond:
        raise AssertionError(label)

# ---------------- database + server ----------------
subprocess.run(PSQL + ['-d', 'postgres', '-c', f'drop database if exists {DB}', '-c', f'create database {DB}'], check=True)
for f in ['supabase_stub.sql', '../supabase/schema.sql']:
    subprocess.run(PSQL + ['-d', DB, '-f', os.path.join(HERE, f)], check=True, capture_output=True)
subprocess.run(PSQL + ['-d', DB, '-c', """
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000aaaa','admin@example.com'),('00000000-0000-0000-0000-00000000bbbb','stranger@example.com');
insert into public.admins (user_id, email) select id, email from auth.users where email = 'admin@example.com';"""], check=True)
server = subprocess.Popen([sys.executable, os.path.join(HERE, 'mock_supabase.py'), str(PORT), DB], stdout=subprocess.PIPE)
server.stdout.readline()

def route_config(ctx):
    ctx.route('**/js/config.js', lambda r: r.fulfill(status=200, content_type='application/javascript', body=TEST_CONFIG))
    ctx.route('https://fonts.googleapis.com/**', lambda r: r.abort())  # offline: use installed Lora/Montserrat

def answer_questions(page, answers, qids):
    for q in qids:
        expect(page.locator('.progress-label')).to_have_text(f'Question {q} of 11')
        page.fill('#answer', answers[q])
        page.click('#next')

try:
    with sync_playwright() as p:
        try:
            browser = p.chromium.launch()
        except Exception:
            browser = p.chromium.launch(executable_path='/usr/bin/google-chrome')
        iphone = p.devices['iPhone 13']

        # ---------------- Admin sign-in checks ----------------
        actx = browser.new_context(viewport={'width': 1280, 'height': 900}, accept_downloads=True)
        route_config(actx)
        admin = actx.new_page()
        admin.on('dialog', lambda d: d.accept())
        admin.goto(BASE + 'admin.html')
        admin.fill('#email', 'admin@example.com'); admin.fill('#password', 'wrong'); admin.click('#login-form button')
        expect(admin.locator('#login-error')).to_contain_text('did not work')
        check(admin.locator('#dash').is_hidden(), 'Wrong password does not open the dashboard')
        admin.fill('#email', 'stranger@example.com'); admin.fill('#password', 'stranger password'); admin.click('#login-form button')
        expect(admin.locator('#login-error')).to_contain_text('not an administrator')
        check(admin.locator('#dash').is_hidden(), 'A signed-in non-admin account is refused')
        admin.fill('#email', 'admin@example.com'); admin.fill('#password', 'correct horse battery'); admin.click('#login-form button')
        expect(admin.locator('#dash')).to_be_visible()
        check(True, 'Admin can sign in')
        expect(admin.locator('#ready-text')).to_contain_text('Waiting on Mom and Dad')

        admin.click('[data-gen="mom"]'); expect(admin.locator('.toast')).to_contain_text('Mom’s link is ready')
        admin.click('[data-gen="dad"]'); expect(admin.locator('.toast').last).to_contain_text('Dad’s link is ready')
        links = admin.locator('.link-box input').evaluate_all('els => els.map(e => e.value)')
        mom_link, dad_link = links
        check(re.search(r'#k=[0-9a-f]{64}$', mom_link) and re.search(r'#k=[0-9a-f]{64}$', dad_link) and mom_link != dad_link, 'Two different private links were created')
        admin.screenshot(path=f'{OUT}/admin-links.png', full_page=False)

        # ---------------- Mom: start, save, leave ----------------
        mctx = browser.new_context(**iphone); route_config(mctx)
        mom = mctx.new_page()
        mom.goto(mom_link)
        expect(mom.locator('.for-chip')).to_have_text('For Mom')
        check('Let’s Begin' in mom.inner_text('body') and '40 Years of Love, Laughter & Memories' in mom.inner_text('body'), 'Mom sees the opening screen')
        mom.screenshot(path=f'{OUT}/mobile-1-intro.png', full_page=True)
        mom.click('#go')
        mom.click('#next')
        expect(mom.locator('#err')).to_be_visible()
        check(True, 'Empty answer is blocked (answers are required)')
        mom.fill('#answer', MOM[1])
        expect(mom.locator('.save-state')).to_have_text('Saved ✓', timeout=8000)
        check(True, 'Answer auto-saves while typing')
        mom.screenshot(path=f'{OUT}/mobile-2-question.png', full_page=True)
        mom.click('#next')
        answer_questions(mom, MOM, range(2, 6))
        mom.click('#later')
        expect(mom.locator('.thanks-big')).to_have_text('Your answers are saved.')
        mctx.close()

        # Mom returns later on a "different phone"
        mctx = browser.new_context(**iphone); route_config(mctx)
        mom = mctx.new_page(); mom.goto(mom_link)
        expect(mom.locator('#go')).to_have_text('Continue where I left off')
        check('5 of 11 answered' in mom.inner_text('body'), 'Mom resumes with 5 of 11 saved')
        mom.click('#go')
        expect(mom.locator('.progress-label')).to_have_text('Question 6 of 11')
        answer_questions(mom, MOM, range(6, 12))
        expect(mom.locator('#submit')).to_be_enabled()
        mom.screenshot(path=f'{OUT}/mobile-3-review.png', full_page=True)
        mom.click('#submit')
        expect(mom.locator('.thanks-big')).to_have_text('Thank you! Your answers have been submitted. We can’t wait to celebrate 40 years of love with you!')
        check(True, 'Mom submits and sees the exact confirmation message')
        body = mom.inner_text('body')
        check(not any(MOM[q][:30] in body for q in MOM), 'Confirmation screen does not display submitted answers')
        mom.screenshot(path=f'{OUT}/mobile-4-thanks.png', full_page=True)

        # ---------------- Dad ----------------
        dctx = browser.new_context(**iphone); route_config(dctx)
        dad = dctx.new_page(); dad.goto(dad_link)
        expect(dad.locator('.for-chip')).to_have_text('For Dad')
        check('MOM-' not in dad.content() and MOM[1][:25] not in dad.content(), 'Dad’s page has none of Mom’s answers')
        dad.click('#go')
        answer_questions(dad, DAD, range(1, 12))
        dad.click('#submit')
        expect(dad.locator('.thanks-big')).to_contain_text('Thank you!')
        # Dad re-opens to edit: he sees only his own answers
        dad.click('#edit')
        check(dad.input_value('#answer') == DAD[1], 'Dad can reopen and edit his own answers')
        for q in range(1, 12):
            if q > 1:
                dad.click('#next')
            v = dad.input_value('#answer')
            if v != DAD[q] or v == MOM[q]:
                check(False, f'Dad edit view Q{q} shows only Dad’s answer')
        check(True, 'Dad’s edit view shows only his own 11 answers')

        # ---------------- Privacy probes from a parent's browser ----------------
        probe = mom.evaluate("""async ([base]) => {
          const h = { apikey: 'test-anon-key', Authorization: 'Bearer test-anon-key', 'Content-Type': 'application/json' };
          const r1 = await fetch(base + 'rest/v1/answers?select=*', { headers: h });
          const r2 = await fetch(base + 'rest/v1/rpc/admin_generate_link', { method: 'POST', headers: h, body: JSON.stringify({ p_role: 'dad' }) });
          const r3 = await fetch(base + 'rest/v1/rpc/survey_get', { method: 'POST', headers: h, body: JSON.stringify({ p_token: 'dad' }) });
          const r4 = await fetch(base + 'rest/v1/participants?select=*', { headers: h });
          return [r1.status, r2.status, r3.status, r4.status, await r1.text(), await r3.text()];
        }""", [BASE])
        check(probe[0] in (401, 403) and 'DAD' not in probe[4], 'Parent cannot read the answers table directly')
        check(probe[1] in (401, 403), 'Parent cannot call admin functions')
        check(probe[2] == 400 and 'invalid_link' in probe[5], 'Guessing a link (“dad”) is rejected')
        check(probe[3] in (401, 403), 'Parent cannot list participants')

        # ---------------- Admin views both ----------------
        admin.click('#refresh')
        expect(admin.locator('#ready-text')).to_contain_text('Both surveys are complete')
        check(True, 'Dashboard shows both surveys complete / slideshow ready')
        rows = admin.locator('#rows tr')
        check(rows.count() == 11, 'Comparison table has 11 question rows')
        table_text = admin.inner_text('#rows')
        check(all(MOM[q].split('\n')[0][:40] in table_text and DAD[q][:30] in table_text for q in range(1, 12)), 'Admin sees all 22 answers side by side')
        admin.screenshot(path=f'{OUT}/admin-dashboard.png', full_page=True)

        # Admin edits a typo
        admin.click('[data-edit="dad:8"]')
        admin.fill('#rows textarea', 'You’ve Got Mail (and Sleepless in Seattle)')
        admin.click('[data-save="dad:8"]')
        expect(admin.locator('#rows')).to_contain_text('Sleepless in Seattle')
        check('edited by you' in admin.inner_text('#rows'), 'Admin can edit an answer')
        DAD[8] = 'You’ve Got Mail (and Sleepless in Seattle)'

        # Lock
        admin.click('#lock-btn')
        expect(admin.locator('#lock-state')).to_contain_text('Locked')
        m2 = mctx.new_page(); m2.goto(mom_link)
        expect(m2.locator('.thanks-big')).to_have_text('Your answers are locked in!')
        locked_probe = m2.evaluate("""async ([base, link]) => {
          const t = link.split('#k=')[1];
          const h = { apikey: 'test-anon-key', Authorization: 'Bearer test-anon-key', 'Content-Type': 'application/json' };
          const r = await fetch(base + 'rest/v1/rpc/survey_save', { method: 'POST', headers: h, body: JSON.stringify({ p_token: t, p_answers: { '1': 'changed after lock' } }) });
          return [r.status, await r.text()];
        }""", [BASE, mom_link])
        check(locked_probe[0] == 400 and 'survey_locked' in locked_probe[1], 'Locked survey rejects changes on the server')
        admin.click('#lock-btn')
        expect(admin.locator('#lock-state')).to_contain_text('Open')
        check(True, 'Admin can reopen submissions')

        # ---------------- Preview + downloads ----------------
        admin.click('#preview-btn')
        expect(admin.locator('#preview figure')).to_have_count(13)
        check(True, 'Preview shows 13 slides')
        admin.locator('#preview').screenshot(path=f'{OUT}/admin-preview.png')

        with admin.expect_download() as dl:
            admin.click('#pptx-btn')
        pptx_path = f'{OUT}/slideshow.pptx'
        dl.value.save_as(pptx_path)
        with zipfile.ZipFile(pptx_path) as z:
            slides = sorted([n for n in z.namelist() if re.fullmatch(r'ppt/slides/slide\d+\.xml', n)], key=lambda n: int(re.findall(r'\d+', n)[0]))
            check(len(slides) == 13, f'PowerPoint has 13 slides (found {len(slides)})')
            texts = []
            for n in slides:
                raw = z.read(n).decode('utf-8')
                texts.append(html.unescape(' '.join(re.findall(r'<a:t>(.*?)</a:t>', raw, re.S))))
        check('40 Years of Love,' in texts[0] and 'Laughter & Memories' in texts[0], 'Slide 1 is the title slide')
        check('Here’s to 40 Years…' in texts[12] and 'and Many More!' in texts[12], 'Slide 13 is the closing slide')
        norm = lambda s: re.sub(r'\s+', ' ', s).strip()
        for q in range(1, 12):
            t = norm(texts[q])
            ok = 'MOM' in t and 'DAD' in t and norm(MOM[q]) in t and norm(DAD[q]) in t and t.index('MOM') < t.index('DAD')
            check(ok, f'Slide {q + 1}: question {q} with Mom and Dad answers')

        with admin.expect_download() as dl:
            admin.click('#csv-btn')
        csv_text = open(dl.value.path(), encoding='utf-8-sig').read()
        check(csv_text.count('\n') >= 12 and 'Sleepless in Seattle' in csv_text, 'CSV export contains the answers')
        with admin.expect_download() as dl:
            admin.click('#xlsx-btn')
        xlsx_path = f'{OUT}/answers.xlsx'; dl.value.save_as(xlsx_path)
        with zipfile.ZipFile(xlsx_path) as z:
            sheet = html.unescape(z.read('xl/worksheets/sheet1.xml').decode())
        check('Sleepless in Seattle' in sheet and 'Christmas Eve pancakes' in sheet, 'Excel export contains the answers')
        with admin.expect_download() as dl:
            admin.click('#json-btn')
        raw = json.load(open(dl.value.path()))
        check(len(raw['answers']) == 22, 'Raw JSON export has 22 answers')

        # Admin dashboard on a phone, too
        pctx = browser.new_context(**iphone); route_config(pctx)
        pctx.add_init_script("")
        browser.close()
finally:
    server.terminate()

print(f"\n{sum(r[0] for r in results)} checks passed, {sum(not r[0] for r in results)} failed")
