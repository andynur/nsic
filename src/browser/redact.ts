// Visual redaction (08 §6): blur selector + text patterns, applied BEFORE screenshot/frame.
export const DEFAULT_REDACT_PATTERNS = [
  "[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}", // email
  "\\b(?:\\d[ -]?){13,19}\\b", // long card / account number
  "(?:\\+?\\d{1,3}[ -]?)?\\(?\\d{2,4}\\)?[ -]?\\d{3,4}[ -]?\\d{3,4}", // phone
];

export const DEFAULT_REDACT_SELECTORS = ["input[type=password]", "#email", ".uir-field-name-email", "[id$='email_fs']", "[id$='phone_fs']"];

export function redactScript(selectors: string[], patterns: string[]): string {
  const sel = JSON.stringify(selectors);
  const pat = JSON.stringify(patterns);
  return `(() => {
    const sels = ${sel}; const pats = ${pat};
    let st = document.getElementById('__nsic_redact');
    if (!st) { st = document.createElement('style'); st.id = '__nsic_redact'; document.documentElement.appendChild(st); }
    st.textContent = sels.map(s => s + '{filter:blur(6px)!important}').join('\\n') + '.__nsic_blur{filter:blur(6px)!important}';
    if (!pats.length || !document.body) return 0;
    const re = new RegExp(pats.map(p => '(?:' + p + ')').join('|'), 'g');
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, { acceptNode: (n) => n.parentElement && !['SCRIPT','STYLE'].includes(n.parentElement.tagName) && !n.parentElement.classList.contains('__nsic_blur') ? 1 : 2 });
    const hits = []; let n; while ((n = walker.nextNode())) { re.lastIndex = 0; if (re.test(n.nodeValue)) hits.push(n); }
    for (const t of hits) { const span = document.createElement('span'); span.className = '__nsic_blur'; span.textContent = t.nodeValue; t.parentNode.replaceChild(span, t); }
    for (const i of document.querySelectorAll('input,textarea')) { re.lastIndex = 0; if (re.test(i.value)) i.classList.add('__nsic_blur'); }
    return hits.length;
  })()`;
}
