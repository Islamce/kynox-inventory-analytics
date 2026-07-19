import crypto from 'crypto';
import { db } from '../db';
import { logger } from '../logger';

export interface AuditEntry {
  userId?: number | null;
  action: string;
  entityType?: string;
  entityId?: string | number;
  prevValue?: unknown;
  newValue?: unknown;
  sourceIp?: string;
  result?: 'success' | 'failure';
  correlationId?: string;
}

/**
 * Append-only audit trail. Failures to write audit records are logged but
 * never crash the business operation; secrets are never accepted here.
 */
export async function audit(entry: AuditEntry): Promise<void> {
  try {
    await db('audit_log').insert({
      user_id: entry.userId ?? null,
      action: entry.action,
      entity_type: entry.entityType ?? null,
      entity_id: entry.entityId != null ? String(entry.entityId) : null,
      prev_value: entry.prevValue !== undefined ? JSON.stringify(entry.prevValue) : null,
      new_value: entry.newValue !== undefined ? JSON.stringify(entry.newValue) : null,
      source_ip: entry.sourceIp ?? null,
      result: entry.result ?? 'success',
      correlation_id: entry.correlationId ?? crypto.randomUUID(),
    });
  } catch (err) {
    logger.error({ err, action: entry.action }, 'Failed to write audit record');
  }
}
