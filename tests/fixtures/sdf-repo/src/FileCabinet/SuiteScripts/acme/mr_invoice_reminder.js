/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 */
define(['N/search', 'N/record', 'N/email'], (search, record, email) => {
  const getInputData = () => search.create({ type: 'invoice', filters: [['status', 'anyof', 'CustInvc:A']] });
  const map = (ctx) => {
    const r = JSON.parse(ctx.value);
    for (let i = 0; i < 1000; i++) {
      const inv = record.load({ type: record.Type.INVOICE, id: r.id });
      inv.setValue({ fieldId: 'custbody_acme_reminded', value: true });
      inv.save();
    }
  };
  return { getInputData, map };
});
