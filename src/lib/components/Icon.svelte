<script>
  /**
   * AG2's icons: simple line drawings on a 24-point grid, drawn for the app (no icon library), in
   * the colour of the text around them. Decorative unless given a label.
   * @type {{ name: keyof typeof PATHS, size?: number, label?: string, stroke?: number }}
   */
  let { name, size = 24, label = '', stroke = 2.2 } = $props();
</script>

<script module>
  /** Each icon's drawing: SVG path data, several paths split by "|". */
  export const PATHS = {
    home: 'M4 10.5 12 4l8 6.5V19a1.5 1.5 0 0 1-1.5 1.5H15v-5.5h-6v5.5H5.5A1.5 1.5 0 0 1 4 19z',
    checklist: 'M9 11.5l2.2 2.2L15.5 9|M6.5 4h11A2.5 2.5 0 0 1 20 6.5v11a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 17.5v-11A2.5 2.5 0 0 1 6.5 4z',
    chat: 'M5 5.5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-6.5L8 21v-3.5H5a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2z|M8 11.5h.01M12 11.5h.01M16 11.5h.01',
    mentor: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z|M2.5 20c.7-3.4 3.3-5.5 6.5-5.5s5.8 2.1 6.5 5.5|M16 4.3a3.5 3.5 0 0 1 0 6.4|M18.5 14.8c1.6.9 2.7 2.6 3 5.2',
    more: 'M5 12h.01M12 12h.01M19 12h.01',
    sparkle: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z|M19 17l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z',
    check: 'M5 12.5l4.5 4.5L19 7.5',
    arrow: 'M5 12h14|M13 6l6 6-6 6',
    back: 'M19 12H5|M11 18l-6-6 6-6',
    heart: 'M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.4a4.3 4.3 0 0 1 7.5 2.4C19.5 15.4 12 20 12 20z',
    search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z|M20 20l-3.9-3.9',
    pin: 'M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z|M12 12.3a2.3 2.3 0 1 0 0-4.6 2.3 2.3 0 0 0 0 4.6z',
    phone: 'M7.5 3.5h2L11 8l-2 1.5a10 10 0 0 0 5.5 5.5L16 13l4.5 1.5v2A2.5 2.5 0 0 1 18 19C10 19 5 14 5 6a2.5 2.5 0 0 1 2.5-2.5z',
    calendar: 'M6 5.5h12A2 2 0 0 1 20 7.5v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-11a2 2 0 0 1 2-2z|M4 10h16|M8.5 3.5v4M15.5 3.5v4',
    star: 'M12 3.8l2.5 5.1 5.6.8-4 4 1 5.6-5.1-2.7-5.1 2.7 1-5.6-4-4 5.6-.8z',
    help: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z|M9.6 9.3a2.5 2.5 0 0 1 4.9.7c0 1.7-2.5 2.2-2.5 3.8|M12 16.8h.01',
    book: 'M5 4.5h5.5A2.5 2.5 0 0 1 13 7v13a2 2 0 0 0-2-2H5z|M19 4.5h-3.5A2.5 2.5 0 0 0 13 7v13a2 2 0 0 1 2-2h4z',
    shield: 'M12 3l7 3v5.5c0 4.4-3 8-7 9.5-4-1.5-7-5.1-7-9.5V6z|M9 12l2 2 4-4',
    people: 'M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6z|M16.5 10a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z|M2.5 19c.6-3 2.8-5 5.5-5s4.9 2 5.5 5|M14.5 14.3c.6-.2 1.3-.3 2-.3 2.4 0 4.3 1.8 4.8 4.5',
    medical: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z|M12 8v8M8 12h8',
    ball: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z|M12 7.5l3.3 2.4-1.3 3.9h-4l-1.3-3.9z|M12 3v4.5M20.4 9.6l-5.1.3M17.5 19l-3.5-5.2M6.5 19l3.5-5.2M3.6 9.6l5.1.3',
    building: 'M4.5 20.5v-14l7.5-3 7.5 3v14|M3 20.5h18|M9 20.5v-4h6v4|M8.5 9h.01M12 9h.01M15.5 9h.01M8.5 12.5h.01M12 12.5h.01M15.5 12.5h.01',
    clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z|M12 7.5V12l3 2',
    lock: 'M7 10.5V8a5 5 0 0 1 10 0v2.5|M5.5 10.5h13v9.5h-13z',
    logout: 'M14 4.5h4a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-4|M9.5 16.5 5 12l4.5-4.5|M5 12h10',
    undo: 'M9 14 4 9l5-5|M4 9h10.5a5.5 5.5 0 0 1 0 11H11',
    send: 'M4 12 20 4l-4.5 16-3.5-6.5z|M12 13.5 20 4',
    edit: 'M4 20h4L19 9l-4-4L4 16z|M13.5 6.5l4 4',
    trash: 'M4.5 7h15|M9.5 7V4.5h5V7|M6.5 7l1 13h9l1-13',
    close: 'M6 6l12 12|M18 6 6 18',
    plus: 'M12 5v14|M5 12h14',
    external: 'M14 4h6v6|M20 4l-9 9|M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
    user: 'M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z|M4 21c.8-4 4-6.5 8-6.5s7.2 2.5 8 6.5',
    mail: 'M4 6h16v12H4z|M4 7l8 6 8-6',
    moon: 'M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z',
    music: 'M9 18V5.5l10-2V16|M9 18a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z|M19 16a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z'
  };
</script>

<svg
  class="icon"
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width={stroke}
  stroke-linecap="round"
  stroke-linejoin="round"
  role={label ? 'img' : undefined}
  aria-label={label || undefined}
  aria-hidden={label ? undefined : 'true'}
  focusable="false"
>
  {#each PATHS[name].split('|') as d (d)}
    <path {d} />
  {/each}
</svg>

<style>
  .icon {
    display: inline-block;
    flex: none;
    vertical-align: middle;
  }
</style>
