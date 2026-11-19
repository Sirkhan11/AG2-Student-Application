<!-- The live site's Blackboard section, until IT registers AG2 with Blackboard and the app has a server
     to talk to it from. vite.config.ts uses this in place of BlackboardSection.svelte in the live build,
     so none of the Blackboard code (or the pretend Blackboard) is in the live site's files. Deadlines
     are the one thing already there, from the student's own calendar link (DeadlinesCard, just above). -->
<section class="card blackboard" id="blackboard" aria-labelledby="blackboard-title">
  <h2 id="blackboard-title">Your modules on Blackboard</h2>
  <p>Your deadlines are above, from your Blackboard calendar link. Your modules, announcements and new content from Blackboard are still to come here, if IT agree to connect AG2.</p>
</section>

<style>
  .blackboard h2 {
    margin-top: 0;
  }
</style>
