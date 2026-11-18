<script>
  /**
   * AG2's mascot: a friendly round character in a graduation cap, drawn for the app. It waves on
   * Home, cheers when there's something to celebrate, and sits calmly elsewhere. It floats gently
   * when motion is allowed, and keeps still with Reduce Motion on. Decorative: screen readers skip it.
   * @type {{ mood?: 'wave' | 'cheer' | 'calm', size?: number }}
   */
  let { mood = 'calm', size = 96 } = $props();
  const id = $props.id();
</script>

<svg class="mascot {mood}" width={size} height={size} viewBox="0 0 120 120" aria-hidden="true" focusable="false">
  <defs>
    <linearGradient id={`${id}-body`} x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#9b70ff" />
      <stop offset="1" stop-color="#6b3cf5" />
    </linearGradient>
  </defs>
  <ellipse class="shadow" cx="60" cy="111" rx="28" ry="5" fill="#1e1638" opacity="0.12" />
  <g class="float">
    {#if mood === 'cheer'}
      <path class="arm left" d="M26 60c-9-5-13-14-11-22" stroke={`url(#${id}-body)`} stroke-width="9" stroke-linecap="round" fill="none" />
    {/if}
    {#if mood === 'wave' || mood === 'cheer'}
      <path class="arm right" d="M94 60c9-5 13-14 11-22" stroke={`url(#${id}-body)`} stroke-width="9" stroke-linecap="round" fill="none" />
    {/if}
    <path d="M60 22c24 0 41 17 41 41s-14 41-41 41-41-16-41-41 17-41 41-41z" fill={`url(#${id}-body)`} />
    <ellipse cx="60" cy="78" rx="22" ry="16" fill="#ffffff" opacity="0.13" />
    <g class="eyes">
      <ellipse cx="47" cy="59" rx="7" ry="8.5" fill="#ffffff" />
      <ellipse cx="73" cy="59" rx="7" ry="8.5" fill="#ffffff" />
      <circle cx="48.5" cy="61" r="4.2" fill="#1e1638" />
      <circle cx="74.5" cy="61" r="4.2" fill="#1e1638" />
      <circle cx="50" cy="59.2" r="1.5" fill="#ffffff" />
      <circle cx="76" cy="59.2" r="1.5" fill="#ffffff" />
    </g>
    <ellipse cx="38" cy="73" rx="6" ry="3.5" fill="#ff6a4d" opacity="0.45" />
    <ellipse cx="82" cy="73" rx="6" ry="3.5" fill="#ff6a4d" opacity="0.45" />
    {#if mood === 'cheer'}
      <path d="M50 73c3 8 17 8 20 0z" fill="#1e1638" />
      <path d="M54 77c2 2 10 2 12 0" stroke="#ff6a4d" stroke-width="2.5" stroke-linecap="round" fill="none" />
    {:else}
      <path d="M52 74c4 5 12 5 16 0" stroke="#1e1638" stroke-width="3" stroke-linecap="round" fill="none" />
    {/if}
    <path d="M60 10l27 10-27 10-27-10z" fill="#1e1638" />
    <path d="M44 24v7c0 5 32 5 32 0v-7l-16 6z" fill="#1e1638" />
    <path d="M85 21v13" stroke="#ffc93c" stroke-width="2.5" stroke-linecap="round" />
    <circle cx="85" cy="35.5" r="3.2" fill="#ffc93c" />
  </g>
</svg>

<style>
  .mascot {
    display: block;
    overflow: visible;
  }

  .arm {
    transform-box: fill-box;
  }

  .arm.right {
    transform-origin: 0% 100%;
  }

  .arm.left {
    transform-origin: 100% 100%;
  }

  @media (prefers-reduced-motion: no-preference) {
    .float {
      animation: float 3.2s ease-in-out infinite;
    }

    .shadow {
      transform-box: fill-box;
      transform-origin: center;
      animation: shadow 3.2s ease-in-out infinite;
    }

    .wave .arm.right {
      animation: wave 2.4s ease-in-out infinite;
    }

    .cheer .float {
      animation: hop 0.9s var(--ease-bounce) 3;
    }

    .cheer .arm {
      animation: wave 0.45s ease-in-out 6 alternate;
    }

    .eyes {
      transform-box: fill-box;
      transform-origin: center;
      animation: blink 5s ease-in-out infinite;
    }
  }

  @keyframes float {
    50% {
      transform: translateY(-4px);
    }
  }

  @keyframes shadow {
    50% {
      transform: scale(0.88);
      opacity: 0.08;
    }
  }

  @keyframes wave {
    0%,
    60%,
    100% {
      transform: rotate(0deg);
    }
    70% {
      transform: rotate(-18deg);
    }
    80% {
      transform: rotate(8deg);
    }
    90% {
      transform: rotate(-12deg);
    }
  }

  @keyframes hop {
    40% {
      transform: translateY(-14px);
    }
  }

  @keyframes blink {
    0%,
    94%,
    100% {
      transform: scaleY(1);
    }
    97% {
      transform: scaleY(0.1);
    }
  }
</style>
