<script>
  import { mailtoHref } from '#lib/matching/mentor-contact.js';

  /**
   * How a matched student gets in touch with their mentor, after "Getting in touch:" on the mentor's
   * cards (Your mentor, Home and the chat's): the email address the mentor chose to share, as a link
   * that opens their email app, or the coordinator introducing them. Each card loads the contact
   * itself (loadMentorContact in mentor-contact.js), so Gemini never sees it.
   * @type {{ contact: import('#lib/matching/mentor-contact.js').MentorContact | null }}
   */
  let { contact } = $props();
</script>

{#if contact}email <a class="address" href={mailtoHref(contact.email)}>{contact.email}</a>.{:else}your coordinator will introduce you.{/if}

<style>
  /* A long address wraps rather than pushing the card wider than a phone. */
  .address {
    overflow-wrap: anywhere;
  }
</style>
