import { resolve } from 'node:path';
import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, loadEnv } from 'vite';

// `vite dev` and `vite build` are as before. Vite's "live" mode is the live site for Firebase
// Hosting (npm run build:live, which runs scripts/build-live.mjs): a static site, every page served
// from index.html, built from a copy of src/routes without the server routes and the team's pages.
export default defineConfig(({ mode }) => {
  const live = mode === 'live';
  // The App Check debug token lets anything through App Check, so it must never reach the live
  // site. It belongs only in .env.development.local, which a build never reads; stop if it's
  // anywhere the live build does read (.env, .env.local, .env.live or the shell).
  if (live && loadEnv(mode, process.cwd(), 'VITE_APPCHECK_DEBUG_TOKEN').VITE_APPCHECK_DEBUG_TOKEN) {
    throw new Error('VITE_APPCHECK_DEBUG_TOKEN is set where the live build can read it. Keep it only in .env.development.local.');
  }
  return {
    plugins: [
      sveltekit({
        alias: {
          '$lib': 'src/lib'
        },
        ...(live
          ? {
              adapter: adapter({ pages: 'build', assets: 'build', fallback: 'index.html', strict: true }),
              files: { routes: 'src/routes-live' }
            }
          : {})
      })
    ],
    resolve: {
      // The live site has no Blackboard yet: its section says it's coming soon, and there's nothing
      // to disconnect at log out, so none of the Blackboard code goes live.
      alias: live
        ? [
            { find: '#lib/components/BlackboardSection.svelte', replacement: resolve('src/lib/components/BlackboardComingSoon.svelte') },
            { find: '#lib/blackboard/api.js', replacement: resolve('src/lib/blackboard/api-live.js') }
          ]
        : []
    }
  };
});
