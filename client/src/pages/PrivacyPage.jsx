import LegalLayout from './LegalLayout.jsx';
import { CONTACT_EMAIL } from './legalInfo.js';

/** What ApIForge keeps about its users, and why — in plain words. */
export default function PrivacyPage() {
  return (
    <LegalLayout title="Privacy Policy">
      <p>
        ApIForge is a website for testing APIs without writing code. This page explains what information we keep
        about you, why we keep it, and how you can remove it.
      </p>

      <h2>What we collect</h2>
      <ul>
        <li>
          <strong>Your account:</strong> your email address and name. If you sign up with a password, we keep only a
          scrambled (hashed) form of it, never the password itself.
        </li>
        <li>
          <strong>If you sign in with Google:</strong> your email address, name and profile picture from your Google
          account. Nothing else.
        </li>
        <li>
          <strong>Your work:</strong> the requests, collections, folders, environments, variables, tests, mock endpoints,
          monitors and run results you create, and a history of the requests you send.
        </li>
        <li>
          <strong>Passwords and tokens inside your requests</strong> (for example an API key or bearer token) are stored
          encrypted.
        </li>
        <li>
          <strong>A sign-in cookie</strong> that keeps you signed in. We use no advertising, tracking or analytics
          cookies.
        </li>
      </ul>

      <h2>How we use Google sign-in data</h2>
      <p>
        We use the email address, name and profile picture Google shares only to create your ApIForge account, sign you
        in and show who you are inside the app. We do not access your Gmail, Drive, contacts or any other Google data,
        we do not use it for advertising, and we do not sell or share it.
      </p>

      <h2>How we use your information</h2>
      <ul>
        <li>To run the website: saving your work and showing it to you (and to people in team workspaces you share).</li>
        <li>
          To send account emails: confirming your email address, password resets, workspace invitations and the monitor
          alerts you turn on.
        </li>
        <li>
          To send the API requests you ask it to send. Those requests go to the addresses you enter, with the data you
          put in them.
        </li>
      </ul>

      <h2>Who else handles your data</h2>
      <p>We never sell your data. We rely on these services to run ApIForge:</p>
      <ul>
        <li>MongoDB Atlas, which stores the database;</li>
        <li>Render, which hosts the website;</li>
        <li>Google, for “Sign in with Google” and for delivering our emails.</li>
      </ul>
      <p>
        In a team workspace, the other members can see the collections, environments, runs and monitors in that
        workspace. Your request history and mock endpoints always stay private to you.
      </p>

      <h2>How long we keep it</h2>
      <ul>
        <li>Your account and work are kept until you delete them or your account.</li>
        <li>Request history keeps your newest 100 requests for 30 days.</li>
        <li>A sign-up that is never confirmed by email is removed after 24 hours.</li>
      </ul>

      <h2>Deleting your data</h2>
      <p>
        You can delete your account at any time from <strong>Account settings → Delete account</strong>. This removes
        your account and everything in it, including team workspaces you own. It cannot be undone.
      </p>

      <h2>Keeping it safe</h2>
      <p>
        Everything travels over an encrypted (HTTPS) connection, passwords are stored hashed, and credentials saved in
        requests are encrypted. No system is perfectly secure, but we take reasonable steps to protect your data.
      </p>

      <h2>Children</h2>
      <p>ApIForge is not meant for children under 13, and we do not knowingly collect their information.</p>

      <h2>Changes</h2>
      <p>If this policy changes, we will update this page and the date at the top.</p>

      <h2>Contact</h2>
      <p>
        Questions or requests about your data: <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
      </p>
    </LegalLayout>
  );
}
