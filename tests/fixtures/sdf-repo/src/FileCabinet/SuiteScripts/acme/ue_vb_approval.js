/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 * @NModuleScope SameAccount
 */
define(['N/record', 'N/log'], (record, log) => {
  const afterSubmit = (context) => {
    if (context.type !== context.UserEventType.APPROVE && context.type !== context.UserEventType.EDIT) return;
    const bill = record.load({ type: record.Type.VENDOR_BILL, id: context.newRecord.id });
    bill.setValue({ fieldId: 'custbody_acme_approved_by', value: context.newRecord.getValue({ fieldId: 'nextapprover' }) });
    bill.setValue({ fieldId: 'custbody_acme_approval_date', value: new Date() });
    bill.save();
    log.audit('approval stamped', context.newRecord.id);
  };
  return { afterSubmit };
});
