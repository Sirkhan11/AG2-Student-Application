<script>
  import BackLink from '#lib/components/BackLink.svelte';

  // What AG2 keeps, where, what Gemini is told and what it never is, and how to delete it: only what
  // the code does (firestore.rules, the sign-up, checklist, matching and chat code, and the notes the
  // app already shows). "To confirm" marks what the code can't tell us, for the AG2 team to fill in.
  // Public, so it can be read before signing up (account-gate.js).
</script>

<main class="page privacy">
  <BackLink />
  <h1>Privacy</h1>
  <p class="lead">
    What AG2 keeps about you, where it’s kept, what Google’s Gemini AI is told and what it never is,
    and how to delete it. This describes what the app does today.
  </p>
  <p class="muted"><span class="tbc">To confirm</span> marks something the AG2 team still has to confirm.</p>

  <section class="card">
    <h2>Kept in your account</h2>
    <p>In Google’s Firebase database, which is in London (europe-west2):</p>
    <ul>
      <li><strong>What you gave when you signed up:</strong> your name, email address, course, interests, arrival date, whether you’re a home or international student, and whether you’d like a mentor.</li>
      <li><strong>Your checklist:</strong> its tasks, which ones you’ve ticked, and any you’ve added.</li>
      <li><strong>Things you asked the chat to remember:</strong> up to 10 short notes, with when you saved each.</li>
      <li>
        <strong>Your mentor match,</strong> once you’ve found one: your mentor’s chosen name, up to three
        reasons for the match, how often you’d like to meet and when you’re free.
      </li>
      <li>
        <strong>A short summary of your answers</strong> from finding a mentor (what you’re into, what you’d
        rather avoid and how you like to do things), for the chat. Your answers themselves are kept only if
        the mentoring coordinator needs to match you by hand.
      </li>
      <li><strong>A request for a different mentor,</strong> if you send one: the reason you chose and any details, until the coordinator has dealt with it.</li>
      <li>
        <strong>If you’re a mentor:</strong> privately, your name, course, answers, Gemini’s summary of them,
        how often you’d meet and when you’re free. Separately, the name you show students and your answers
        turned into numbers: once the coordinator has approved you, signed-in students’ apps download these to
        find matches, but the app only shows your name to a student who’s matched with you.
      </li>
    </ul>
    <p>
      Your login (your email address and password) is kept by Firebase Authentication, which stores the
      password in a form nobody can read back. <span class="tbc">To confirm</span> which country that’s in.
    </p>
  </section>

  <section class="card">
    <h2>Kept on your phone</h2>
    <ul>
      <li><strong>The chat:</strong> it stays in the open tab only and isn’t saved anywhere. It’s gone when you log out or close the tab.</li>
      <li><strong>Your sign-up details,</strong> until you’ve verified your email address. Then they’re saved to your account and removed from your phone (and they’re gone if you close the tab first).</li>
      <li><strong>That you’re logged in,</strong> as Firebase does, so you don’t have to log in every time.</li>
      <li><strong>The matching model:</strong> the part of matching that turns words into numbers runs on your phone. It’s downloaded once, from Hugging Face (with its code from jsDelivr), and your browser keeps it.</li>
      <li><strong>Your location,</strong> if you use “Use my location” in the GP finder: it’s used on your phone to sort the surgeries, and never saved or sent anywhere.</li>
    </ul>
  </section>

  <section class="card">
    <h2>What Google’s Gemini AI is told</h2>
    <p>AG2 uses Gemini, through Google’s Firebase AI Logic, for the check-in chat and to find your mentor.</p>
    <h3>In the check-in chat</h3>
    <ul>
      <li>Your first name, and the course, interests and arrival date you gave when you signed up, and whether you said you’re a home or international student (one word, so it gives you the right version of things like registering with a GP).</li>
      <li>Whether you have a mentor, why you were matched and how often you asked to meet.</li>
      <li>The short summary of your answers from finding a mentor.</li>
      <li>Your checklist progress: which of the standard tasks you’ve done, and how many of your own (not what they say).</li>
      <li>The things you asked it to remember.</li>
      <li>Your messages, with anything that looks like an email address, a UK mobile number or a full UK postcode blanked out first.</li>
    </ul>
    <p>You can see what it’s told on <a href="/about-you">What the chat knows about you</a>.</p>
    <h3>When you find a mentor</h3>
    <p>
      Your six answers, with anything that looks like an email address blanked out, so Gemini can pick out
      what you’re into, what you’d rather avoid and how you like to do things. Never your name or anything
      else about you. Mentors’ answers are summarised the same way when they sign up.
    </p>
    <h3>Never told</h3>
    <ul>
      <li>Your full name, your email address, or your mentor’s name.</li>
      <li>Your contact details, postcode or location.</li>
      <li>When you’re free to meet your mentor.</li>
      <li>Your reason for asking for a different mentor.</li>
    </ul>
    <p>
      Each request also carries your account’s sign-in token and the app’s App Check token, which Google’s
      Firebase service checks so only the AG2 app can use Gemini. They aren’t in what Gemini is given to read.
    </p>
    <p>
      Google doesn’t use the chat to improve its products, but keeps messages for a limited time, only to
      detect misuse, keep its services safe and secure, and meet legal requirements, and they may be stored or
      cached in any country
      (<a
        href="https://ai.google.dev/gemini-api/terms"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Gemini API terms (opens in a new tab)">Gemini API terms ↗</a>).
      So please leave names, contact details and anything you’d want kept private out of the chat.
    </p>
  </section>

  <section class="card">
    <h2>Other services</h2>
    <ul>
      <li><strong>Google Firebase</strong> runs the login, the database and the website.</li>
      <li><strong>Google reCAPTCHA</strong> checks in the background that requests come from the real app.</li>
      <li><strong>postcodes.io</strong> looks up a postcode or place you type into the GP finder. In the dentist finder, the postcode you type is only used to open NHS Find a dentist for it.</li>
      <li><strong>Hugging Face and jsDelivr</strong> supply the matching model and its code.</li>
      <li>Links to the NHS, the Students’ Union, Northumbria Sport and Northumbria University open their own sites, which have their own privacy notices.</li>
    </ul>
  </section>

  <section class="card">
    <h2>Who can see it</h2>
    <ul>
      <li><strong>You:</strong> everything in your account, through the app.</li>
      <li>
        <strong>Your mentor</strong> doesn’t see your answers, your checklist, the chat or a request for a
        different mentor. <span class="tbc">To confirm</span> what they’re told when the coordinator introduces you.
      </li>
      <li>
        <strong>The mentoring coordinator</strong> uses the Firebase console, which shows what’s kept in the
        database: they read requests for a different mentor, and your answers if they match you by hand.
        <span class="tbc">To confirm</span> who the coordinator is.
      </li>
      <li><strong>Other students</strong> never see anything of yours.</li>
      <li>Nothing you say in the chat is passed on to the university or your mentor.</li>
    </ul>
  </section>

  <section class="card">
    <h2>Deleting it</h2>
    <ul>
      <li><strong>Things the chat remembers:</strong> Delete, or Delete all, on <a href="/about-you">What the chat knows about you</a>.</li>
      <li><strong>Checklist tasks:</strong> open “How to” (or “Stuck?”) under the task on your checklist, then Delete this task.</li>
      <li><strong>A request for a different mentor:</strong> Cancel, on Your Mentor.</li>
      <li><strong>The chat:</strong> log out. It’s never saved.</li>
      <li><strong>On your phone:</strong> clear this site’s data in your browser’s settings.</li>
      <li><strong>Your account and everything in it:</strong> there’s no button for this in the app yet. <span class="tbc">To confirm</span> who to ask, and how soon it’s done.</li>
    </ul>
  </section>

  <section class="card">
    <h2>Still to confirm</h2>
    <ul>
      <li>Who runs AG2 and is responsible for your data, and how to contact them.</li>
      <li>How long things are kept, including after the project ends.</li>
      <li>Which country your login is kept in.</li>
      <li>Who the mentoring coordinator is, and what your mentor is told about you.</li>
      <li>How to have your account and everything in it deleted.</li>
    </ul>
  </section>
</main>

<style>
  .lead {
    color: var(--ink-2);
  }

  .privacy h2 {
    margin: 0 0 8px;
  }

  .privacy h3 {
    margin: 16px 0 6px;
    font-size: 16px;
  }

  .privacy ul {
    margin: 0;
    padding-left: 20px;
  }

  .privacy li + li {
    margin-top: 6px;
  }

  .privacy section p {
    margin: 10px 0 0;
  }

  /* Something the AG2 team still has to confirm. */
  .tbc {
    display: inline-block;
    padding: 0 6px;
    border-radius: 6px;
    background: var(--sun-soft);
    color: var(--sun-ink);
    font-size: 13px;
    font-weight: 600;
  }
</style>
