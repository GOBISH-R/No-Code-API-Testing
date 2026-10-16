/**
 * The HTML body for the app's emails: brand name, a heading, a short paragraph, one
 * big button, the link spelled out underneath, and a small footer.
 *
 * Email clients are not browsers. Gmail strips <style> blocks in places, Outlook
 * renders with Word's engine, and none of them run CSS layout reliably — so this is
 * built the way email has to be: nested tables, inline styles, a fixed 560px column,
 * and a button that is a padded link rather than a <button>. Every piece of text that
 * comes from outside (a person's name, the link) is escaped: a name typed at sign-up
 * must never become markup in somebody's inbox.
 */

export const APP_NAME = 'ApIForge';

// The app's orange, in its darker, text-safe shade: white on it passes contrast.
const ACCENT = '#c2410c';

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);
}

/**
 * @param {object} options
 * @param {string} options.heading    e.g. "Verify your email address"
 * @param {string} options.greeting   e.g. "Hi Ada," (plain text; escaped here)
 * @param {string} options.intro      one or two sentences (plain text; escaped here)
 * @param {string} options.buttonLabel
 * @param {string} options.link       the action URL
 * @param {string} options.note       small print under the link (plain text)
 * @param {string} [options.logoUrl]  absolute URL of the logo PNG. Email clients do not
 *                                    show SVG and block inline images, so the mark is
 *                                    fetched from the site like any web image.
 * @param {string[]} [options.details] short lines shown as a list under the intro — e.g.
 *                                    the requests a monitor saw fail (plain text; escaped)
 * @param {{label: string, link: string}} [options.secondary] a second, outlined button
 *                                    under the first — "No, it wasn't me". With one, the
 *                                    "paste this link" line is left out: two raw links
 *                                    side by side would only invite the wrong one.
 */
export function renderActionEmail({ heading, greeting, intro, buttonLabel, link, note, logoUrl, details = [], secondary = null }) {
  const safeLink = escapeHtml(link);
  const year = new Date().getFullYear();

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escapeHtml(heading)}</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f5;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f4f5;">
  <tr>
    <td align="center" style="padding:32px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#ffffff;border:1px solid #e4e4e7;border-radius:8px;">
        <tr>
          <td align="center" style="padding:36px 40px 8px;font-family:Segoe UI,Helvetica,Arial,sans-serif;">
            ${logoUrl ? `<img src="${escapeHtml(logoUrl)}" width="40" height="40" alt="" style="display:inline-block;width:40px;height:40px;border:0;vertical-align:middle;">` : ''}
            <span style="font-size:20px;font-weight:700;color:#18181b;vertical-align:middle;padding-left:8px;">${APP_NAME}</span>
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:24px 40px 0;font-family:Segoe UI,Helvetica,Arial,sans-serif;">
            <h1 style="margin:0;font-size:26px;line-height:1.3;font-weight:600;color:#18181b;">${escapeHtml(heading)}</h1>
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:16px 40px 0;font-family:Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#52525b;">
            ${greeting ? `<p style="margin:0 0 8px;">${escapeHtml(greeting)}</p>` : ''}
            <p style="margin:0;">${escapeHtml(intro)}</p>
          </td>
        </tr>${
          details.length > 0
            ? `
        <tr>
          <td style="padding:16px 40px 0;font-family:Segoe UI,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5;color:#3f3f46;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#fafafa;border:1px solid #e4e4e7;border-radius:6px;">
              ${details
                .map(
                  (line) =>
                    `<tr><td style="padding:8px 14px;border-bottom:1px solid #f0f0f1;">${escapeHtml(line)}</td></tr>`,
                )
                .join('')}
            </table>
          </td>
        </tr>`
            : ''
        }
        <tr>
          <td align="center" style="padding:28px 40px 0;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td align="center" bgcolor="${ACCENT}" style="border-radius:6px;">
                  <a href="${safeLink}" target="_blank" rel="noopener" style="display:block;padding:14px 24px;font-family:Segoe UI,Helvetica,Arial,sans-serif;font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:6px;">${escapeHtml(buttonLabel)}</a>
                </td>
              </tr>${
                secondary
                  ? `
              <tr><td style="height:12px;line-height:12px;font-size:0;">&nbsp;</td></tr>
              <tr>
                <td align="center" style="border:1px solid #d4d4d8;border-radius:6px;">
                  <a href="${escapeHtml(secondary.link)}" target="_blank" rel="noopener" style="display:block;padding:13px 24px;font-family:Segoe UI,Helvetica,Arial,sans-serif;font-size:16px;font-weight:600;color:#3f3f46;text-decoration:none;border-radius:6px;">${escapeHtml(secondary.label)}</a>
                </td>
              </tr>`
                  : ''
              }
            </table>
          </td>
        </tr>${
          secondary
            ? ''
            : `
        <tr>
          <td align="center" style="padding:24px 40px 0;font-family:Segoe UI,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.5;color:#71717a;">
            Or paste this link into your browser:<br>
            <a href="${safeLink}" target="_blank" rel="noopener" style="color:${ACCENT};word-break:break-all;">${safeLink}</a>
          </td>
        </tr>`
        }
        <tr>
          <td align="center" style="padding:20px 40px 36px;font-family:Segoe UI,Helvetica,Arial,sans-serif;font-size:12px;line-height:1.5;color:#a1a1aa;">
            ${escapeHtml(note)}
          </td>
        </tr>
      </table>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
        <tr>
          <td align="center" style="padding:20px 16px 0;font-family:Segoe UI,Helvetica,Arial,sans-serif;font-size:12px;color:#a1a1aa;">
            &copy; ${year} ${APP_NAME}. All rights reserved.
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}
