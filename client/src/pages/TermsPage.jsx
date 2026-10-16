import LegalLayout from './LegalLayout.jsx';
import { CONTACT_EMAIL } from './legalInfo.js';

/** The rules for using ApIForge, in plain words. */
export default function TermsPage() {
  return (
    <LegalLayout title="Terms of Service">
      <p>
        These terms apply when you use ApIForge, a website for testing APIs without writing code. By creating an account
        or using the site, you agree to them.
      </p>

      <h2>Your account</h2>
      <ul>
        <li>Give a real email address you can receive mail at, and keep your password to yourself.</li>
        <li>You are responsible for what happens in your account.</li>
        <li>You must be at least 13 years old to use ApIForge.</li>
      </ul>

      <h2>Using ApIForge fairly</h2>
      <p>ApIForge sends requests to the APIs you choose. Only use it in ways you are allowed to. You must not:</p>
      <ul>
        <li>test, scan or attack systems you do not own or have permission to test;</li>
        <li>use it to send spam, overload a service, or get around another service’s limits or security;</li>
        <li>try to reach ApIForge’s own internal systems, break its security, or get around its usage limits;</li>
        <li>use it for anything illegal, or to store or share content you have no right to.</li>
      </ul>

      <h2>Your content</h2>
      <p>
        Your requests, collections and other work stay yours. You allow ApIForge to store and process them only as
        needed to run the service for you and the teams you share them with.
      </p>

      <h2>The service</h2>
      <ul>
        <li>
          ApIForge is provided “as is”. We work to keep it running and correct, but we cannot promise it will always be
          available or free of errors.
        </li>
        <li>Usage limits apply, and features may change over time.</li>
        <li>Do not rely on ApIForge as the only copy of important data — export your collections if you need a backup.</li>
      </ul>

      <h2>Ending your use</h2>
      <p>
        You can delete your account at any time from <strong>Account settings</strong>. We may suspend or close accounts
        that break these terms.
      </p>

      <h2>Liability</h2>
      <p>
        As far as the law allows, ApIForge is not liable for any indirect loss or damage from using the service,
        including problems with the APIs you test or the results you rely on.
      </p>

      <h2>Changes</h2>
      <p>
        If these terms change, we will update this page and the date at the top. Continuing to use ApIForge means you
        accept the updated terms.
      </p>

      <h2>Contact</h2>
      <p>
        Questions about these terms: <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
      </p>
    </LegalLayout>
  );
}
