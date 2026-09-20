# 12 · Report & Export

## 1. Formats

| Format | Contents | Technology |
|---|---|---|
| PDF | Narrative report + visual evidence | HTML (template + `tokens.css`) → CDP `Page.printToPDF` via `Bun.WebView` |
| XLSX | Tabular data for audit/filtering | `src/reports/xlsx.ts` (SpreadsheetML on top of `src/lib/zip.ts`) |
| Markdown | A summary for pasting into Jira/Slack/email | `Bun.markdown` isn't needed (a string builder) |
| MP4 | Reproduce/capture/before-after video | ffmpeg (doc 08 §7) |
| ZIP issue package | All artifacts + report + `issue.json` | `zip.ts` |

## 2. ReportModel

One data model is used for every format (`src/reports/model.ts`):

```ts
type ReportModel = {
  meta: { issueKey; title; project; environment; preparedBy; preparedAt; audience: "internal" | "client"; includeCost: boolean };
  answer: { status; evidenceLevel; oneLine: string; rootCause?: string; fix?: string; verification?: string };
  timeline: { at; actor; event }[];
  evidence: { id; level; kind; title; body; ref?; artifactIds: string[] }[];   // private items are skipped if audience=client
  steps: { index; caption; screenshotPath; status; note? }[];                // from the latest capture run
  beforeAfter?: { step; before; after }[];
  qa: { question; answer }[];                                                // from the consultant thread items marked FAQ
  usage?: { byPurpose; byModel; total };                                     // only if includeCost
  caveats: string[];
};
```

Narrative text (`oneLine`, per-section summaries) is composed by Sonnet from the ReportModel, then **you review it in the preview** before the final export.

## 3. PDF report structure

Follows the DESIGN.md Report principles (executive path + audit path):

1. **Masthead**: NSIC's identity (no third-party logo), issue key, environment, date, audience.
2. **The answer, in the first viewport**: a one-sentence status + root cause + evidence level, with the decisive piece of evidence beside it (a key screenshot or a small table).
3. **What happened**: a condensed timeline (full-width table).
4. **Evidence**: sorted by level; each item: title, summary, reference (query/file:line), image if available.
5. **Reproduce steps**: a numbered screenshot grid + captions.
6. **Fix & verification**: a condensed diff (monospace), validate/test results, a before/after table.
7. **Q&A** (optional).
8. **Limitations & notes** (unavailable access, assumptions).
9. **Audit appendix**: artifact list, token usage/cost (if included).

Print settings: A4, 16 mm margins, `printBackground: true`, header/footer containing the issue key + page number
(`displayHeaderFooter` with a small HTML template), images with `break-inside: avoid`.

## 4. XLSX structure

| Sheet | Columns |
|---|---|
| Summary | Field, Value (issue key, title, status, evidence level, root cause, fix, verification, created, closed) |
| Timeline | Time (account timezone), Actor, Event, Detail |
| Evidence | ID, Level, Kind, Title, Summary, Reference, Status, Artifacts |
| Steps | No., Caption, Status, Detected error, Screenshot file |
| Token Usage | Time, Purpose, Model, Input, Output, Cache write, Cache read, Cost USD (omitted if includeCost=false) |

The minimal writer supports: shared strings, numbers, dates (Excel serial), bold headers, freeze pane on row 1,
automatic column width (estimated from text length), autofilter. No formulas/charts in v1.

## 5. Export flow

1. Click **Export** → choose format, audience (internal/client), include cost (yes/no), redacted only (defaults to yes for clients).
2. The `build_report` job builds the ReportModel → narrative → an HTML preview in the UI.
3. You edit the narrative text in the preview (editable fields), then click **Finalize**.
4. The output is stored as an artifact (`report_pdf`, `report_xlsx`, ...) with a version; a download button appears.

## 6. Rules for "client" audience

- Skip evidence marked `private=1`, unredacted artifacts, local file paths, branch names, cost.
- Technical terms get a brief explanation on first mention.
- The same secret filter used by the consultant assistant runs on the final HTML.
