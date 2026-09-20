// JS expressions evaluated on the page. Read-only functions only (allowlist 08 §3 'evaluate').
import type { StepTarget } from "./dsl.ts";

/** Locate the target element and return info + click point (no side effects). */
export function locateScript(t: StepTarget): string {
  return `(() => {
    const t = ${JSON.stringify(t)};
    let cands = [];
    if (t.selector) cands = [...document.querySelectorAll(t.selector)];
    else if (t.field) {
      const f = t.field;
      cands = [...document.querySelectorAll('#' + CSS.escape(f) + '_fs, [name="' + f + '"], #' + CSS.escape(f) + ', #' + CSS.escape(f) + '_display, #inpt_' + CSS.escape(f))];
    } else if (t.text) {
      const roleSel = { button: 'button, input[type=button], input[type=submit], [role=button], a.pgBntG, .uir-button', link: 'a', tab: '[role=tab], .formtabtext, a[id$=txt]', menuitem: '[role=menuitem], .ns-menuitem', checkbox: 'input[type=checkbox]', row: 'tr' }[t.role || 'button'] || '*';
      const want = t.text.trim().toLowerCase();
      cands = [...document.querySelectorAll(roleSel)].filter(e => ((e.innerText || e.value || e.getAttribute('aria-label') || '').trim().toLowerCase().replace(/\\s+/g,' ')) === want);
      if (!cands.length) cands = [...document.querySelectorAll(roleSel)].filter(e => ((e.innerText || e.value || '').toLowerCase()).includes(want));
    }
    cands = cands.filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
    const el = cands[t.nth || 0];
    if (!el) return null;
    el.scrollIntoView({ block: 'center', inline: 'center' });
    const r = el.getBoundingClientRect();
    const form = !!el.closest('form');
    return { id: el.id || null, name: el.getAttribute('name'), text: (el.innerText || '').trim().slice(0, 120), value: (el.value || '').toString().slice(0, 120), tag: el.tagName.toLowerCase(), type: el.getAttribute('type'), href: el.getAttribute('href'), form, x: r.left + r.width / 2, y: r.top + r.height / 2, rect: { x: r.left, y: r.top, w: r.width, h: r.height } };
  })()`;
}

export const highlightScript = (rect: { x: number; y: number; w: number; h: number }, label: string) => `(() => {
  const d = document.createElement('div'); d.id = '__nsic_hl';
  d.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;border:2px solid #0068D6;border-radius:4px;left:${rect.x - 3}px;top:${rect.y - 3}px;width:${rect.w + 6}px;height:${rect.h + 6}px';
  const b = document.createElement('span'); b.textContent = ${JSON.stringify(label)};
  b.style.cssText = 'position:absolute;left:-2px;top:-22px;background:#0068D6;color:#fff;font:500 12px/18px system-ui;padding:1px 6px;border-radius:4px';
  d.appendChild(b); document.body.appendChild(d); return true; })()`;

export const unhighlightScript = `(() => { document.getElementById('__nsic_hl')?.remove(); return true; })()`;

/** NetSuite error messages shown on the page (banner, alert box, error page). */
export const readPageErrorsScript = `(() => {
  const out = [];
  for (const s of ['.uir-alert-box.error', '.uir-alert-box', '#div__alert', '.error-message', '.errortextheading', '.uir-message-error', 'td.errortext', '.alertmessage']) {
    for (const e of document.querySelectorAll(s)) { const t = (e.innerText || '').trim(); if (t) out.push(t.slice(0, 500)); }
  }
  const body = (document.body && document.body.innerText) || '';
  const codes = body.match(/\\b(SSS_[A-Z_]+|RCRD_[A-Z_]+|INVALID_[A-Z_]+|USER_ERROR|UNEXPECTED_ERROR|INSUFFICIENT_PERMISSION)\\b/g) || [];
  const dialogs = (window.__nsicDialogs || []).slice();
  return { messages: [...new Set(out)], codes: [...new Set(codes)], dialogs, title: document.title };
})()`;

export const READ_FNS: Record<string, (args: Record<string, unknown>) => string> = {
  readField: (a) => `(() => { const f = ${JSON.stringify(String(a.field ?? ""))}; const e = document.querySelector('#' + CSS.escape(f) + '_fs_lbl_uir_label') ? document.querySelector('#' + CSS.escape(f) + '_fs') : (document.querySelector('[name="' + f + '"]') || document.getElementById(f)); if (!e) return null; return { text: (e.innerText || '').trim().slice(0, 500), value: e.value ?? null }; })()`,
  readSublist: (a) => `(() => { const id = ${JSON.stringify(String(a.sublist ?? "item"))}; const t = document.getElementById(id + '_splits') || document.getElementById(id + '_div'); if (!t) return null; return [...t.querySelectorAll('tr')].slice(0, 60).map(r => [...r.querySelectorAll('td')].map(c => (c.innerText || '').trim().slice(0, 80))); })()`,
  readUrl: () => `(() => location.href)()`,
  readPageErrors: () => readPageErrorsScript,
};

export const DIALOG_CAPTURE_SCRIPT = `(() => { if (window.__nsicDialogCap) return; window.__nsicDialogCap = true; window.__nsicDialogs = [];
  const oa = window.alert; window.alert = (m) => { window.__nsicDialogs.push({ type: 'alert', message: String(m).slice(0, 500) }); };
  void oa; })();`;

export const LOADING_IDLE_SCRIPT = `(() => { const busy = document.querySelector('.uir-page-loading, #nsLoading, .ns-loading-indicator:not([style*="none"])'); return document.readyState === 'complete' && !busy; })()`;
