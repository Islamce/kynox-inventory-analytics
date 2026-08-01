import type { Knex } from 'knex';

type CanonicalRow = {
  id: number;
  dataset_id: number;
  source_row_number: number | null;
  material_id: string;
  absolute_quantity: number | null;
  unit_of_measure: string | null;
  transaction_date: string;
  transaction_category: string;
  transaction_id: string | null;
  paired_transaction_id: string | null;
  reversal_of_transaction_id: string | null;
};

const rowRef = (id: number) => `canonical:${id}`;
const MAX_CROSS_IMPORT_TRANSFER_DAYS = 31;

const compatible = (a: CanonicalRow, b: CanonicalRow): boolean =>
  a.material_id === b.material_id
  && a.absolute_quantity != null
  && b.absolute_quantity != null
  && Math.abs(a.absolute_quantity - b.absolute_quantity) < 1e-9
  && (!a.unit_of_measure || !b.unit_of_measure || a.unit_of_measure === b.unit_of_measure);

async function clearResolvedFinding(
  trx: Knex.Transaction,
  datasetId: number,
  rowNumber: number | null,
  code: 'TRANSFER_PAIR_NOT_FOUND' | 'REVERSAL_ORIGINAL_NOT_FOUND',
): Promise<void> {
  const dataset = await trx('datasets').where({ id: datasetId }).first('normalization_findings');
  if (!dataset?.normalization_findings) return;
  const findings = JSON.parse(dataset.normalization_findings) as { code?: string; rowNumber?: number | null }[];
  const filtered = findings.filter((f) => !(f.code === code && f.rowNumber === rowNumber));
  if (filtered.length !== findings.length) {
    await trx('datasets').where({ id: datasetId }).update({ normalization_findings: JSON.stringify(filtered) });
  }
}

/**
 * Pairs still-unmatched rows in a newly created dataset with older imports.
 * Company is the tenant boundary when present. For untagged datasets, the
 * creator is the boundary so unrelated users' imports can never be paired.
 */
export async function pairAcrossDatasets(
  trx: Knex.Transaction,
  datasetId: number,
  createdBy: number,
  company: string | null,
): Promise<{ transfers: number; reversals: number }> {
  const scope = trx('canonical_transactions as c')
    .join('datasets as d', 'd.id', 'c.dataset_id')
    .whereNot('c.dataset_id', datasetId)
    .modify((q) => {
      if (company) q.where('d.company', company);
      else q.whereNull('d.company').where('d.created_by', createdBy);
    });

  const current = await trx('canonical_transactions')
    .where({ dataset_id: datasetId })
    .whereIn('transaction_category', ['TRANSFER_IN', 'TRANSFER_OUT', 'REVERSAL_IN', 'REVERSAL_OUT'])
    .select('*') as CanonicalRow[];

  // In-import normalization runs before database IDs exist, so its links use
  // source document numbers. Convert those links to stable canonical IDs now;
  // this also makes already-claimed originals reliably detectable later.
  const localByTransactionId = new Map(
    (await trx('canonical_transactions').where({ dataset_id: datasetId }).select('*') as CanonicalRow[])
      .filter((r) => r.transaction_id)
      .map((r) => [r.transaction_id as string, r]),
  );
  for (const row of current) {
    const paired = row.paired_transaction_id ? localByTransactionId.get(row.paired_transaction_id) : undefined;
    const original = row.reversal_of_transaction_id ? localByTransactionId.get(row.reversal_of_transaction_id) : undefined;
    if (paired || original) {
      await trx('canonical_transactions').where({ id: row.id }).update({
        ...(paired ? { paired_transaction_id: rowRef(paired.id) } : {}),
        ...(original ? { reversal_of_transaction_id: rowRef(original.id) } : {}),
      });
    }
  }

  let transfers = 0;
  let reversals = 0;

  for (const row of current.filter((r) => r.transaction_category.startsWith('TRANSFER_'))) {
    const persisted = await trx('canonical_transactions').where({ id: row.id }).first('transfer_id');
    if (persisted?.transfer_id) continue;
    const opposite = row.transaction_category === 'TRANSFER_OUT' ? 'TRANSFER_IN' : 'TRANSFER_OUT';
    const candidates = await scope.clone()
      .where('c.transaction_category', opposite)
      .whereNull('c.transfer_id')
      .where('c.material_id', row.material_id)
      .where('c.absolute_quantity', row.absolute_quantity)
      .select('c.*') as CanonicalRow[];
    const match = candidates
      .filter((candidate) => compatible(row, candidate))
      .filter((candidate) => Math.abs(
        new Date(candidate.transaction_date).getTime() - new Date(row.transaction_date).getTime(),
      ) <= MAX_CROSS_IMPORT_TRANSFER_DAYS * 86_400_000)
      .sort((a, b) => Math.abs(new Date(a.transaction_date).getTime() - new Date(row.transaction_date).getTime())
        - Math.abs(new Date(b.transaction_date).getTime() - new Date(row.transaction_date).getTime()))[0];
    if (!match) continue;

    const transferId = `XDATA-${Math.min(row.id, match.id)}-${Math.max(row.id, match.id)}`;
    await trx('canonical_transactions').where({ id: row.id }).update({
      transfer_id: transferId, paired_transaction_id: rowRef(match.id),
    });
    await trx('canonical_transactions').where({ id: match.id }).update({
      transfer_id: transferId, paired_transaction_id: rowRef(row.id),
    });
    await clearResolvedFinding(trx, row.dataset_id, row.source_row_number, 'TRANSFER_PAIR_NOT_FOUND');
    await clearResolvedFinding(trx, match.dataset_id, match.source_row_number, 'TRANSFER_PAIR_NOT_FOUND');
    transfers += 1;
  }

  const claimedReferences = await trx('canonical_transactions')
    .whereNotNull('reversal_of_transaction_id')
    .pluck('reversal_of_transaction_id') as string[];
  for (const row of current.filter((r) => r.transaction_category.startsWith('REVERSAL_'))) {
    const persisted = await trx('canonical_transactions').where({ id: row.id }).first('reversal_of_transaction_id');
    if (persisted?.reversal_of_transaction_id) continue;
    const originalCategory = row.transaction_category === 'REVERSAL_OUT' ? 'RECEIPT' : 'CONSUMPTION';
    const candidates = await scope.clone()
      .where('c.transaction_category', originalCategory)
      .where('c.material_id', row.material_id)
      .where('c.absolute_quantity', row.absolute_quantity)
      .where('c.transaction_date', '<=', row.transaction_date)
      .select('c.*') as CanonicalRow[];
    const match = candidates
      .filter((candidate) => compatible(row, candidate))
      .filter((candidate) => !claimedReferences.includes(rowRef(candidate.id)))
      .sort((a, b) => String(b.transaction_date).localeCompare(String(a.transaction_date)))[0];
    if (!match) continue;

    await trx('canonical_transactions').where({ id: row.id })
      .update({ reversal_of_transaction_id: rowRef(match.id) });
    claimedReferences.push(rowRef(match.id));
    await clearResolvedFinding(trx, row.dataset_id, row.source_row_number, 'REVERSAL_ORIGINAL_NOT_FOUND');
    reversals += 1;
  }

  return { transfers, reversals };
}
