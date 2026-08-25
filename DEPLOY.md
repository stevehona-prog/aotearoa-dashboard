# Deploying Aotearoa Dashboard to GitHub Pages

This folder is a complete, ready-to-host static site: `index.html`, the PWA
manifest, a service worker, and the app icons. No build step, no
dependencies — GitHub Pages just needs to serve these files as-is.

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

The Email panel can connect to your real Gmail inbox, and the Calendar
panel can connect to your real Google Calendar (see below for both). Every
other panel — news, sports, real estate, product research, widgets — is
realistic sample content, laid out exactly where live data would go once
those sources are wired up. That's the next phase of work, and it needs a
small backend (to hold API keys, refresh data on a schedule, and — if you
want settings or added widgets to follow you across devices — a place to
store your account's preferences). This static site is the front end that
phase will plug into.

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
   `python -m http.server` in this folder. Leave Authorized redirect URIs
   empty — this flow doesn't use one.
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
origin). No client secret or refresh token is ever used or stored; the
single shared access token lives only in that browser tab's
`sessionStorage` and expires after about an hour, after which clicking
either panel's Connect button again re-authorizes both.

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
