'use strict';

/**
 * Archive a contract created by mistake (voiding its invoices) and optionally
 * restore the kept contract's end date.
 *   POST /v1/contracts/archive        https://docs.metronome.com/api-reference/contracts/archive-a-contract
 *   POST /v1/contracts/updateEndDate  https://docs.metronome.com/api-reference/contracts/update-the-contract-end-date
 * Refuses when any invoice on the accidental contract is FINALIZED or synced
 * to an external billing provider: void_invoices never refunds Stripe.
 */

const rt = require('./lib/runtime');
const mx = require('./lib/metronome');

function invoiceContractId(invoice) {
  return invoice.contract_id || invoice.contract?.id || null;
}

function externalInvoiceRef(invoice) {
  return invoice.external_invoice?.id || invoice.external_invoice?.invoice_id || invoice.external_invoice?.external_status || null;
}

function findArchiveSafetyBlockers(archiveContractId, invoices) {
  const blockers = [];
  const onContract = invoices.filter((inv) => invoiceContractId(inv) === archiveContractId);
  for (const invoice of onContract) {
    const ext = externalInvoiceRef(invoice);
    if (ext) blockers.push({ code: 'accidental_contract_invoice_has_external_sync', invoice_id: invoice.id, external_ref: ext, status: invoice.status });
    if (invoice.status === 'FINALIZED') blockers.push({ code: 'accidental_contract_invoice_finalized', invoice_id: invoice.id, total: invoice.total });
  }
  return { blockers, onContract };
}

// https://docs.metronome.com/api-reference/invoices/list-invoices
async function listInvoices(client, customerId) {
  return mx.listPaginated(client, 'get', `/v1/customers/${customerId}/invoices`);
}

const contractRepairAccidental = rt.defineOp({
  name: 'contract-repair-accidental',
  command: 'metro contract repair-accidental',
  async preflight(ctx) {
    const archiveId = rt.readString(ctx.flags, 'archive-contract-id');
    const keepId = rt.readString(ctx.flags, 'keep-contract-id');
    const reason = rt.readString(ctx.flags, 'reason');
    const restore = rt.requireHourBoundary('--restore-ending-before', rt.readString(ctx.flags, 'restore-ending-before'));
    if (!archiveId || !keepId || !reason) {
      throw rt.usageError('Usage: metro contract repair-accidental preflight --archive-contract-id=<id> --keep-contract-id=<id> --reason="<why>" (--customer-id=|--external-id=|--ingest-alias=|--name=) [--restore-ending-before=<ISO>] (--sandbox|--prod)');
    }
    if (archiveId === keepId) throw rt.usageError('--archive-contract-id and --keep-contract-id must differ.');

    const { customer } = await mx.resolveOneCustomer(ctx.client, ctx.flags);
    const [contracts, invoices] = await Promise.all([
      mx.listContracts(ctx.client, customer.id, { includeArchived: true }),
      listInvoices(ctx.client, customer.id),
    ]);
    const archive = contracts.find((c) => c.id === archiveId) || null;
    const keep = contracts.find((c) => c.id === keepId) || null;
    const blockers = [];
    if (!archive) blockers.push({ code: 'archive_contract_not_found', contract_id: archiveId });
    if (!keep) blockers.push({ code: 'keep_contract_not_found', contract_id: keepId });
    if (archive?.archived_at) blockers.push({ code: 'archive_contract_already_archived', archived_at: archive.archived_at });
    if (keep?.archived_at) blockers.push({ code: 'keep_contract_already_archived', archived_at: keep.archived_at });
    let safety = { blockers: [], onContract: [] };
    if (archive && !archive.archived_at) {
      safety = findArchiveSafetyBlockers(archiveId, invoices);
      blockers.push(...safety.blockers);
    }
    if (blockers.length) throw rt.blocked(blockers);

    const steps = [{
      id: 'archive',
      method: 'POST',
      path: '/v1/contracts/archive',
      body: { customer_id: customer.id, contract_id: archiveId, void_invoices: true },
    }];
    const diff = [{ field: `contract ${archiveId}.archived_at`, from: null, to: '(now)' }];
    if (restore) {
      steps.push({
        id: 'restoreEndDate',
        method: 'POST',
        path: '/v1/contracts/updateEndDate',
        body: { customer_id: customer.id, contract_id: keepId, ending_before: restore, allow_ending_before_finalized_invoice: false },
      });
      diff.push({ field: `contract ${keepId}.ending_before`, from: keep.ending_before || null, to: restore });
    }
    return {
      slug: customer.id.slice(0, 8),
      summary: {
        customer: mx.summarizeCustomer(customer),
        reason,
        invoicesVoided: safety.onContract.map((i) => ({ id: i.id, status: i.status, total: i.total })),
      },
      diff,
      steps,
      expect: { customer_id: customer.id, archive_contract_id: archiveId, keep_contract_id: keepId, keep_ending_before: restore },
    };
  },
  async verify(ctx, plan) {
    const e = plan.expect;
    const rows = await mx.listContracts(ctx.client, e.customer_id, { includeArchived: true });
    const archived = rows.find((c) => c.id === e.archive_contract_id);
    const kept = rows.find((c) => c.id === e.keep_contract_id);
    const checks = [
      rt.check('archived contract has archived_at', true, Boolean(archived?.archived_at)),
      rt.check('kept contract is not archived', true, Boolean(kept) && !kept.archived_at),
    ];
    if (e.keep_ending_before) {
      checks.push(rt.check('kept contract ending_before', e.keep_ending_before, kept?.ending_before, { compare: 'instant' }));
    }
    return checks;
  },
});

module.exports = { contractRepairAccidental, findArchiveSafetyBlockers };
