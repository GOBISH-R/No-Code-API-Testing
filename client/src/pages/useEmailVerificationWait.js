import { useEffect, useState } from 'react';
import * as accountService from '../services/accountService.js';

/**
 * Which address, if any, this page is waiting to see verified.
 *
 * Starts empty: a sign-up page opened afresh — after closing the tab, say — is a normal
 * sign-up page. The one exception is `resume`, set when Google has just sent the browser
 * back from a new sign-up: the link is on its way, so the page picks that wait up.
 */
export function useEmailVerificationWait({ resume = false } = {}) {
  const [waitingFor, setWaitingFor] = useState(null);

  useEffect(() => {
    if (!resume) return undefined;
    let active = true;
    accountService
      .getVerificationStatus()
      .then((result) => {
        if (active && (result.status === 'waiting' || result.status === 'expired')) {
          setWaitingFor(result.email);
        }
      })
      .catch(() => {
        // Nothing pending that we can see; the form is the right thing to show.
      });
    return () => {
      active = false;
    };
  }, [resume]);

  return { waitingFor, setWaitingFor };
}
