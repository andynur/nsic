# 08 · Browser Runner, Capture & Screen Recording

## 1. Engine

- **Primary:** `Bun.WebView` with an installed Chrome/Chromium/Edge backend, driven through a
  high-level API (`navigate`, `click`, `evaluate`, `screenshot`) plus `.cdp(method, params)` for
  advanced needs (cookies, screencast, network interception, printToPDF). Clicks and scrolling are sent
  as genuine user input (trusted events).
- **Fallback (ADR-004):** Playwright, which already works on Bun 1.4, as an optional dependency
  if spike S-01 finds a gap (persistent profiles, file upload, multi-tab, dialogs).
- **Manual:** Claude Cowork / Claude in Chrome for cases that can't be automated. Results are
  imported through the **Import manual evidence** button (screenshot/video/note → `attachments.source='cowork_import'`).

## 2. Sessions & Login Assist

1. Every environment has a profile directory at `data/profiles/{envId}`.
2. **Login Assist**: the server launches Chrome non-headless with `--user-data-dir` pointing at that
   profile and a random `--remote-debugging-port`; you log in (SSO/2FA, picking the correct role); click **Done** in NSIC.
3. NSIC reads the cookies via CDP `Storage.getCookies`, encrypts them, and stores them as
   `credentials.kind='browser_session'` (a backup in case the profile gets corrupted).
4. The runner uses the same profile (headless). Session-expiry detection: the URL points to a login page,
   or a login form element is detected → the run is marked `blocked`, with a "Login again required" notification.
5. An environment may only have one active browser run at a time (mutex in the dispatcher).

## 3. Repro DSL

Reproduce steps are written as deterministic JSON (not free-form code), schema-validated, and versioned.

```jsonc
{
  "version": 1,
  "environment": "SB1",
  "role_hint": "A/P Clerk",
  "viewport": { "width": 1440, "height": 900 },
  "redact": { "selectors": ["#entity_display", ".uir-field-name-email"], "patterns": ["\\b\\d{16}\\b"] },
  "steps": [
    { "id": "s1", "action": "navigate", "url": "/app/accounting/transactions/vendbill.nl?id=12345",
      "caption": "Open Vendor Bill #VB-1042" },
    { "id": "s2", "action": "wait", "for": { "selector": "#main_form" }, "timeoutMs": 20000 },
    { "id": "s3", "action": "assert", "target": { "field": "approvalstatus" }, "expect": { "textIncludes": "Pending Approval" },
      "caption": "Status is still Pending Approval" },
    { "id": "s4", "action": "click", "target": { "text": "Approve", "role": "button" },
      "caption": "Click Approve", "sandboxOnly": true },
    { "id": "s5", "action": "expectError", "match": "RCRD_HAS_BEEN_CHANGED",
      "caption": "A \"Record has been changed\" error appears" }
  ]
}
```

| Action | Notes |
|---|---|
| `navigate` | A path relative to `ui_base_url`, or an absolute URL on the same account domain |
| `wait` | Selector, text, `networkIdle`, or a duration (max 60s) |
| `click` | Target: `selector`, `field` (a NetSuite field id → selector `#{id}_fs` / `[name=id]`), or `text` + `role` |
| `type` / `select` | Fill a field (blocked in production) |
| `scroll` | To a target |
| `assert` | Check text/value; the result becomes evidence |
| `expectError` | A matching error message pattern on the page/dialog |
| `screenshot` | An extra screenshot (viewport/full page/element) |
| `evaluate` | Only **read** functions from an allowlist (`readField`, `readSublist`, `readUrl`), never free-form JS |
| `note` | A caption with no action (for video) |

Every step has a `caption` (for screenshots & video) and a `sandboxOnly` flag (auto-skipped + logged in production).

## 4. Runner

For each step:
1. Validate against the guard (§5).
2. Execute the action; wait for a stable condition: `networkIdle` (CDP Network events) + no NetSuite loading overlay.
3. `capture` mode: inject a highlight (2px outline + step-number label) onto the target element via `evaluate`, then
   take a screenshot (`Bun.WebView.screenshot()`), then remove the highlight.
4. Apply redaction (§6) **before** the screenshot.
5. Save the `screenshot` artifact with `step_index`, `caption`; a WebP thumbnail via `Bun.Image`.
6. Automatic error detection: `alert/confirm` dialogs, NetSuite error banners, error-code text → recorded as the step's result.

Modes:

| Mode | Screenshot | Video | Used by |
|---|---|---|---|
| `explore` | Only when requested | No | Agent INVESTIGATE |
| `reproduce` | Every step (low resolution) | No | Agent REPRODUCE |
| `capture` | Every step, highlighted + captioned, full resolution | Yes | Capture final button |
| `verify_before` / `verify_after` | Every step | Yes | Fix flow (FR-22) |

## 5. Production guard (browser)

Activates automatically when `environment.kind='production'`. Cannot be turned off from the UI.

| Layer | Rule |
|---|---|
| DSL | `type`, `select` actions, and `sandboxOnly` steps are rejected |
| URL | Blocks navigation with the `e=T` parameter (edit mode), paths ending in `.nl` with certain `cp=` values that create a new record (a configured list), and `/app/common/scripting/` URLs |
| Click target | Rejects elements with an id/name from a denylist: `submitter`, `btn_multibutton_submitter`, `secondarysubmitter`, `edit`, `delete`, `approve`, `reject`, `resetter`, and localized button text for write actions such as Save, Submit, Approve, Reject, Delete, Edit, Void, Close, Bill, Receive, and Fulfill |
| DOM | A script injected at `DOMContentLoaded`: intercepts the `submit` event (capture phase) and `HTMLFormElement.prototype.submit` → `preventDefault` + reports it |
| Network | CDP `Fetch.enable` for non-GET requests to the account domain → rejected (`Fetch.failRequest`) except for a verified allowlist of read endpoints |
| Audit | Every block → an `audit_log` entry `browser.blocked` + an evidence note "action X blocked (production guard)" |

Guard in sandbox: audit layer only (every action is logged), nothing is blocked.

## 6. Redaction

- **Selector-based:** CSS `filter: blur(6px)` is injected onto selectors in `redact.selectors` (DSL + project defaults, e.g. customer name, email, account number).
- **Pattern-based:** `evaluate` wraps text matching a regex (`redact.patterns`, defaults: email, card number, phone number) in a blur span.
- Screenshots and video frames are captured **after** redaction, so an unredacted raw file is never created.
- Flag `artifacts.redacted=1`. Report exports may only use redacted artifacts unless you choose "internal".

## 7. Screen recording

Pipeline (Chrome backend):
1. `Page.startScreencast({ format: "jpeg", quality: 80, maxWidth: 1440, maxHeight: 900, everyNthFrame: 1 })`.
2. For every `Page.screencastFrame` event: write `data/issues/{id}/videos/{runId}/frames/{seq}.jpg` + timestamp metadata, then `Page.screencastFrameAck`.
3. Record a step timeline: `{stepId, caption, tStart, tEnd}` → `captions.vtt` (WebVTT) and `captions.srt`.
4. After the run: build `frames.txt` (a concat demuxer with a `duration` per frame from the timestamps; the last frame repeated) → `ffmpeg`:

```sh
ffmpeg -f concat -safe 0 -i frames.txt -vf "fps=30,format=yuv420p,scale=trunc(iw/2)*2:trunc(ih/2)*2" \
       -c:v libx264 -preset veryfast -crf 23 -movflags +faststart out.mp4
# version with burned-in captions (for sending to the team):
ffmpeg -i out.mp4 -vf "subtitles=captions.srt:force_style='FontName=Geist,FontSize=18'" -c:a copy out.captioned.mp4
```

5. Delete the raw frames, save `video` + `captions` as artifacts.
6. If ffmpeg isn't installed: keep the frames + VTT and show a "slideshow" player in the UI; disable the video export button with installation instructions.

**[SPIKE S-01b]** verify that `Page.startScreencast` and `Fetch.*` work through `Bun.WebView.cdp()`.

## 8. Before / after

- The fix flow runs the same script version: `verify_before` (before deploying) and `verify_after` (after the sandbox deploy).
- The UI shows the two videos side by side + a per-step comparison table (status, error).
- The report includes this table as E5 evidence.

## 9. Known limitations

- The NetSuite UI changes between releases (theme, element ids). Targeting `field` (the NetSuite field id) is more stable than a CSS selector; button text matchers must cover supported UI locales.
- Heavy pages (a large saved search) can exceed the timeout; the runner uses a per-step timeout and records it as `failed` rather than hanging.
- Popup windows (e.g. lookups) are handled as new targets via CDP `Target.*` **[SPIKE S-01]**.
