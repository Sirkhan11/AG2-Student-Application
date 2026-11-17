<!-- The live site's Blackboard section, until IT registers AG2 with Blackboard and the app has a server
     to talk to it from. vite.config.ts uses this in place of BlackboardSection.svelte in the live build,
     so none of the Blackboard code (or the pretend Blackboard) is in the live site's files. -->
<section class="card blackboard" id="blackboard" aria-labelledby="blackboard-title">
  <h2 id="blackboard-title">Your modules on Blackboard</h2>
  <p>Coming soon: your modules, deadlines and announcements from Blackboard, here on your checklist.</p>
</section>

<style>
  .blackboard h2 {
    margin-top: 0;
  }
</style>
