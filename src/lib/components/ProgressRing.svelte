<script>
  import { onMount } from 'svelte';

  /**
   * How much of something is done, as a ring that fills on a spring when it appears (or at once with
   * Reduce Motion on), with the count in the middle. Read out as "2 of 6 done", unless decorative
   * (when the page already says it).
   * @type {{ done: number, total: number, size?: number, decorative?: boolean }}
   */
  let { done, total, size = 64, decorative = false } = $props();

  const stroke = 7;
  let radius = $derived((size - stroke) / 2);
  let length = $derived(2 * Math.PI * radius);
  let share = $derived(total > 0 ? Math.min(1, done / total) : 0);
  /** Empty until it's on screen, so it fills as it arrives. */
  let shown = $state(false);
  onMount(() => {
    requestAnimationFrame(() => (shown = true));
  });
</script>

<span
  class="ring"
  class:all={share === 1}
  role={decorative ? undefined : 'img'}
  aria-label={decorative ? undefined : `${done} of ${total} done`}
  aria-hidden={decorative ? 'true' : undefined}
  style:width={`${size}px`}
  style:height={`${size}px`}
  style:--count-size={`${Math.round(size * 0.3)}px`}
>
  <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" focusable="false">
    <circle class="track" cx={size / 2} cy={size / 2} r={radius} stroke-width={stroke} fill="none" />
    <circle
      class="fill"
      cx={size / 2}
      cy={size / 2}
      r={radius}
      stroke-width={stroke}
      fill="none"
      stroke-linecap="round"
      stroke-dasharray={length}
      stroke-dashoffset={shown ? length * (1 - share) : length}
    />
  </svg>
  <span class="count" aria-hidden="true">{done}<small>/{total}</small></span>
</span>

<style>
  .ring {
    position: relative;
    display: inline-grid;
    place-items: center;
    flex: none;
  }

  svg {
    position: absolute;
    inset: 0;
    transform: rotate(-90deg);
  }

  .track {
    stroke: var(--violet-soft);
  }

  .fill {
    stroke: var(--violet);
    transition: stroke-dashoffset 900ms var(--ease-spring);
  }

  .all .fill {
    stroke: var(--mint);
  }

  .count {
    font-family: var(--font-display);
    font-weight: 800;
    font-size: var(--count-size, 19px);
    color: var(--ink);
  }

  small {
    font-size: 12px;
    color: var(--ink-3);
  }

  @media (prefers-reduced-motion: reduce) {
    .fill {
      transition: none;
    }
  }
</style>
