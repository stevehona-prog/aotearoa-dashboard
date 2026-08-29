# Deploying Aotearoa Dashboard to GitHub Pages

This folder is a complete, ready-to-host static site: `index.html`, the PWA
manifest, a service worker, and the app icons. No build step, no
dependencies — GitHub Pages just needs to serve these files as-is. (The
`worker/` folder is a separate piece — a small Cloudflare Worker backend,
covered near the end of this doc — with its own `npm install`; it doesn't
affect how the static site itself deploys.)

## Colour scheme

The dashboard runs "Bottle Green Dusk" — a dark bottle-green ground with an
ochre accent (replacing the earlier terracotta/cream palette) and emerald
for live/connected states. One rule carries through every panel: **any card
still showing sample or unconnected data gets a muted terracotta
background** instead of the standard dark-green card surface — News,
Sports, Real Estate, Product Research, and the three sample widgets are
always terracotta; Email and Calendar switch from terracotta to green
automatically once you connect them (both the panel and its "Today's
Highlights" tile). It's a from-scratch colour pass — if you spot a badge or
accent that still reads oddly on the dark ground, flag it and it's a quick
fix, not a redesign.

## First-time setup (all through github.com, no command line needed)

1. Go to github.com and create a new repository — for example
   `aotearoa-dashboard`. Public is fine (Pages requires a public repo unless
   you're on a paid GitHub plan that supports private Pages).
2. On the repository page, choose **Add file → Upload files**, then drag in
   every file from this project (`index.html`, `manifest.webmanifest`,
   `service-worker.js`, `DEPLOY.md`, and the four `.png` icon files).
   Commit the upload to the `main` branch.
3. Go to **Settings → Pages** in that repository. Under "Build and
   deployment", set Source to **Deploy from a branch**, branch **main**,
   folder **/ (root)**, then Save.
4. Wait about a minute, then refresh that Pages settings screen — GitHub
   will show your live URL, something like
   `https://<your-username>.github.io/aotearoa-dashboard/`.

## Installing it on your iPhone

1. Open that URL in **Safari** specifically (installation only works through
   Safari, not Chrome or any other iOS browser).
2. Tap the Share icon, then **Add to Home Screen**.
3. You'll get an app icon using the koru mark, and it opens full-screen with
   no browser address bar.

Once installed, dragging down from the top refreshes the page and re-pulls
live Email/Calendar data, same as pull-to-refresh in a regular Safari tab —
iOS doesn't provide that gesture natively for installed home-screen apps,
so it's implemented by hand in `index.html` and only activates when running
standalone (installed), so it never doubles up with Safari's own gesture in
a normal browser tab.

## Making changes later

Come back to me with what you'd like changed, and I'll edit the files and
hand you the updated versions. To push an update yourself: open the changed
file in the GitHub repo (the pencil/edit icon, or Upload files again to
overwrite), commit to `main`, and GitHub Pages redeploys automatically
within about a minute — no settings to touch again.

The page checks the network first before falling back to its offline copy,
so a change you deploy shows up the next time the page loads, even though
it's installed as an app. If you ever *do* see a stale version on your
phone after an update (rare, but possible if it was offline at the moment
you deployed), force-quit the app and reopen it, or bump `CACHE_VERSION` at
the top of `service-worker.js` — that guarantees the old cache is thrown
away.

## What's live vs. sample right now

The Email panel connects to your real Gmail inbox, the Calendar panel to
your real Google Calendar, the Real Estate panel reads real listings out
of your realestate.com.au saved-search alert emails, and the Sports panel
shows a digest a Cloudflare Worker Cron job refreshes twice a day via
Claude and web search (see below for all four). Every other panel — news,
product research, widgets — is realistic sample content, laid out exactly
where live data would go once those sources are wired up. That's the next
phase of work, and it needs a small backend (to hold API keys, refresh
data on a schedule, and — if you want settings or added widgets to follow
you across devices — a place to store your account's preferences). This
static site is the front end that phase will plug into.

## Real Estate panel: realestate.com.au via email alerts

realestate.com.au has no public API for consumer accounts, and their
Terms of Use explicitly prohibit scraping — so this doesn't talk to
realestate.com.au at all. It reads the saved-search alert emails
realestate.com.au already sends to your Gmail (`from:realestate.com.au`),
using the exact same Gmail connection Email/Calendar use. There's no new
Connect button, no new OAuth scope: this panel just listens for the same
sign-in and goes live automatically once you've connected Gmail via
either of the other panels.

**You still manage the saved search itself on realestate.com.au directly**
— this panel can't create, edit, or delete it, since there's no legitimate
way to write back to their site. Make sure email alerts are turned on for
your saved search there; if they're off, there's nothing for this panel
to read.

How it works: it searches your inbox for realestate.com.au's alert emails,
and each listing inside one sits between HTML comment markers
(`<!-- Start Listing... -->` / `<!-- End Listing... -->`) that REA's own
template uses — reliable even when one email bundles several listings.
The canonical listing URL is pulled from an Outlook-only fallback comment
inside each block, which — unlike the visible "View Property" button —
links straight to `realestate.com.au`, not through a click-tracking
redirect, so tapping it can open the real estate.com.au app if you have
it installed rather than only ever landing in a browser. Listings are
deduped by that URL (in case the same property shows up in more than one
alert) and capped at the 10 most recent unique ones, browsable with the
left/right arrows on the single-listing card. Bed/bath/car count and land
size show when REA's email includes them (verified against both a house
and a vacant-land listing — land listings just don't have bed/bath data
to show, which isn't a gap, there's nothing there).

The Gmail search is scoped to `subject:"saved search"` rather than just
`from:realestate.com.au`, since the latter also pulls in market reports,
"properties like X" nudges, and unrelated finance content that never
contain an actual listing.

## Connecting Gmail and Google Calendar

Both panels talk to Google directly from the browser — no backend required
— using Google's OAuth sign-in, and share a single sign-in: click **either**
Connect Gmail or Connect Calendar and one Google consent screen covers
both panels at once (plus contact search) — there's no second prompt.
One-time setup, all in [Google Cloud Console](https://console.cloud.google.com/):

1. Create a project (or pick an existing one).
2. **APIs & Services → Library** — search for and enable the **Gmail
   API**, the **Google Calendar API**, and the **People API** (the last one
   powers contact search when forwarding an email).
3. **APIs & Services → OAuth consent screen** — set it up as **External**,
   fill in the required fields. While it's in "Testing" status, add your
   own Gmail address under **Test users** (only test users can sign in
   until you publish it — that's fine for personal use).
4. **APIs & Services → Credentials → Create Credentials → OAuth client
   ID** — Application type **Web application**. Under **Authorized
   JavaScript origins**, add your GitHub Pages URL exactly, e.g.
   `https://<your-username>.github.io` (no trailing slash, no path). Add
   `http://localhost:8000` too if you want to test locally by running
   `python -m http.server` in this folder. Under **Authorized redirect
   URIs**, add `https://<your-worker-subdomain>.workers.dev/auth/callback`
   — this is used by the Cloudflare Worker described below, for silent
   renewal; the in-browser flow itself still doesn't use a redirect URI.
5. Copy the generated Client ID (ends in `.apps.googleusercontent.com`).
6. Open `index.html`, find `GOOGLE_CLIENT_ID` near the bottom (search for
   `REPLACE_WITH_YOUR_CLIENT_ID`), and paste your Client ID in — it covers
   both panels.
7. Deploy the change. On the live page, click **either** Connect Gmail or
   Connect Calendar — one sign-in, and both panels populate:
   - Email shows your 5 most recent inbox messages with a "Live" badge,
     reply/forward icons, and a circle icon to toggle read/unread.
   - Calendar shows your next 5 upcoming events. Type into "Quick add an
     event…" (e.g. "Dinner with Sarah tomorrow 7pm") and hit the + button
     or Enter — Google parses the text into a real event on your calendar
     and the list refreshes.
   - The Email and Calendar tiles up in **Today's Highlights** update too
     — Email shows unread count in the last 2 days and how many unread
     messages from the last 3 months look like renewals (subject contains
     "renewal", "subscription", "license"/"licence", etc.), Calendar shows
     your next upcoming event. Both tiles are clickable and jump straight
     down to their panel.

The Client ID isn't a secret (it's fine to be in the page source — Google
doesn't accept requests from it unless they come from an authorized
origin). The access token itself lives only in that browser tab's
`sessionStorage` and expires after about an hour — on its own, that would
mean reauthenticating constantly. The Cloudflare Worker below is what
turns that into roughly a weekly prompt instead.

The one sign-in requests every scope both panels need together:
`gmail.modify` (inbox + toggle read/unread), `gmail.send`
(reply/forward), `contacts.readonly` (contact search when forwarding),
and `calendar.events` (upcoming events + creating new ones). If a future
change adds another capability, the combined scope list changes and the
cached session only has the old scopes — click either Connect button
again once to re-consent to the current set.

Contact search in the Forward "To" field starts suggesting matches after
2 characters, searching both name and email against your Google Contacts
(not Gmail's auto-collected "Other contacts" — just people you've actually
saved). It can take a few seconds after first connecting for Google's
contacts search index to warm up; if suggestions don't appear immediately
after a fresh Connect Gmail, try again a moment later.

## Silent renewal via a Cloudflare Worker

Google only issues a long-lived **refresh token** to a "confidential"
client — one that can keep a secret safe on a server. The browser-only
flow above can never get one, so left on its own it needs a full popup
reauth every ~hour. A small Cloudflare Worker closes that gap: it holds a
real refresh token server-side and lets the dashboard silently mint fresh
access tokens on request, no popup, until the refresh token itself expires
— which for a Google app in **Testing** status (this one, deliberately —
see below) is capped at about 7 days. So instead of hourly, reauth becomes
roughly a once-a-week, one-click affair.

**Why stay in Testing status instead of publishing/verifying the app**:
the Gmail scopes used here (`gmail.modify`, `gmail.send`) are classified
as *restricted*, and moving to Production requires Google's formal
verification plus a CASA security assessment — a process built for apps
with real external user bases, not a personal single-user dashboard. This
dashboard is already effectively private at the Google layer regardless of
GitHub Pages being public: only the Test users you've explicitly added
(just yourself) can ever complete the consent screen.

This repo's Worker is already deployed at
`https://aotearoa-dashboard-auth.stevehona.workers.dev`. To set one up
from scratch (e.g. if you fork this or need to redeploy):

1. `cd worker`, then `npm install` (installs `wrangler`, Cloudflare's CLI,
   as a local dev dependency — no global install needed).
2. `npx wrangler login` — opens a browser to authenticate with your
   Cloudflare account (free tier is more than enough for this).
3. `npx wrangler kv namespace create AUTH_KV` — creates the KV store that
   holds the refresh token. Paste the returned `id` into `wrangler.toml`'s
   `kv_namespaces` entry.
4. First time only: if your Cloudflare account has no `workers.dev`
   subdomain yet, `wrangler deploy` will tell you to register one first
   (Cloudflare dashboard → Workers & Pages → Create application — any
   starter Worker triggers the one-time subdomain picker; you can delete
   that placeholder afterward).
5. `npx wrangler deploy` from `worker/` — note the resulting
   `*.workers.dev` URL.
6. In Google Cloud Console, on the same OAuth client used above, add
   `<that-url>/auth/callback` as an Authorized redirect URI (see step 4 in
   the section above), and copy the Client Secret from the same page —
   every "Web application" type client gets one automatically, even though
   the plain browser flow above never uses it.
7. `npx wrangler secret put GOOGLE_CLIENT_SECRET` from `worker/` — pastes
   the secret in encrypted, never touches `wrangler.toml` or git.
8. In `index.html`, set `WORKER_BASE_URL` (next to `GOOGLE_CLIENT_ID`) to
   your Worker's URL. Leaving it blank falls back to the old popup-only
   flow with no silent renewal — a safety net if the Worker is ever down.

Once connected, the flow is: clicking Connect redirects through
`/auth/start` → Google's consent screen → the Worker's `/auth/callback`,
which hands the dashboard a fresh access token directly in the redirect
(and stores a long-lived credential for this browser in `localStorage`).
On later visits, if the cached hourly token has expired, the dashboard
silently calls the Worker's `/token` endpoint before ever showing a
Connect button — most of the time, panels just populate with no prompt at
all. Only once the underlying refresh token itself expires (~weekly) does
it fall back to one visible Connect click.

The Worker's `/token` endpoint never exposes the refresh token itself, and
is protected by a separate bearer credential unique to this browser (not
your Google credentials) — even someone who found the Worker's URL
couldn't use it to access your Gmail without also having that credential,
and `/auth/start` itself is gated by Google's own Test-user list the same
way the in-browser flow already is.

## Sports panel: digest via Cloudflare Worker Cron

The Sports panel doesn't talk to any sports data API directly — there
isn't one clean, free source that covers all 12 tracked teams/athletes at
once (six rugby teams, the Black Caps, and five "NZ Abroad" categories:
golf, athletics, basketball, motor racing, sailing). Instead, the same
Cloudflare Worker that handles Google auth also runs a **Cron Trigger**
twice a day that asks Claude (via the Anthropic API, with its web search
tool) to research that fixed roster, and writes one compact JSON digest
into the same KV store the auth flow uses. The dashboard just fetches that
digest on page load — no Google auth involved, since none of this is
private data.

Each cron run reads what's currently in KV before calling Claude, and asks
it to diff against that rather than blindly overwrite — so a fixture
naturally becomes a result once it's been played, and a "last checked"
timestamp per entity only moves when something actually changed, not
every time the cron happens to fire. If a run fails or Claude's response
doesn't parse into the expected shape, KV is left untouched — the panel
falls back to the same static sample content (and "Sample" badge) it
ships with, exactly like every other not-yet-connected panel on this
dashboard.

Setup, in addition to the Worker deploy steps above:

1. Get an API key from the [Anthropic Console](https://console.anthropic.com/).
   This only makes a couple of calls a day, so cost is not a concern for
   personal use, but it's worth a glance at current pricing for the model
   and web-search tool before relying on this long-term.
2. `npx wrangler secret put ANTHROPIC_API_KEY` from `worker/` — same
   encrypted-secret mechanism as `GOOGLE_CLIENT_SECRET`.
3. `npx wrangler secret put SPORTS_RUN_SECRET` — a random string (e.g.
   `openssl rand -hex 32`) that gates the manual-trigger endpoint below.
4. `npx wrangler deploy` — this also registers the Cron Trigger defined in
   `wrangler.toml`'s `[triggers]` block (twice daily, pinned to roughly
   6am/6pm NZ time — see the comment there for the UTC/DST tradeoff, and
   how to adjust it).
5. Don't want to wait up to 12 hours for the first cron firing? Trigger a
   run manually:
   ```bash
   curl -H "Authorization: Bearer <your SPORTS_RUN_SECRET>" \
     https://aotearoa-dashboard-auth.stevehona.workers.dev/sports/run
   ```
   Returns the freshly-written digest JSON, or an error if the run failed
   (KV is untouched either way until a run fully succeeds).
6. Reload the dashboard — the Sports panel and its Today's Highlights tile
   flip from "Sample" to "Live" automatically once `GET /sports` returns
   real data.
