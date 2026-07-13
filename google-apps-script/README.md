# ⚙️ google-apps-script/

Google Apps Script source files. These are **not bundled by Vite** — they must be manually copied into the Apps Script editor at [script.google.com](https://script.google.com).

---

## Files

| File      | Purpose                                               | Apps Script Project     |
| --------- | ----------------------------------------------------- | ----------------------- |
| `Code.gs` | **Membership Form** handler — writes to Google Sheets | "NexaSphere Membership" |

> The **Core Team Recruitment** form uses a separate Apps Script project (not stored in this folder).

---

## Code.gs — Membership Form

Receives a `POST` request from `MembershipPage.jsx` and appends a row to the `Membership` tab in the linked Google Sheet.

### Deployment Details

| Setting        | Value                                                                                                              |
| -------------- | ------------------------------------------------------------------------------------------------------------------ |
| Project name   | NexaSphere Membership                                                                                              |
| Execute as     | Me                                                                                                                 |
| Who can access | Anyone                                                                                                             |
| Deployment ID  | `AKfycbyRQOW3Xjv13vXvft8ezD9sJdvjV3kf-VHm1l_mImHRDUAEqsilK0wb5QBD5GOkixwe`                                         |
| Web App URL    | `https://script.google.com/macros/s/AKfycbyRQOW3Xjv13vXvft8ezD9sJdvjV3kf-VHm1l_mImHRDUAEqsilK0wb5QBD5GOkixwe/exec` |
| Deployed       | Apr 21, 2026 · Version 1                                                                                           |

### Sheet columns written per submission

`Timestamp` · `Full Name` · `University Roll Number` · `Course` · `Branch` · `Section` · `Semester` · `WhatsApp Number` · `Groups Selected` · `Why Join NexaSphere` · `Submitted At` · `User Agent`

---

## How to redeploy after editing Code.gs

1. Open the Apps Script project → paste the updated `Code.gs`
2. **Deploy → Manage deployments → Edit (pencil icon) → New version → Deploy**
3. The **Deployment ID and URL stay the same** when you edit an existing deployment — no code change needed in the frontend
4. If you create a **New deployment** instead, a new URL is generated — update `MEMBERSHIP_SCRIPT_URL` in `MembershipPage.jsx`

---

## CORS note

Google Apps Script does not support CORS preflight for `application/json`. The frontend sends requests with:

```js
fetch(url, {
  method: 'POST',
  mode: 'no-cors',
  headers: { 'Content-Type': 'text/plain' }, // ← must be text/plain
  body: JSON.stringify(payload),
});
```

The script receives the raw text in `e.postData.contents` and parses it as JSON. The response is opaque (no response body visible to the browser) — this is expected and correct behaviour.
