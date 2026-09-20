/**
 * @NApiVersion 2.1
 * @NScriptType ClientScript
 */
define(['N/currentRecord'], (currentRecord) => {
  function fieldChanged(context) {
    if (context.fieldId !== 'custbody_acme_discount') return;
    const rec = context.currentRecord;
    const d = rec.getValue({ fieldId: 'custbody_acme_discount' });
    rec.setValue({ fieldId: 'discountrate', value: -d });
  }
  function saveRecord(context) { return true; }
  return { fieldChanged, saveRecord };
});
