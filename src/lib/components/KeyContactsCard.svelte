<script>
  import { KEY_CONTACTS } from '#lib/checklist/how-to.js';

  /**
   * The key contacts, in the check-in chat while going through the checklist ("Save your key
   * contacts"): Campus Security, Ask4Help, 999 and 101, each a number to call or save, from the pages
   * in how-to.js. Nothing here is sent anywhere.
   */
</script>

<div class="contacts-card" role="group" aria-label="Key contacts">
  <p class="label">Key contacts to save in your phone</p>
  <ul>
    {#each KEY_CONTACTS as contact (contact.tel)}
      <li>
        <span>{contact.name}</span>
        <a href={contact.tel} aria-label={`Call ${contact.name} on ${contact.phone}`}>{contact.phone}</a>
        {#if contact.note}
          <span class="muted small">{contact.note}</span>
        {/if}
      </li>
    {/each}
  </ul>
</div>

<style>
  .contacts-card {
    padding: 12px;
    border: 1px solid var(--border);
    border-radius: 14px;
    background: #fff;
    color: #172630;
  }

  .label {
    margin: 0 0 8px;
    font-weight: bold;
  }

  ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  li {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  li + li {
    margin-top: 10px;
  }

  a {
    font-weight: bold;
    font-size: 18px;
  }

  .small {
    font-size: 14px;
  }
</style>
