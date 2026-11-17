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

> To deploy your app, you may need to install an [adapter](https://svelte.dev/docs/kit/adapters) for your target environment.

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
