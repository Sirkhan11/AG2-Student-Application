# sv

Everything you need to build a Svelte project, powered by [`sv`](https://github.com/sveltejs/cli).

## Creating a project

If you're seeing this, you've probably already done this step. Congrats!

```sh
# create a new project
npx sv create my-app
```

To recreate this project with the same configuration:

```sh
# recreate this project
npx sv@1.2.0 create --template minimal --types ts --install npm ag2-app
```

## Adding features

Add features to your project with `sv add`:

```sh
npx sv add
```

For example, to add Tailwind CSS:

```sh
npx sv add tailwindcss
```

## Developing

Once you've created a project and installed dependencies with `npm install` (or `pnpm install` or `yarn`), start a development server:

```sh
npm run dev

# or start the server and open the app in a new browser tab
npm run dev -- --open
```

## Building

To create a production version of your app:

```sh
npm run build
```

You can preview the production build with `npm run preview`.

## The live site

AG2 is live at https://ag2-dev-thomas.web.app, on Firebase Hosting. With the access switch on (below),
it's for Northumbria students only: sign-up and log in take only `@northumbria.ac.uk` addresses, the
address must be verified before the app opens, and `firestore.rules` refuses every read and write from
anyone else (apart from the three test accounts the check scripts use). With it off, any verified
address can use it.

### The access switch: Northumbria only, or any email address

Northumbria's mail filter quarantines the verification emails (IT ticket INC0456681), so until IT allow
the sender no `@northumbria.ac.uk` address can finish signing up. For testing with the project group,
one switch in the Firebase console opens the app to any email address, with no deploy and no code
change:

- Firebase console, **Firestore Database**, collection `config`, document `access`, boolean field
  `uniOnly`. `false` opens the app to any verified address. `true`, any other value, no field or no
  document means Northumbria only: the default, so nothing needs setting up for the real release.
- The address still has to be verified, so people still prove it's theirs. `firestore.rules` read the
  same document (`anyVerifiedAddress`), and only for accounts that aren't Northumbria ones.
- With the switch off, the forms say "Email address" rather than "Northumbria email address", the
  check-your-inbox screen says "Check your inbox", and the sign-up page says "Testing: open to any
  email address". Flipping it back deletes nothing: accounts from elsewhere just see the
  Northumbria-only screen again until it's flipped off.
- Nobody can change the switch from the app (the rules let anyone read it and nobody write it). The
  code is in `src/lib/access.js`; `scripts/check-uni-rules.mjs` tests both positions in the emulator,
  `scripts/check-access-switch.mjs` tests what people see in the browser, and `check-live-site.mjs`
  expects whichever way the live switch is set.
- The app reads the switch with one plain request to Firestore's REST API (`readUniOnly`), not the
  Firestore SDK. App Check isn't enforced for Firestore on this project today; if it ever is, that
  request needs the App Check token in its `X-Firebase-AppCheck` header, or the switch will read as on
  for everyone.

```sh
npm run build:live    # a static site in build/, then scripts/check-live-build.mjs checks it
```

The live build leaves out the server routes (the full Blackboard connection, which the checklist
says is still to come until IT register AG2, and the pretend Blackboard) and the team's pages
(`/dev`, `/matching-demo`, `/matching-test`). Dev (`npm run dev`) is unchanged. Deadlines from a
student's own Blackboard calendar link are on the live site, through the app's one function (below).

The project's `.npmrc` is engine-strict and firebase-tools lists Node 20 to 24, so the Firebase
commands need `--engine-strict=false` on newer Node. The emulators need Java 21 or newer.

```sh
# Preview build/ as Hosting serves it (http://127.0.0.1:5005), then check it in Chrome
npx --engine-strict=false firebase-tools emulators:start --only hosting --project demo-ag2
node --env-file=.env scripts/check-live-site.mjs

# Check the rules and the sign-up flow in the emulators (nothing real is touched)
npx --engine-strict=false firebase-tools emulators:exec --only auth,firestore --project demo-ag2 "node scripts/check-uni-rules.mjs"

# Deploy the site and the rules together, so they always match (the function is deployed on its
# own: see "Deadlines from Blackboard's calendar link" below; a bare `deploy` would include it)
npx --engine-strict=false firebase-tools login
npx --engine-strict=false firebase-tools deploy --only hosting,firestore:rules --project ag2-dev-thomas
node --env-file=.env scripts/check-live-site.mjs --base https://ag2-dev-thomas.web.app
```

### Deadlines from Blackboard's calendar link (the app's one function)

Every student has a private link to their own Blackboard calendar (in Blackboard: Calendar, the cog,
the three dots, Share calendar, Copy). Pasted once on Your deadlines (`/deadlines`, reached from Home,
the checklist and More), the app shows what's due: the next few on Home and the checklist, and the full
list on the page, each with Add to calendar. Blackboard only lets its own pages read that link, so the
app's one Cloud Function, `readDeadlines` (`functions/index.js`), fetches it: the app sends the link in
the body of the call, the function fetches the calendar, hands back the titles and times (nothing
else), and keeps nothing: no Firestore write, nothing logged. The link lives in the student's browser
only (`localStorage`, key `ag2.deadlines.<uid>`, `src/lib/deadlines/store.js`), is forgotten with
"Forget this link" or on log out, and is never near Gemini. These are deadlines from the calendar and
nothing else (most don't say which module); the full Blackboard connection still waits for IT.

- **Who can call it:** the rules' own gate (`functions/shared/access-gate.js`): a signed-in account
  with a verified Northumbria address, or any verified address while the access switch is off, or a
  test account; and from the AG2 app (App Check, enforced as it is for Gemini). Anyone else is
  refused (unauthenticated or permission denied) before anything is fetched. In emulators mode the app
  sends a pretend App Check token, which the Functions emulator accepts (`src/lib/firebase/app-check.js`).
- **What it fetches:** only a link of exactly Blackboard's shape,
  `https://elp.northumbria.ac.uk/webapps/calendar/calendarFeed/<32 hex characters>/learn.ics`
  (`functions/shared/calendar-link.js`, used by the app too), over HTTPS, following no redirects, with
  an 8-second limit, up to 512 KB, and only if what comes back is a calendar
  (`functions/lib/read-deadlines.js`). In the emulator, and only there, it fetches the same path from
  the checks' pretend Blackboard instead (`functions/.env.demo-ag2`, read by the emulator for the demo
  project only).
- **Where it runs:** `europe-west2` (London, with Firestore), 256 MiB, one CPU, ten requests at a time
  and at most two instances (`setGlobalOptions` in `functions/index.js`), so a mistake or misuse can't
  run up a bill. Node 22.
- **What it costs:** Cloud Functions need the Blaze (pay as you go) plan. Firebase's pricing page
  (https://firebase.google.com/pricing, read on 18 November 2026) lists each month's no-cost amounts:
  2 million invocations, 400,000 GB-seconds, 200,000 CPU-seconds and 5 GB outbound, then $0.40 per
  million invocations and $0.12 per GB; Cloud Build 120 minutes a day (a deploy uses a few), then
  $0.003 a minute; 500 MB of container storage in Artifact Registry. A student's app reads the calendar
  at most every four hours (`REFRESH_AFTER_MS` in `src/lib/deadlines/read.js`), so 300 students are
  roughly 50,000 short calls a month: well inside the no-cost amounts. Set a budget alert on the project
  all the same.
- **Deploying it** (Thomas's yes first: the first deploy of a function switches on Google Cloud
  services on the project, Cloud Functions, Cloud Run, Cloud Build and Artifact Registry among them,
  and the CLI names each as it goes; when it asks about a clean-up policy for old container images,
  take it, or old images count towards the 500 MB):
  ```sh
  npm --prefix functions install
  npx --engine-strict=false firebase-tools deploy --only functions --project ag2-dev-thomas
  ```
  Until it's deployed, the page says "The deadlines service isn't switched on yet" when a link is
  pasted, and nothing else changes.
- **Checks:** `node scripts/check-deadlines.mjs` (offline: the link's shape and near-misses, the
  calendar reader, the function's read with a stand-in fetch, the gate, what's kept on the phone, the
  words, and that the chat can't reach any of it); in the emulators with the Functions emulator, the
  same script also calls the function (who it refuses, what it fetches, a pretend Blackboard that
  redirects, is slow, is wrong or is huge) and runs the app in Chrome (connect, see, forget, log out,
  and the link in no request but the function's):
  ```sh
  npm --prefix functions install
  npx --engine-strict=false firebase-tools emulators:exec --only auth,firestore,functions --project demo-ag2 "node scripts/check-deadlines.mjs"
  ```

### Mentors who share their email address (for the mentoring coordinator)

A mentor can let the students matched with them see their email address: a box at sign-up, off unless
they tick it, or Share it with them on Your mentor, where they can also stop. It's kept in Firestore as
`mentorContacts/{mentor's uid}`: their own login address (`email`) and when they agreed (`agreedAt`),
nothing else. Students see it on Home, Your mentor and the chat's mentor card, as a link to email them;
Gemini is never told it. Without it, those cards say the coordinator will introduce them.

- **Who can read it:** the mentor, and a student whose `matches/{student's uid}` names that mentor with
  status `matched`. So moving a student to someone else in the console (changing `mentorId`) takes the
  old mentor's address away from them at once, and shows the new mentor's, if they share one.
- **When you remove a mentor, remove this too.** Deleting `mentors/{uid}` hides the address from their
  students straight away (the rule only lets a student read it while the mentor's profile is there), but
  `mentorContacts/{uid}` itself stays until you delete it. Delete it as well, and move their students.
- **While the access switch is off,** "the students matched with you" means anyone with a verified email
  address who signs up and takes one of the mentor's places. Ask real mentors not to share their address
  until the switch is back to Northumbria only.
- Checked by `scripts/check-mentor-contact.mjs` (offline, the rules in the emulators, and the screens in
  Chrome).

## Refreshing the NHS GP and dentist lists

The GP and dentist finder (`/gp-finder`, and its cards in the chat) searches its own lists on the
phone, so "Use my location" never sends the location anywhere. They come from NHS England's
Organisation Data Service (Open Government Licence), placed with postcodes.io. For each, the North
East's practices are part of the page and the rest of England is a file in `static/` that's loaded only
for a search outside the North East (the same request for everyone). Each script writes only what
changed, stops without writing if anything looks wrong, and prints counts, never names or addresses:

```sh
node scripts/refresh-gp-practices.mjs [--reuse-contacts]   # GP surgeries: src/lib/gp/, static/gp/england.tsv
node scripts/refresh-dental-practices.mjs [--reuse-pages]  # NHS dentists: src/lib/dentists/, static/dentists/england.tsv
node scripts/check-gp-practices.mjs && node scripts/check-dental-practices.mjs
```

Both read each North East practice's page on the NHS website, about one every two seconds: for GPs,
their phone, email and website; for dentists, to keep only those whose NHS page exists, as each result
links to it (it says whether they're taking new NHS patients, which changes too often to copy).

## Refreshing the NSU data

The Societies pages use two copies of Northumbria Students' Union's society information:

- **The list** (`src/lib/societies/nsu-societies.json`): names, categories, campuses, links and pictures. It's public, so it's in the repo.
- **Each society's page** (Firestore, `societies/{nsuId}`): descriptions, social links, memberships and the Email Society address. That address is usually a committee member's own, and some descriptions name committee members, so this is personal data and never goes in the repo.

NSU agreed to the app showing this information, but their robots.txt asks bots not to crawl mynsu.co.uk. So a person refreshes it by hand, about once a term, until NSU agree in writing to anything automatic.

### From a laptop, about once a term

1. Collect. This takes about 8 minutes. The list of societies comes from the API NSU's own A to Z page uses (one request for every society's name, category, campus and picture); then each society's page is read, 2 to 3 seconds apart, for its description, social links and contact email, and NSU's products list for the memberships. That's about 165 requests in all:
   ```sh
   node scripts/collect-nsu-societies.mjs --pages ~/Downloads/nsu-refresh/nsu-society-pages.json
   ```
   The pages file has to be outside the repo; a path inside it is refused. Nothing is written if NSU's site refuses or challenges the script, if there are fewer than 140 societies, if fewer than 95% of the pages read as expected, or if the pages fail the import's checks. It prints what changed since the last list, never descriptions or emails.
2. Check the list with `git diff src/lib/societies/nsu-societies.json` and commit it on a branch for review. The list file only changes when the list does, so the Societies page says when it last changed. Societies no longer on NSU's list are named in the output: delete their `societies/{nsuId}` documents in the Firestore console by hand.
3. Import the pages with a short-lived key, as for the first import:
   - Make a key: Firebase console, Project settings, Service accounts, Generate new private key. Keep it outside the repo.
   - Dry run: `node --env-file=.env scripts/import-society-pages.mjs ~/Downloads/nsu-refresh/nsu-society-pages.json`
   - Write: `GOOGLE_APPLICATION_CREDENTIALS=<key file> node --env-file=.env scripts/import-society-pages.mjs ~/Downloads/nsu-refresh/nsu-society-pages.json --write`
   - Delete the key straight away: Google Cloud console, IAM & Admin, Service accounts, the firebase-adminsdk account, Keys. Then delete the key file.
4. Delete the pages file once it's imported.

### The GitHub workflow

`.github/workflows/refresh-nsu-societies.yml` collects the list and, if it changed, opens a pull request with it for a person to check. It makes only 2 or 3 requests (NSU's A to Z page and the society list from NSU's API) and never reads the society pages, so no personal data passes through it. It never imports anything into Firestore and holds no secrets or keys, so the import above stays a manual step. If the import is ever automated, it should use Workload Identity Federation limited to `main`, not a stored key.

The workflow only runs when someone starts it (Actions, Refresh NSU societies list, Run workflow). Its weekly schedule stays commented out until NSU agree in writing. To open pull requests, a repo admin needs to tick "Allow GitHub Actions to create and approve pull requests" in Settings, Actions, General.

### Checks

- `node scripts/check-collect-nsu.mjs`: the collect script's reading, repairs and safety checks, on made-up pages
- `node scripts/check-societies.mjs`: the list
- `node scripts/check-society-import.mjs`: the import's checks

## Refreshing the Northumbria Sport data

The Sport clubs pages use two copies of Northumbria Sport's club information, split the same way as the societies:

- **The list** (`src/lib/sport/sport-clubs.json`): each club's name, link and picture. It's public, so it's in the repo.
- **Each club's page** (Firestore, `sportClubs/{slug}`): about text, memberships and training times, social links, the booking link and the club contacts. The contacts are the names and emails of captains, presidents and coaches (some personal addresses), so this is personal data and never goes in the repo.

Northumbria Sport's robots.txt lets crawlers read the site (it only asks them to keep off PDFs), so the list refreshes itself every week. The club pages stay a manual step, because they hold personal data and importing them needs a key.

### What runs every week

`.github/workflows/refresh-sport-clubs.yml` runs on Mondays at 06:00 UTC (or by hand: Actions, Refresh Northumbria Sport clubs list, Run workflow). It reads /sports and each club's page, 2 to 3 seconds apart (39 requests, about 2 minutes). The club pages are read only for their pictures, as /sports has none: the rest of each page, contacts included, is dropped as soon as it's read. If the list changed, it opens or updates a pull request with it for a person to check. It never imports anything into Firestore and holds no secrets or keys. GitHub only runs the schedule from the default branch, so it starts once the workflow is on `main`. To open pull requests, a repo admin needs to tick "Allow GitHub Actions to create and approve pull requests" in Settings, Actions, General.

### What stays manual: the club pages, from a laptop

Do this when the weekly pull request shows a new club, or about once a term for changed contacts and times.

1. Collect, comparing with the pages file you imported last time if you still have it:
   ```sh
   node scripts/collect-sport-clubs.mjs --pages ~/Downloads/sport-refresh/sport-club-pages.json --compare ~/Downloads/sport-club-pages.json
   ```
   The pages file has to be outside the repo; a path inside it is refused. Nothing is written if the site refuses or challenges the script, if there are fewer than 30 clubs, if a club page doesn't read as expected, or if the pages fail the import's checks. It prints counts and which clubs changed (by slug, and for the pages only which parts), never names, emails or page text.
2. Check `git diff src/lib/sport/sport-clubs.json` if the list changed, and commit it on a branch for review.
3. Import the pages with a short-lived key, as for the society pages:
   - Dry run: `node --env-file=.env scripts/import-sport-club-pages.mjs ~/Downloads/sport-refresh/sport-club-pages.json`
   - Write: `GOOGLE_APPLICATION_CREDENTIALS=<key file> node --env-file=.env scripts/import-sport-club-pages.mjs ~/Downloads/sport-refresh/sport-club-pages.json --write`
   - With the key set, it names any club in Firestore that's no longer in the file: delete those documents in the Firestore console by hand.
   - Delete the key straight away, then the key file.
4. Delete the old pages file once the new one is imported.

### Checks

- `node scripts/check-collect-sport.mjs`: the collect script's reading and safety checks, on made-up pages
- `node scripts/check-sport-clubs.mjs`: the list (the weekly workflow runs it before opening a pull request)
- `node scripts/check-sport-club-import.mjs`: the import's checks
