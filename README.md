# The Newlywed Game: 40 Years of Love

A private, two-person anniversary survey with an admin dashboard and a one-click PowerPoint slideshow.

- **Mom and Dad** each get a private link, answer 11 questions on their phone, can stop and come back, and see a thank-you screen when done.
- **You (the admin)** sign in to a dashboard to track progress, read answers side by side, edit typos, lock or reopen the survey, export CSV/Excel/JSON, preview the slideshow, and download a 13-slide `.pptx` that imports straight into Google Slides.

Hosting is free: **GitHub Pages** for the website, **Supabase** (free plan) for the database and admin login.

---

## Launch checklist

Do these in order. It takes about 30 minutes.

1. [ ] Create a free Supabase project (Part 1, steps 1 to 2).
2. [ ] Run `supabase/schema.sql` in the Supabase SQL Editor (step 3).
3. [ ] Create your admin user and run `supabase/make_admin.sql` with your email (step 4).
4. [ ] Turn off public sign-ups in Supabase (step 5).
5. [ ] Put your Project URL and publishable key in `js/config.js` (step 6).
6. [ ] Create a GitHub repository, upload these files, turn on GitHub Pages (Part 2).
7. [ ] Open `https://<you>.github.io/<repo>/admin.html` and sign in.
8. [ ] Click **Create Mom’s link**, tap **Open to test**, answer a couple of questions. Do the same for Dad.
9. [ ] In **Testing tools**, erase both test surveys. Then click **Create a new link** for each parent so the tested links stop working.
10. [ ] Send Mom her link and Dad his link (use **Copy** or **Text it**). Send each link only to that parent.
11. [ ] Watch the dashboard. When the green “slideshow is ready” banner appears, click **Lock Submissions**, then **Download PowerPoint**.
12. [ ] Import the `.pptx` into Google Slides (Part 5).

---

## Part 1: Supabase setup

1. Go to <https://supabase.com>, sign up, and click **New project**. Pick any name (for example `newlywed-game`), set a database password (save it somewhere; you won’t need it day to day), and choose the region closest to you. The Free plan is fine.
2. Wait for the project to finish setting up (a minute or two).
3. **Create the database.** Left sidebar: **SQL Editor** → **New query**. Open `supabase/schema.sql` from this repo, copy the whole file, paste it in, and click **Run**. You should see “Success. No rows returned.” (It is safe to run again later.)
4. **Create your admin login.**
   - Left sidebar: **Authentication** → **Users** → **Add user** → **Create new user**. Enter your email and a strong password, tick **Auto Confirm User**, and create it.
   - Back in **SQL Editor** → **New query**: paste `supabase/make_admin.sql`, change `you@example.com` to your email, and **Run**. The last line should show one row with your email.
5. **Turn off public sign-ups** (recommended): **Authentication** → **Sign In / Providers** → turn off **Allow new users to sign up** → Save. (Even if someone did sign up, they would see nothing, because only users listed in the `admins` table have access.)
6. **Copy your keys into `js/config.js`.**
   - **Project URL**: click **Connect** at the top of the dashboard (or **Project Settings** → **Data API**). It looks like `https://abcdefghijkl.supabase.co`.
   - **Publishable key**: **Project Settings** → **API Keys**. Copy the key that starts with `sb_publishable_`. (If your project only shows legacy keys, use the **anon public** key. If you ever get “Invalid API key” errors with the publishable key, switch to the legacy **anon** key on the **Legacy API Keys** tab.)
   - Edit `js/config.js`:

     ```js
     export const SUPABASE_URL = 'https://abcdefghijkl.supabase.co';
     export const SUPABASE_ANON_KEY = 'sb_publishable_xxxxxxxx';
     export const ORGANIZER_NAME = 'Joey';            // optional
     export const COUPLE_NAMES = 'Mom & Dad';         // optional, title slide
     export const ANNIVERSARY_DATE = 'December 2026'; // optional, title slide
     ```

   The publishable/anon key is designed to be public and is safe to commit. **Never** put the `secret` or `service_role` key anywhere in this project.

**Note on the free plan:** Supabase pauses free projects after about a week with no activity. If the site stops loading, open the Supabase dashboard and click **Restore project**. Your data is kept. Visiting the admin dashboard every few days avoids this.

## Part 2: Deploy to GitHub Pages

1. Create a GitHub account if needed, then **New repository** (for example `newlywed-game`). GitHub Pages is free for **public** repositories. Public is fine here: the code contains no answers and no private links (answers live only in Supabase, behind the security rules).
2. Upload the files: on the new repo page, click **uploading an existing file**, drag in everything from this folder (including the `js`, `css`, `vendor`, and `supabase` folders and the `.nojekyll` file), and **Commit changes**.
   Or, from a terminal:

   ```bash
   git init && git add . && git commit -m "Newlywed Game"
   git branch -M main
   git remote add origin https://github.com/<you>/newlywed-game.git
   git push -u origin main
   ```

3. In the repo: **Settings** → **Pages** → **Build and deployment** → Source: **Deploy from a branch** → Branch: `main`, folder `/ (root)` → **Save**.
4. After a minute, your site is live at `https://<you>.github.io/newlywed-game/`.
   - Survey (parents only use their private links): `https://<you>.github.io/newlywed-game/#k=...`
   - Admin dashboard: `https://<you>.github.io/newlywed-game/admin.html`

Changing `js/config.js` later? Commit the change; Pages updates in about a minute.

Alternative hosts (also free, also no build step): Netlify or Cloudflare Pages. Drag-and-drop the folder. Everything works the same.

## Part 3: Creating Mom’s and Dad’s private links

1. Open `admin.html` and sign in.
2. Under **Private Survey Links**, click **Create Mom’s link** and **Create Dad’s link**.
3. Use **Copy** (then paste into a text or email) or **Text it** (opens Messages on an iPhone or Mac with a short message filled in). **Open to test** opens the survey exactly as the parent will see it.

Things to know:
- The link is shown only in that browser tab, because only a scrambled fingerprint of it is stored. If you lose it, click **Create a new link** and send the new one. The old link stops working, and any answers already saved are kept.
- Each link opens a page that clearly says **For Mom** or **For Dad**, so nobody answers under the wrong name.
- If a parent loses their link, just resend the same one (from your text history) or create a new one.

## Part 4: Using the admin dashboard

- **Status**: Completed / In progress / Not started for each parent, how many questions are answered, which are still unanswered, and when they submitted and last saved.
- **Green banner**: appears when both have submitted. That means the slideshow is ready.
- **Lock Submissions**: stops all changes from the parents (enforced by the database, not just hidden buttons). **Reopen Submissions** undoes it.
- **Answers Side by Side**: question, Mom’s answer, Dad’s answer. Each answer has **Copy** and **Edit** (fix a typo or trim a long answer; edits are marked “edited by you”).
- **Downloads**: CSV, Excel (.xlsx), and raw JSON (everything, including timestamps).
- **Testing tools**: erase one parent’s answers. Use only before sending the real links.

## Part 5: The slideshow (PowerPoint → Google Slides)

1. Click **Preview Slideshow** to see all 13 slides. A slide with a very long answer is flagged so you can trim it with **Edit** (the text shrinks automatically to fit, but shorter is better on a TV).
2. Click **Download PowerPoint (.pptx)**. It always uses the latest answers, so after any edit just download again. That is the “regenerate” button.
3. Import into Google Slides, either way:
   - **Option A**: Go to <https://drive.google.com> → **New** → **File upload** → choose the `.pptx`. Then right-click it → **Open with** → **Google Slides** → **File** → **Save as Google Slides**.
   - **Option B**: Open a blank Google Slides presentation → **File** → **Import slides** → **Upload** → choose the `.pptx` → **Select all** → **Import slides**. Delete the blank first slide.
4. The deck uses the fonts **Lora** and **Montserrat**, which Google Slides has built in, so it looks the same after import. (In desktop PowerPoint without those fonts installed, PowerPoint substitutes similar fonts.)

Slides: 1 title (“40 Years of Love, Laughter & Memories”), 11 question slides (question at top, **MOM** left, **DAD** right), 1 closing (“Here’s to 40 Years… and Many More!”).

### Why not create the Google Slides deck directly?

It is possible, but it needs a Google Cloud setup that adds more work than it saves: create a Google Cloud project, enable the Google Slides API, configure an OAuth consent screen (in “Testing” mode with yourself added as a test user), create an OAuth **Web client ID** with your GitHub Pages address as an authorized JavaScript origin, then sign in with Google from the dashboard each time. The `.pptx` import above gives the same slides in Google Slides in about 30 seconds with no setup, so this app uses that route.

---

## How the privacy and security work

- **Parents never touch database tables.** Every table has Row Level Security turned on, and the public (anonymous) role has no table permissions at all. Parents can only call three database functions: get my survey, save my progress, submit.
- **The private link is checked on the server.** Each link contains a random 64-character code (about 244 bits, impossible to guess). Only its SHA-256 fingerprint is stored. The database functions hash the code, find the one parent it belongs to, and only ever read or write that parent’s rows. No function accepts “mom” or “dad” from a parent, so there is no way to ask for the other’s answers.
- **After submitting, answers are not shown.** The confirmation screen shows only the thank-you message. A parent can choose **Edit my answers** to change their own answers until you lock the survey; they never see the other parent’s.
- **The admin dashboard requires a Supabase login** and membership in the `admins` table, checked by the database on every request (RLS policies and the `admin_*` functions both call `is_admin()`).
- **No secret keys in the website.** The site uses only the public publishable/anon key, which can do nothing beyond what the rules above allow.
- Pages are marked `noindex` so search engines skip them, and links use `#k=` so the code is not sent to GitHub’s servers in requests.

## What was tested

Before delivery, the real `schema.sql` was run against Postgres 16 with Supabase’s roles and default permissions recreated, and the actual pages were driven in a headless browser at iPhone size through a stand-in for the Supabase API:

- `tests/security_tests.sql`: anonymous visitors cannot read or write any table or call admin functions; bad, guessed or old links are rejected; a signed-up non-admin sees nothing; Mom’s link never returns Dad’s answers and vice versa (even with a crafted request); the admin sees both; locking blocks parent saves on the server; replacing a link disables the old one.
- `tests/e2e_test.py` (41 checks): admin sign-in (wrong password and non-admin refused), link creation, Mom answers 5 questions, leaves, returns on a “new phone” and resumes at question 6, required answers enforced, exact confirmation text, no answers shown after submitting, Dad’s edit view shows only his answers, direct API probes from a parent’s browser refused, admin sees all 22 answers, edits one, locks/reopens, preview has 13 slides, the downloaded `.pptx` has 13 slides with every question and both answers in Mom-left/Dad-right order, and CSV/Excel/JSON exports contain the answers.

To re-run them yourself (optional; needs Postgres 16, Python 3 with `playwright` and `pyjwt`, and Node):

```bash
PGHOST=/tmp PGPORT=54329 PGUSER=postgres tests/run_sql_tests.sh
python3 tests/e2e_test.py /tmp/e2e-out
```

The `tests/` folder is not used by the live site.

## Repository structure

```
newlywed-game/
├── index.html            Parent survey (opened via private link)
├── admin.html            Admin dashboard
├── favicon.svg
├── .nojekyll             Tells GitHub Pages to serve files as-is
├── css/style.css         Cream / navy / gold / ruby design, mobile first
├── js/
│   ├── config.js         <- the only file you edit (Supabase URL + key)
│   ├── api.js            Minimal Supabase REST + Auth client (no dependencies)
│   ├── survey.js         Survey flow, autosave, resume, submit
│   ├── admin.js          Dashboard, links, lock, edit, exports
│   ├── slides.js         Slide layout, text fitting, PPTX + preview
│   └── export.js         CSV / Excel / JSON
├── vendor/
│   └── pptxgen.bundle.js PptxGenJS 4.0.1 (MIT), includes JSZip
├── supabase/
│   ├── schema.sql        Tables, RLS, functions, seed questions
│   └── make_admin.sql    Grants your login admin access
└── tests/                Security + end-to-end tests (not deployed use)
```

## Troubleshooting

- **“This site has not been connected to its database yet”**: `js/config.js` still has placeholder values, or GitHub Pages hasn’t picked up the change yet (wait a minute and refresh).
- **Admin sign-in says the account is not an administrator**: run `make_admin.sql` with the exact email you created in Supabase Auth.
- **“This link isn’t working”**: the link was cut off when pasted, or a newer link was created. Create a new link and resend.
- **Everything stopped loading after a quiet week**: the free Supabase project paused. Restore it from the Supabase dashboard.
- **Want to change a question’s wording?** Edit it in Supabase: **Table Editor** → `questions`. Do this before the parents start.
