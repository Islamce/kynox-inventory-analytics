import fs from 'fs';
import path from 'path';
import { config } from '../config';
import { db } from '../db';
import { logger } from '../logger';

/**
 * Retention cleanup for uploaded source files and generated exports.
 *
 * - Exports older than `exportRetentionDays` are deleted (they can always be
 *   regenerated from the dataset).
 * - Uploads older than `uploadRetentionDays` are deleted ONLY when no dataset
 *   references them — source files backing a dataset are the traceability
 *   record and are never removed automatically.
 * - Datasets and uploads created by the anonymous 'guest' role (PUBLIC_DEMO_MODE)
 *   older than `guestDataRetentionHours` are deleted outright, unlike real
 *   uploads — anonymous demo data is not a traceability record worth keeping,
 *   and this bounds storage growth on a signup-free public endpoint. The
 *   guest `users` row itself is intentionally NEVER deleted here: it is the
 *   audit trail of that demo session (referenced by audit_log), which is the
 *   whole point of using a real user row for guests in the first place.
 *   Runs regardless of the current PUBLIC_DEMO_MODE setting, so any data left
 *   over from a period when it was on still gets purged after it's turned off.
 */
export async function runCleanup(): Promise<{
  exportsDeleted: number; uploadsDeleted: number; guestDatasetsDeleted: number; guestUploadsDeleted: number;
}> {
  let exportsDeleted = 0;
  let uploadsDeleted = 0;
  let guestDatasetsDeleted = 0;
  let guestUploadsDeleted = 0;
  const now = Date.now();

  try {
    const exportCutoff = now - config.exportRetentionDays * 86_400_000;
    for (const file of fs.existsSync(config.exportDir) ? fs.readdirSync(config.exportDir) : []) {
      if (file === '.gitkeep') continue;
      const full = path.join(config.exportDir, file);
      const stat = fs.statSync(full);
      if (stat.isFile() && stat.mtimeMs < exportCutoff) {
        fs.unlinkSync(full);
        exportsDeleted += 1;
      }
    }

    const uploadCutoff = new Date(now - config.uploadRetentionDays * 86_400_000);
    const oldUploads = await db('uploads').where('created_at', '<', uploadCutoff);
    const datasets = await db('datasets').select('source_upload_ids');
    const referenced = new Set<number>();
    for (const d of datasets) {
      for (const id of JSON.parse(d.source_upload_ids ?? '[]') as number[]) referenced.add(id);
    }
    for (const up of oldUploads) {
      if (referenced.has(up.id)) continue;
      const full = path.join(config.uploadDir, up.stored_name);
      if (fs.existsSync(full)) fs.unlinkSync(full);
      await db('uploads').where({ id: up.id }).delete();
      uploadsDeleted += 1;
    }

    const guestCutoff = new Date(now - config.guestDataRetentionHours * 3600_000);
    const oldGuestDatasets = await db('datasets')
      .join('users', 'datasets.created_by', 'users.id')
      .where('users.role', 'guest')
      .andWhere('datasets.created_at', '<', guestCutoff)
      .select('datasets.id');
    for (const d of oldGuestDatasets) {
      // Cascades to stock_items/movements/canonical_transactions/etc.
      await db('datasets').where({ id: d.id }).delete();
      guestDatasetsDeleted += 1;
    }

    const oldGuestUploads = await db('uploads')
      .join('users', 'uploads.user_id', 'users.id')
      .where('users.role', 'guest')
      .andWhere('uploads.created_at', '<', guestCutoff)
      .select('uploads.id', 'uploads.stored_name');
    for (const up of oldGuestUploads) {
      const full = path.join(config.uploadDir, up.stored_name);
      if (fs.existsSync(full)) fs.unlinkSync(full);
      await db('uploads').where({ id: up.id }).delete();
      guestUploadsDeleted += 1;
    }
  } catch (err) {
    logger.error({ err }, 'Cleanup job failed');
  }

  if (exportsDeleted > 0 || uploadsDeleted > 0 || guestDatasetsDeleted > 0 || guestUploadsDeleted > 0) {
    logger.info({ exportsDeleted, uploadsDeleted, guestDatasetsDeleted, guestUploadsDeleted }, 'Retention cleanup completed');
  }
  return { exportsDeleted, uploadsDeleted, guestDatasetsDeleted, guestUploadsDeleted };
}

let timer: NodeJS.Timeout | null = null;

/** Runs cleanup shortly after start, then every 24 hours. */
export function startCleanupSchedule(): void {
  if (timer) return;
  setTimeout(() => void runCleanup(), 60_000).unref();
  timer = setInterval(() => void runCleanup(), 24 * 3600_000);
  timer.unref();
}
