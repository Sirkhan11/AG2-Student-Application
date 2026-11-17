import { defineEnvVars } from '@sveltejs/kit/env';

// The server's own settings. SvelteKit reads them from .env and .env.local (both git-ignored). They're
// private: only server code can import them (from $app/env/private), and the build fails if code that
// runs in the browser tries. See src/lib/server/blackboard/config.js for what each one does.
export const variables = defineEnvVars({
  BLACKBOARD_HOST: {
    description:
      'Where Blackboard is: "mock" for the app\'s pretend Blackboard (the default), or https://elp.northumbria.ac.uk once Northumbria IT has registered the app.',
    schema: (value) => value?.trim() || 'mock'
  },
  BLACKBOARD_APP_KEY: {
    description: "The app's key from Anthology's developer portal. Not needed for the mock.",
    schema: (value) => value?.trim() || ''
  },
  BLACKBOARD_APP_SECRET: {
    description: "The app's secret from Anthology's developer portal. Not needed for the mock.",
    schema: (value) => value?.trim() || ''
  },
  BLACKBOARD_COOKIE_KEY: {
    description:
      '32 random bytes in base64, for encrypting the Blackboard cookie. Make one with: node -e "console.log(require(\'node:crypto\').randomBytes(32).toString(\'base64\'))"',
    schema: (value) => value?.trim() || ''
  }
});
