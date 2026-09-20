# 11 · Issue Chat & Consultant Assistant

Every issue has two separate threads (`threads.kind`):

| | Agent thread | Consultant thread |
|---|---|---|
| Counterpart | The investigating agent | An answer-drafting assistant |
| Purpose | Steer the investigation, ask technical questions, give commands | Draft concise, natural answers for the consultant/client |
| Tools | All tools per tier (doc 05) | **No tools** (only reads the already-filtered evidence board) |
| Default model | Sonnet (intent classification: Haiku) | Haiku (option: Sonnet for longer answers) |
| Output | Technical markdown, can trigger actions | A copy-ready draft |

## 1. Agent thread

- Your message → intent classification (doc 05 §7) → answered directly or resumes the session.
- Quick actions above the input box: **Capture final**, **Fix**, **Verify**, **Stop**, **Export**.
- System events (session start, checkpoint, new evidence, run finished) appear inline as `system_event`.
- Mention evidence with `#E12` and files with `@path/to/file.js:33` (autocomplete).

## 2. Consultant assistant

### Input
- A text box for pasting in the consultant's question(s) (can hold several questions at once).
- Controls: **Language** (English / Indonesian / match the question), **Tone** (formal / casual-professional), **Length** (brief 1-2 sentences / 1 paragraph / bullet points), **Audience** (functional consultant / end-user client / technical team).

### Context given to the model
Only a **safe projection** of the issue:
- Title, status, evidence level.
- Evidence marked `confirmed`/`proposed` with `private=0`: title + summary.
- Open hypotheses + confidence, root cause (if any), fix/verification status, an ETA if you've set one.
- Excluded: credentials, local paths, internal repo file names (optional), raw log contents, private notes, cost.

### Answer rules (see `prompts/consultant-assistant.md`)
1. Answer the question directly in the first sentence.
2. Use plain language for a functional audience; NetSuite technical terms are fine for a technical audience.
3. Clearly distinguish: **already proven** vs. **hypothesis** vs. **not yet known**.
4. Never promise a date/fix that you haven't actually committed to.
5. If the evidence isn't sufficient: say so, and suggest what is being/will be checked.
6. No emoji, no filler opener, length capped per the length control.

### Output
- A draft answer + a list of referenced evidence (`#E3, #E7`) for you to check (not included when copied).
- Buttons: **Copy**, **Shorter**, **More formal**, **Translate**.
- Output filter: a regex for secrets/paths/internal emails; if detected, the draft is held back with a warning.

### Example

Consultant's question: *"Hey, any idea why VB-1042 can't get approved? The client is asking when it'll be fixed."*

Draft (brief, casual-professional):
> Found the cause: when approving, two automated scripts update the same bill at the same time, so NetSuite refuses to save it with the message "Record has been changed." I'm testing the fix in sandbox now; once it passes verification, I'll let you know the rollout schedule to production.

## 3. History & reuse

- Every question and draft is saved in the consultant thread as a communication record.
- A **Make issue FAQ** button: question-answer pairs you flag get included in the report (the "Q&A" section).
