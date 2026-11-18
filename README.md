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

AG2 is live at https://ag2-dev-thomas.web.app, on Firebase Hosting, for Northumbria students only:
sign-up and log in take only `@northumbria.ac.uk` addresses, the address must be verified before the
app opens, and `firestore.rules` refuses every read and write from anyone else (apart from the three
test accounts the check scripts use).

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

```sh
npm run build:live    # a static site in build/, then scripts/check-live-build.mjs checks it
```

The live build leaves out the server routes (Blackboard, which says "coming soon" there until IT
register AG2, and the pretend Blackboard) and the team's pages (`/dev`, `/matching-demo`,
`/matching-test`). Dev (`npm run dev`) is unchanged.

The project's `.npmrc` is engine-strict and firebase-tools lists Node 20 to 24, so the Firebase
commands need `--engine-strict=false` on newer Node. The emulators need Java 21 or newer.

```sh
# Preview build/ as Hosting serves it (http://127.0.0.1:5005), then check it in Chrome
npx --engine-strict=false firebase-tools emulators:start --only hosting --project demo-ag2
node --env-file=.env scripts/check-live-site.mjs

# Check the rules and the sign-up flow in the emulators (nothing real is touched)
npx --engine-strict=false firebase-tools emulators:exec --only auth,firestore --project demo-ag2 "node scripts/check-uni-rules.mjs"

# Deploy the site and the rules together, so they always match
npx --engine-strict=false firebase-tools login
npx --engine-strict=false firebase-tools deploy --only hosting,firestore:rules --project ag2-dev-thomas
node --env-file=.env scripts/check-live-site.mjs --base https://ag2-dev-thomas.web.app
```

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
