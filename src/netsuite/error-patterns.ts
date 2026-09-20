// Starter error pattern library (07 §7). Data, not logic; can grow from resolved issues (FR-24).
// Some match regexes also accept localized phrasing because client reports arrive in multiple languages.
export type ErrorPattern = { code: string; match: RegExp; likelyCause: string; firstSteps: string[] };

export const ERROR_PATTERNS: ErrorPattern[] = [
  { code: "SSS_USAGE_LIMIT_EXCEEDED", match: /SSS_USAGE_LIMIT_EXCEEDED|usage limit/i, likelyCause: "Governance exhausted: record.load/save or search inside a loop.", firstSteps: ["search_code for loops containing record.load/save", "check the script type (UE 1,000 units, Scheduled 10,000, M/R per stage)", "consider Map/Reduce or submitFields"] },
  { code: "SSS_TIME_LIMIT_EXCEEDED", match: /SSS_TIME_LIMIT_EXCEEDED|time limit/i, likelyCause: "A synchronous process runs too long.", firstSteps: ["profile the iteration count and HTTP calls", "move the work to an asynchronous process (M/R, scheduled)"] },
  { code: "RCRD_HAS_BEEN_CHANGED", match: /RCRD_HAS_BEEN_CHANGED|record has been changed/i, likelyCause: "Race condition: several scripts/UEs/workflows load and save the same record.", firstSteps: ["get_record_automation on the record type", "find afterSubmit code that does record.load + save on the same record", "switch to record.submitFields or merge the logic"] },
  { code: "INVALID_FLD_VALUE", match: /INVALID_FLD_VALUE|invalid.*field value/i, likelyCause: "List internal IDs differ between environments, or a value is hardcoded.", firstSteps: ["search_code for hardcoded internal IDs", "compare list values in sandbox vs production"] },
  { code: "USER_ERROR", match: /\bUSER_ERROR\b/, likelyCause: "A custom validation throws an error.", firstSteps: ["search_code for a fragment of the error message", "read the validation condition and the related record data"] },
  { code: "INSUFFICIENT_PERMISSION", match: /INSUFFICIENT_PERMISSION|permission violation|you do not have permission/i, likelyCause: "Deployment execution role, audience, or the user's role permissions.", firstSteps: ["check the deployment runasrole", "check the reporting user's role permissions", "check the deployment audience"] },
  { code: "SSS_MISSING_REQD_ARGUMENT", match: /SSS_MISSING_REQD_ARGUMENT|missing a required argument/i, likelyCause: "An empty API parameter, often from an empty field.", firstSteps: ["find calls to the related module", "check for null values from getValue on empty fields"] },
  { code: "UNEXPECTED_ERROR", match: /UNEXPECTED_ERROR|unexpected error/i, likelyCause: "Varies.", firstSteps: ["get_execution_logs around the timestamp", "get_system_notes for the related record"] },
  { code: "FIELD_NOT_SAVED", match: /field (tidak|not) (muncul|tersimpan|saved|showing)/i, likelyCause: "Form, field-level permission, client script, or sourcing.", firstSteps: ["check which form is used", "check displayType and client script fieldChanged/postSourcing"] },
  { code: "WORKFLOW_NOT_RUNNING", match: /workflow (tidak|not|doesn't) (jalan|run|trigger)/i, likelyCause: "Entry condition, context, or init trigger.", firstSteps: ["read the workflow XML: triggers, conditions, context types", "check the workflow history on the record"] },
];

export function lookupErrorPattern(text: string): ErrorPattern[] {
  return ERROR_PATTERNS.filter((p) => p.match.test(text) || text.toUpperCase().includes(p.code));
}
