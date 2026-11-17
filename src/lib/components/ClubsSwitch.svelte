<script>
  /**
   * Switches between NSU's societies and Northumbria Sport's clubs, at the top of both lists: two
   * links rather than a sixth tab, as the bottom bar already has five. Each list keeps its own address.
   * @type {{ current: 'societies' | 'sport' }}
   */
  let { current } = $props();
</script>

<nav class="switch" aria-label="Societies or sport clubs">
  <a href="/societies" class:active={current === 'societies'} aria-current={current === 'societies' ? 'page' : undefined}>Societies</a>
  <a href="/sport" class:active={current === 'sport'} aria-current={current === 'sport' ? 'page' : undefined}>Sport clubs</a>
</nav>

<style>
  .switch {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 4px;
    margin: 0 0 16px;
    padding: 4px;
    border-radius: 12px;
    background: #eaf2f8;
  }

  .switch a {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 44px;
    border-radius: 9px;
    font-weight: bold;
  }

  .switch a.active {
    background: #fff;
    box-shadow: 0 1px 3px #00000022;
    color: #172630;
  }
</style>
