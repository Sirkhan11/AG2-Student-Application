<script>
  import { goto } from '$app/navigation';
  import { createUserWithEmailAndPassword } from 'firebase/auth';
  import { doc, setDoc } from 'firebase/firestore';
  import { getFirebaseAuth, db } from '#lib/firebase/client';

  let name = $state('');
  let email = $state('');
  let password = $state('');
  let course = $state('');
  let interests = $state('');
  let arrivalDate = $state('');
  let error = $state('');
  let loading = $state(false);

  async function register() {
    error = '';
    loading = true;

    try {
      const result = await createUserWithEmailAndPassword(
        getFirebaseAuth(),
        email,
        password
      );

      await setDoc(doc(db, 'students', result.user.uid), {
        name,
        email,
        course,
        interests: interests.split(',')
          .map((item) => item.trim())
          .filter(Boolean),
        arrivalDate,
        role: 'student'
      });

      await goto('/home');
    } catch (err) {
      error = err.message;
    } finally {
      loading = false;
    }
  }
</script>

<main class="page">
  <h1>Create your account</h1>
  <p class="muted">
    Tell us a little about yourself.
  </p>

  <form onsubmit={(event) => {
    event.preventDefault();
    register();
  }}>
    <label for="name">Full name</label>
    <input id="name" class="field"
      bind:value={name} required />

    <label for="email">Email</label>
    <input id="email" class="field" type="email"
      bind:value={email} required />

    <label for="password">Password</label>
    <input id="password" class="field" type="password"
      minlength="6" bind:value={password} required />

    <label for="course">Course</label>
    <input id="course" class="field"
      bind:value={course} required />

    <label for="interests">Interests</label>
    <input id="interests" class="field"
      placeholder="Music, football, gaming"
      bind:value={interests} />

    <label for="arrival">Arrival date</label>
    <input id="arrival" class="field" type="date"
      bind:value={arrivalDate} />

    {#if error}
      <p class="error" role="alert">{error}</p>
    {/if}

    <button class="primary-button"
      type="submit" disabled={loading}>
      {loading ? 'Creating account...' : 'Sign up'}
    </button>
  </form>

  <p><a href="/">Already have an account?</a></p>
</main>
