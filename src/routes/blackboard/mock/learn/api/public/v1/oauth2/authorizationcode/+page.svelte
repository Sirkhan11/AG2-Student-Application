<script>
  /** @type {import('./$types').PageProps} */
  let { data } = $props();
</script>

<svelte:head>
  <title>Pretend Blackboard</title>
</svelte:head>

<!-- The mock's stand-in for Blackboard's "Allow" screen. It's deliberately plain and labelled as
     pretend, and has no username or password boxes: the real sign-in happens on Northumbria's Blackboard. -->
<main class="page mock">
  <p class="badge">Pretend Blackboard, for testing</p>
  <h1>Allow AG2 to read your Blackboard?</h1>
  <p>
    On the real Blackboard you’d sign in with your university account first, on Northumbria’s own
    page. This pretend version skips that.
  </p>
  <p>AG2 is asking for: <strong>{data.scope === 'read offline' ? 'read only, and to stay connected' : data.scope}</strong></p>

  <form method="POST" action="?/allow">
    <fieldset>
      <legend>What should the pretend Blackboard do?</legend>
      {#each data.scenarios as scenario, i (scenario.id)}
        <label>
          <input type="radio" name="scenario" value={scenario.id} checked={i === 0} />
          {scenario.label}
        </label>
      {/each}
    </fieldset>
    <button class="primary-button" type="submit">Allow</button>
  </form>
  <form method="POST" action="?/deny">
    <button class="secondary-button" type="submit">Deny</button>
  </form>
</main>

<style>
  .badge {
    display: inline-block;
    padding: 4px 10px;
    border-radius: 12px;
    background: #fff3cd;
    color: #4d3800;
    font-weight: bold;
  }

  fieldset {
    margin: 12px 0;
    border: 1px solid var(--border);
    border-radius: 10px;
  }

  label {
    display: flex;
    gap: 8px;
    align-items: flex-start;
    padding: 6px 0;
  }

  form + form {
    margin-top: 8px;
  }
</style>
