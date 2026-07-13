/**
 * NexaSphere Membership Form — Google Apps Script
 * ─────────────────────────────────────────────────────────────────────────────
 * This is a STANDALONE script for the Membership Form ONLY.
 * The Core Team Recruitment form has its own separate script/sheet.
 *
 * HOW TO DEPLOY:
 *   1.  Open the Google Sheet you created for Membership responses.
 *   2.  Go to  Extensions → Apps Script
 *   3.  Your project should be named  "NexaSphere Membership"
 *   4.  Delete everything in Code.gs and paste THIS file.
 *   5.  Set the secret token:
 *         File → Project properties → Script properties
 *         Add key: MEMBERSHIP_SECRET  value: <your-strong-secret>
 *   6.  Click  Deploy → New deployment → Web App
 *           Execute as  : Me
 *           Who can access : Anyone
 *   7.  Click  Authorise  when prompted (allow Spreadsheet access).
 *   8.  Copy the Web App URL that appears after deployment.
 *   9.  Add to your SERVER .env file (NOT client-side):
 *         MEMBERSHIP_SCRIPT_URL=https://script.google.com/macros/s/AKfy.../exec
 *         MEMBERSHIP_SECRET=<your-strong-secret>
 *
 * SHEET STRUCTURE:
 *   The script will automatically create a tab called "Membership" inside
 *   your spreadsheet with a styled, frozen header row the first time it runs.
 *   You do NOT need to create the tab manually.
 *
 * SECURITY:
 *   The secret token is stored in Script Properties (server-side only).
 *   Admin requests must include the token in the POST body with action: 'getResponses'.
 *   The secret is never exposed to client-side code.
 *
 * The spreadsheet is the one this script is bound to (opened from Extensions → Apps Script).
 */

// ── CONFIG ────────────────────────────────────────────────────────────────────
// Leave SPREADSHEET_ID empty ('') to use the spreadsheet this script is bound to.
// If you want to write to a DIFFERENT spreadsheet, paste its ID here.
var SPREADSHEET_ID = ''; // e.g. '1bUtbaHwA7_ooqE4pNn3B74uE3hRQi1e7...'

var SHEET_TAB_NAME = 'Membership'; // Tab name inside the sheet
const TURNSTILE_SECRET_KEY = 'your_cloudflare_secret_key_here';

var HEADER_ROW = [
  'Timestamp',
  'Full Name',
  'College Email',
  'University Roll Number',
  'Course',
  'Branch',
  'Section',
  'Semester',
  'WhatsApp Number',
  'Groups Selected',
  'Why Join NexaSphere',
  'Submitted At',
  'User Agent',
];
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns (and auto-creates with styled header if absent) the Membership sheet tab.
 */
function getOrCreateSheet() {
  var ss = SPREADSHEET_ID
    ? SpreadsheetApp.openById(SPREADSHEET_ID)
    : SpreadsheetApp.getActiveSpreadsheet();

  var sheet = ss.getSheetByName(SHEET_TAB_NAME);

  if (!sheet) {
    // Tab doesn't exist yet — create it and write the header
    sheet = ss.insertSheet(SHEET_TAB_NAME);
    sheet.appendRow(HEADER_ROW);
    _styleHeader(sheet);
  } else if (sheet.getLastRow() === 0) {
    // Tab exists but is completely empty
    sheet.appendRow(HEADER_ROW);
    _styleHeader(sheet);
  }

  return sheet;
}

/**
 * Applies dark-theme styling to the header row.
 */
function _styleHeader(sheet) {
  var range = sheet.getRange(1, 1, 1, HEADER_ROW.length);
  range.setFontWeight('bold');
  range.setBackground('#1a1a2e');
  range.setFontColor('#00d4ff');
  range.setFontSize(10);
  sheet.setFrozenRows(1);
  // Auto-resize columns for readability
  for (var i = 1; i <= HEADER_ROW.length; i++) {
    sheet.setColumnWidth(i, 160);
  }
}

// ── GET/POST handler ── Fetch data for Admin Dashboard or health check ────────────────
function doGet(e) {
  return _respond({
    ok: true,
    service: 'NexaSphere Membership API',
    version: '1.1',
    sheet: SHEET_TAB_NAME,
    status: 'Ready',
  });
}

function doPost(e) {
  try {
    var raw = '';
    if (e && e.postData && e.postData.contents) {
      raw = e.postData.contents;
    }

    if (!raw) {
      return _respond({ ok: false, error: 'Empty request body' });
    }

    var data = JSON.parse(raw);

    // Handle admin requests (getResponses) with token verification
    if (data.action === 'getResponses') {
      var token = data.token;
      var SECRET_TOKEN = PropertiesService.getScriptProperties().getProperty('MEMBERSHIP_SECRET');

      // ── FIXED ADMINISTRATIVE SECURITY LEAK ─────────────────────────────────
      // Strict Check: Fails instantly if the server secret is unconfigured,
      // if the client token is missing, or if they do not match exactly.
      if (!SECRET_TOKEN || !token || token !== SECRET_TOKEN) {
        return _respond({ ok: false, error: 'Unauthorized' });
      }
      // ───────────────────────────────────────────────────────────────────────

      try {
        var sheet = getOrCreateSheet();
        var rows = sheet.getDataRange().getValues();

        // Fix: Gracefully handle an empty sheet or a sheet with only headers
        if (rows.length <= 1) {
          return _respond({
            ok: true,
            count: 0,
            responses: [],
          });
        }

        var headers = rows[0];
        var responses = [];

        for (var i = 1; i < rows.length; i++) {
          var obj = {};
          for (var j = 0; j < headers.length; j++) {
            // Fix: Replaced arrow function with an explicit callback function
            // to guarantee compatibility across legacy Apps Script engines
            var key = headers[j]
              .toString()
              .toLowerCase()
              .replace(/[^a-z0-9]+(.)/g, function (m, chr) {
                return chr.toUpperCase();
              })
              .replace(/[^a-z0-9]/gi, '');
            obj[key] = rows[i][j];
          }
          responses.push(obj);
        }

        return _respond({
          ok: true,
          count: responses.length,
          responses: responses,
        });
      } catch (err) {
        return _respond({ ok: false, error: err.message });
      }
    }

    // CAPTCHA validation only for public submissions
    if (!verifyTurnstileToken(data.turnstileToken)) {
      return _respond({
        ok: false,
        error: 'CAPTCHA verification failed',
      });
    }

    // Handle form submissions (original behavior)
    var now = new Date().toISOString();
    var sheet = getOrCreateSheet();

    var row = [
      now,
      data.fullName || '',
      data.collegeEmail || '',
      data.rollNumber || '',
      data.course || '',
      data.branch || '',
      data.section || '',
      data.semester || '',
      data.whatsapp || '',
      Array.isArray(data.groups) ? data.groups.join(', ') : data.groups || '',
      data.whyJoin || '',
      data.submittedAt || now,
      data.userAgent || '',
    ];

    sheet.appendRow(row);

    // ── Send confirmation receipt email to the applicant ──────────────────
    var recipientEmail = data.collegeEmail || '';
    var recipientName = data.fullName || 'NexaSphere Member';

    if (recipientEmail && recipientEmail.indexOf('@') > -1) {
      try {
        var subject = '✅ NexaSphere Membership Form — Submission Confirmed';

        var groupsText = Array.isArray(data.groups)
          ? data.groups.join(', ')
          : data.groups || 'Not specified';

        var htmlBody = [
          '<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#0f0f1a;color:#e2e8f0;border-radius:12px;overflow:hidden;border:1px solid #1e293b;">',
          '  <div style="background:linear-gradient(135deg,#7b6fff,#00d4ff);padding:28px 32px;text-align:center;">',
          '    <div style="font-size:2rem;margin-bottom:8px;">🚀</div>',
          '    <h1 style="margin:0;font-size:1.3rem;color:#fff;font-weight:700;letter-spacing:.04em;">NexaSphere Membership</h1>',
          '    <p style="margin:6px 0 0;color:rgba(255,255,255,.8);font-size:.9rem;">GL Bajaj Group of Institutions, Mathura</p>',
          '  </div>',
          '  <div style="padding:28px 32px;">',
          '    <p style="font-size:1rem;color:#e2e8f0;margin-top:0;">Hi <strong>' +
            recipientName +
            '</strong>,</p>',
          '    <p style="color:#94a3b8;line-height:1.7;">',
          '      Your <strong style="color:#00d4ff;">NexaSphere Membership Form</strong> has been successfully received. 🎉<br/>',
          '      Here is a summary of your submission:',
          '    </p>',
          '    <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:.88rem;">',
          '      <tr style="border-bottom:1px solid #1e293b;"><td style="padding:8px 4px;color:#64748b;width:42%;">Full Name</td><td style="padding:8px 4px;color:#e2e8f0;font-weight:600;">' +
            (data.fullName || '—') +
            '</td></tr>',
          '      <tr style="border-bottom:1px solid #1e293b;"><td style="padding:8px 4px;color:#64748b;">Roll Number</td><td style="padding:8px 4px;color:#e2e8f0;font-weight:600;">' +
            (data.rollNumber || '—') +
            '</td></tr>',
          '      <tr style="border-bottom:1px solid #1e293b;"><td style="padding:8px 4px;color:#64748b;">Branch</td><td style="padding:8px 4px;color:#e2e8f0;font-weight:600;">' +
            (data.branch || '—') +
            '</td></tr>',
          '      <tr style="border-bottom:1px solid #1e293b;"><td style="padding:8px 4px;color:#64748b;">Semester</td><td style="padding:8px 4px;color:#e2e8f0;font-weight:600;">' +
            (data.semester || '—') +
            '</td></tr>',
          '      <tr><td style="padding:8px 4px;color:#64748b;">Groups Selected</td><td style="padding:8px 4px;color:#e2e8f0;font-weight:600;">' +
            groupsText +
            '</td></tr>',
          '    </table>',
          '    <div style="background:#1e293b;border-left:3px solid #7b6fff;border-radius:6px;padding:14px 18px;margin:20px 0;">',
          '      <strong style="color:#a78bfa;display:block;margin-bottom:6px;font-size:.82rem;letter-spacing:.06em;text-transform:uppercase;">What Happens Next</strong>',
          '      <ol style="margin:0;padding-left:18px;color:#94a3b8;font-size:.88rem;line-height:1.8;">',
          '        <li>Join the <a href="https://chat.whatsapp.com/FhpJEaod2g419jFMfqrhGZ" style="color:#00d4ff;">NexaSphere WhatsApp Community</a> and mention you have filled the form.</li>',
          '        <li>Our team will verify your submission within <strong style="color:#e2e8f0;">3–5 working days</strong>.</li>',
          '        <li>Once verified, you will be added to your chosen NexaSphere domain groups.</li>',
          '      </ol>',
          '    </div>',
          '    <p style="color:#64748b;font-size:.85rem;line-height:1.7;">',
          '      Questions? Reply to this email or write to us at<br/>',
          '      <a href="mailto:nexasphere@glbajajgroup.org" style="color:#00d4ff;">nexasphere@glbajajgroup.org</a>',
          '    </p>',
          '  </div>',
          '  <div style="padding:16px 32px;text-align:center;border-top:1px solid #1e293b;background:#0a0a14;">',
          '    <p style="margin:0;color:#475569;font-size:.8rem;">NexaSphere · GL Bajaj Group of Institutions, Mathura · This is an automated confirmation.</p>',
          '  </div>',
          '</div>',
        ].join('\n');

        var plainBody = [
          'Hi ' + recipientName + ',',
          '',
          'Your NexaSphere Membership Form has been successfully received.',
          '',
          'Submission Summary:',
          '  Full Name    : ' + (data.fullName || '—'),
          '  Roll Number  : ' + (data.rollNumber || '—'),
          '  Branch       : ' + (data.branch || '—'),
          '  Semester     : ' + (data.semester || '—'),
          '  Groups       : ' + groupsText,
          '',
          'What Happens Next:',
          '  1. Join the NexaSphere WhatsApp Community and mention you have filled the form.',
          '  2. Our team will verify your submission within 3-5 working days.',
          '  3. Once verified, you will be added to your chosen NexaSphere domain groups.',
          '',
          'Questions? Write to us at nexasphere@glbajajgroup.org',
          '',
          '— NexaSphere Team',
          '  GL Bajaj Group of Institutions, Mathura',
        ].join('\n');

        MailApp.sendEmail({
          to: recipientEmail,
          subject: subject,
          body: plainBody,
          htmlBody: htmlBody,
          name: 'NexaSphere — GL Bajaj Group of Institutions',
          noReply: false,
        });
      } catch (mailErr) {
        console.warn('Confirmation email failed:', mailErr.message);
      }
    }
    // ─────────────────────────────────────────────────────────────────────

    return _respond({ ok: true, message: 'Membership response recorded.' });
  } catch (err) {
    return _respond({ ok: false, error: err.message });
  }
}

// ── Helper ────────────────────────────────────────────────────────────────────
function _respond(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}

function verifyTurnstileToken(token) {
  if (!token) return false;

  const url = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
  const payload = {
    secret: TURNSTILE_SECRET_KEY,
    response: token,
  };

  const options = {
    method: 'post',
    payload: payload,
  };

  try {
    const response = UrlFetchApp.fetch(url, options);
    const json = JSON.parse(response.getContentText());
    return json.success === true;
  } catch (e) {
    console.error('Turnstile verification failed: ' + e.toString());
    return false;
  }
}
