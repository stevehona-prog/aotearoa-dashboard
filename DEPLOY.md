# Deploying Aotearoa Dashboard to GitHub Pages

This folder is a complete, ready-to-host static site: `index.html`, the PWA
manifest, a service worker, and the app icons. No build step, no
dependencies — GitHub Pages just needs to serve these files as-is.

## First-time setup (all through github.com, no command line needed)

1. Go to github.com and create a new repository — for example
   `aotearoa-dashboard`. Public is fine (Pages requires a public repo unless
   you're on a paid GitHub plan that supports private Pages).
2. On the repository page, choose **Add file → Upload files**, then drag in
   every file and folder from this project (`index.html`,
   `manifest.webmanifest`, `service-worker.js`, `DEPLOY.md`, and the whole
   `icons/` folder). Commit the upload to the `main` branch.
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

The Calendar panel shows real data (from a connected Google Calendar), and
the Email panel can connect to your real Gmail inbox (see below). Every
other panel — news, sports, real estate, product research, widgets — is
realistic sample content, laid out exactly where live data would go once
those sources are wired up. That's the next phase of work, and it needs a
small backend (to hold API keys, refresh data on a schedule, and — if you
want settings or added widgets to follow you across devices — a place to
store your account's preferences). This static site is the front end that
phase will plug into.

## Connecting Gmail

The Email panel talks to Gmail directly from the browser — no backend
required — using Google's OAuth sign-in. One-time setup, all in [Google
Cloud Console](https://console.cloud.google.com/):

1. Create a project (or pick an existing one).
2. **APIs & Services → Library** — search for "Gmail API" and enable it.
3. **APIs & Services → OAuth consent screen** — set it up as **External**,
   fill in the required fields. While it's in "Testing" status, add your
   own Gmail address under **Test users** (only test users can sign in
   until you publish it — that's fine for personal use).
4. **APIs & Services → Credentials → Create Credentials → OAuth client
   ID** — Application type **Web application**. Under **Authorized
   JavaScript origins**, add your GitHub Pages URL exactly, e.g.
   `https://<your-username>.github.io` (no trailing slash, no path). Add
   `http://localhost:8000` too if you want to test locally by running
   `python -m http.server` in this folder.
5. Copy the generated Client ID (ends in `.apps.googleusercontent.com`).
6. Open `index.html`, find `GMAIL_CLIENT_ID` near the bottom (search for
   `REPLACE_WITH_YOUR_CLIENT_ID`), and paste your Client ID in.
7. Deploy the change. On the live page, click **Connect Gmail** in the
   Email card and sign in — it'll show your 5 most recent inbox messages
   with a "Live" badge, and reply/forward icons on each row for replying
   or forwarding without leaving the dashboard.

The Client ID isn't a secret (it's fine to be in the page source — Google
doesn't accept requests from it unless they come from an authorized
origin). No client secret or refresh token is ever used or stored; the
access token lives only in that browser tab's `sessionStorage` and expires
after about an hour, after which clicking Connect Gmail again re-authorizes
it.

Sign-in requests both `gmail.readonly` (to show the inbox) and
`gmail.send` (to reply/forward) scopes together. If you connected before
reply/forward was added, click **Connect Gmail** again once — the old
cached session only has the read scope, so it won't send until you
re-consent to both.
