/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
define(['N/record', 'N/search', 'N/https'], (record, search, https) => {
  function afterSubmit(context) {
    const id = context.newRecord.id;
    const status = context.newRecord.getValue({ fieldId: 'approvalstatus' });
    if (String(status) !== '2') return;
    const bill = record.load({ type: record.Type.VENDOR_BILL, id });
    bill.setValue({ fieldId: 'custbody_acme_ap_synced', value: true });
    bill.save({ ignoreMandatoryFields: true });
    https.post({ url: 'https://ap.example.com/sync', body: JSON.stringify({ id }) });
  }
  function beforeSubmit(context) {
    const amt = context.newRecord.getValue({ fieldId: 'usertotal' });
    if (amt > 100000 && !context.newRecord.getValue({ fieldId: 'custbody_acme_cfo_ok' })) {
      throw new Error('USER_ERROR: Bill over 100,000 requires CFO approval');
    }
  }
  return { beforeSubmit: beforeSubmit, afterSubmit: afterSubmit };
});
