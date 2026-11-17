<script>
  import '../app.css';
  import { onNavigate } from '$app/navigation';
  import { chatShown, opensChatFromHome } from '#lib/page-transitions.js';

  let { children } = $props();

  // Opening the chat from Home slides the chat down over Home (see page-transitions.js and app.css),
  // where the browser has View Transitions and the phone isn't set to reduce motion.
  onNavigate((navigation) => {
    if (!opensChatFromHome(navigation.from?.url.pathname, navigation.to?.url.pathname)) return;
    if (!document.startViewTransition || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const root = document.documentElement;
    return new Promise((resolve) => {
      root.dataset.pageTransition = 'chat-open';
      const transition = document.startViewTransition(async () => {
        resolve();
        await navigation.complete;
        await chatShown();
      });
      transition.finished.finally(() => delete root.dataset.pageTransition);
    });
  });
</script>

{@render children()}
