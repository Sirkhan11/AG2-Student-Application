<script>
  /**
   * A little burst of confetti, for a moment worth celebrating: a task ticked, the checklist done, a
   * mentor found. It flies out from the middle of whatever holds it (position it there) and is gone
   * in about a second. Only transform and opacity move, so it stays smooth on a phone; with Reduce
   * Motion on, nothing is shown. Decorative: screen readers skip it.
   * delay: how long to wait first (in ms), say while a page change finishes.
   * @type {{ count?: number, spread?: number, delay?: number }}
   */
  let { count = 14, spread = 70, delay = 0 } = $props();

  const colours = ['var(--violet)', 'var(--coral)', 'var(--sun)', 'var(--mint)', 'var(--sky)'];
  /** Where each bit flies, worked out when it appears. */
  const bits = $derived(Array.from({ length: count }, (_, i) => {
    const angle = ((i / count) * 360 + Math.random() * 24) * (Math.PI / 180);
    const distance = spread * (0.55 + Math.random() * 0.6);
    return {
      x: Math.round(Math.cos(angle) * distance),
      y: Math.round(Math.sin(angle) * distance - spread * 0.25),
      turn: Math.round(Math.random() * 540 - 270),
      colour: colours[i % colours.length],
      shape: i % 3,
      delay: Math.round(Math.random() * 70)
    };
  }));
</script>

<span class="burst" aria-hidden="true">
  {#each bits as bit, i (i)}
    <i class={`s${bit.shape}`} style:--x={`${bit.x}px`} style:--y={`${bit.y}px`} style:--turn={`${bit.turn}deg`} style:--c={bit.colour} style:--d={`${bit.delay + delay}ms`}></i>
  {/each}
</span>

<style>
  .burst {
    position: absolute;
    left: 50%;
    top: 50%;
    width: 0;
    height: 0;
    pointer-events: none;
    z-index: 3;
  }

  i {
    position: absolute;
    left: -4px;
    top: -4px;
    width: 8px;
    height: 8px;
    background: var(--c);
    opacity: 0;
  }

  .s0 {
    border-radius: 50%;
  }

  .s1 {
    width: 5px;
    height: 11px;
    border-radius: 2px;
  }

  .s2 {
    clip-path: polygon(50% 0, 100% 100%, 0 100%);
  }

  @media (prefers-reduced-motion: no-preference) {
    i {
      animation: fly 950ms cubic-bezier(0.2, 0.7, 0.3, 1) var(--d) both;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .burst {
      display: none;
    }
  }

  @keyframes fly {
    0% {
      opacity: 1;
      transform: translate(0, 0) scale(0.3) rotate(0deg);
    }
    70% {
      opacity: 1;
    }
    100% {
      opacity: 0;
      transform: translate(var(--x), var(--y)) scale(1) rotate(var(--turn));
    }
  }
</style>
