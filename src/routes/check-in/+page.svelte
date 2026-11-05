
<script>
  import BottomNav from '$lib/components/BottomNav.svelte';

  let message = $state('');

  let messages = $state([
    {
      role: 'assistant',
      text: 'Hi! How are you settling into university?'
    }
  ]);

  function sendMessage() {
    const text = message.trim();
    if (!text) return;

    messages.push({
      role: 'user',
      text
    });

    message = '';

    messages.push({
      role: 'assistant',
      text: 'Thanks for sharing. You can explore your checklist, find societies or use the Need Help Now page if you need urgent support.'
    });
  }
</script>

<main class="page">
  <h1>Check-in Chat</h1>

  <p class="muted">
    A place to check in and find student support.
    This is not a medical or emergency service.
  </p>

  <div class="messages">
    {#each messages as item}
      <div
        class="bubble"
        class:user={item.role === 'user'}
      >
        {item.text}
      </div>
    {/each}
  </div>

  <form onsubmit={(event) => {
    event.preventDefault();
    sendMessage();
  }}>
    <label for="chat-message">Your message</label>

    <input
      id="chat-message"
      class="field"
      placeholder="Type your message..."
      bind:value={message}
    />

    <button class="primary-button" type="submit">
      Send
    </button>
  </form>

  <p><a href="/need-help">Need help now?</a></p>

  <BottomNav />
</main>

<style>
  .messages {
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-height: 280px;
    margin: 20px 0;
  }

  .bubble {
    align-self: flex-start;
    max-width: 85%;
    padding: 13px;
    border-radius: 14px;
    background: #eaf2f8;
  }

  .bubble.user {
    align-self: flex-end;
    background: #1764a1;
    color: white;
  }
</style>
