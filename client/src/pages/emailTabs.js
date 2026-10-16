/**
 * The tab an email button opens (Verify my email, Yes / No) and the page waiting on that
 * email — sign-up or sign-in — find each other through a BroadcastChannel.
 *
 * The email tab posts 'answered'; the waiting page replies 'here' and checks the result
 * at once. Hearing 'here' tells the email tab it can close itself: the person carries on
 * in the tab they started in, and the click in the email is all they see.
 */
export const RESET_CHANNEL = 'apiforge-reset';
export const VERIFY_CHANNEL = 'apiforge-verify';

// How long the email tab listens for a reply, and then waits for window.close().
const REPLY_WAIT_MS = 400;
const CLOSE_WAIT_MS = 250;

function openChannel(name) {
  return typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(name);
}

/**
 * In the email tab, once the server has the answer: tells the waiting page, and closes
 * this tab when there is nothing left to do in it — the waiting page in this browser has
 * taken over, or this is another device (the phone the email was read on).
 *
 * Resolves only if the tab is still open: no waiting page answered here, or the browser
 * would not let a script close it. The caller then shows its fallback.
 */
export function finishEmailTab({ channel: name, sameBrowser }) {
  return new Promise((resolve) => {
    const channel = sameBrowser ? openChannel(name) : null;
    let heard = false;
    if (channel) {
      channel.onmessage = (e) => {
        if (e.data?.type === 'here') heard = true;
      };
      channel.postMessage({ type: 'answered' });
    }
    setTimeout(() => {
      channel?.close();
      if (heard || !sameBrowser) window.close();
      setTimeout(resolve, CLOSE_WAIT_MS);
    }, REPLY_WAIT_MS);
  });
}

/**
 * In the waiting page: answers an email tab of this browser (so it can close) and runs
 * `onAnswered` to pick the result up straight away. Returns the cleanup.
 */
export function listenForEmailTab(name, onAnswered) {
  const channel = openChannel(name);
  if (!channel) return () => {};
  channel.onmessage = (e) => {
    if (e.data?.type !== 'answered') return;
    channel.postMessage({ type: 'here' });
    onAnswered();
  };
  return () => channel.close();
}
