import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../../../.env'), quiet: true });

const required = (name: string, fallbackForDev?: string): string => {
  const v = process.env[name];
  if (v) return v;
  if (process.env.NODE_ENV !== 'production' && fallbackForDev !== undefined) return fallbackForDev;
  throw new Error(`Missing required environment variable ${name}`);
};

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 4000),
  jwtSecret: required('JWT_SECRET', 'dev-only-secret-change-me'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '8h',
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  uploadDir: process.env.UPLOAD_DIR || path.resolve(__dirname, '../../../uploads'),
  exportDir: process.env.EXPORT_DIR || path.resolve(__dirname, '../../../exports'),
  maxUploadMb: Number(process.env.MAX_UPLOAD_MB || 50),
  ai: {
    provider: (process.env.AI_PROVIDER || 'none') as 'anthropic' | 'openai' | 'none',
    model: process.env.AI_MODEL || undefined,
    apiKey: process.env.AI_PROVIDER === 'openai' ? process.env.OPENAI_API_KEY : process.env.ANTHROPIC_API_KEY,
    baseUrl: process.env.AI_BASE_URL || undefined,
    // Governed runtime limits (all overridable per environment):
    maxPromptChars: Number(process.env.AI_MAX_PROMPT_CHARS || 2000),
    maxEvidenceRecords: Number(process.env.AI_MAX_EVIDENCE_RECORDS || 40),
    maxResponseTokens: Number(process.env.AI_MAX_RESPONSE_TOKENS || 4096),
    timeoutMs: Number(process.env.AI_TIMEOUT_MS || 60_000),
    retries: Number(process.env.AI_RETRY_COUNT || 1),
    userDailyLimit: Number(process.env.AI_USER_DAILY_LIMIT || 50),
    orgDailyLimit: Number(process.env.AI_ORG_DAILY_LIMIT || 500),
    orgDailyTokenLimit: Number(process.env.AI_ORG_DAILY_TOKEN_LIMIT || 2_000_000),
  },
  version: '1.0.0',
  /** Days after which orphaned uploads / generated exports are deleted by the cleanup job. */
  uploadRetentionDays: Number(process.env.UPLOAD_RETENTION_DAYS || 90),
  exportRetentionDays: Number(process.env.EXPORT_RETENTION_DAYS || 14),
  /**
   * In-process retention timer. On managed hosting (Hostinger) the process may
   * not stay alive continuously, so this is best-effort only. Set
   * ENABLE_INPROCESS_CLEANUP=false and trigger POST /api/maintenance/cleanup
   * from an external scheduler (GitHub Actions) for reliable cleanup.
   */
  enableInProcessCleanup: (process.env.ENABLE_INPROCESS_CLEANUP || 'true') !== 'false',
  /** Shared secret for the external maintenance endpoint; disabled when unset. */
  maintenanceToken: process.env.MAINTENANCE_TOKEN || '',
  /**
   * When true, requests with no Authorization header are treated as an
   * anonymous 'guest' identity instead of getting a 401 (see
   * middleware/auth.ts). Intended for a public marketing/demo deployment.
   * Off by default — never enable this against a database containing real
   * business data without also reviewing docs/PUBLIC_DEMO_MODE.md.
   */
  publicDemoMode: (process.env.PUBLIC_DEMO_MODE || 'false') === 'true',
  /** Guest-created datasets/uploads older than this are purged by the retention cleanup job. */
  guestDataRetentionHours: Number(process.env.GUEST_DATA_RETENTION_HOURS || 48),
};

/**
 * Production startup validation. The application refuses to start in
 * production when critical variables are missing or unsafe, instead of
 * limping along with development defaults.
 */
export function validateProductionConfig(): string[] {
  const problems: string[] = [];
  if (process.env.NODE_ENV !== 'production') return problems;

  if (!process.env.JWT_SECRET) {
    problems.push('JWT_SECRET is not set.');
  } else if (process.env.JWT_SECRET.length < 32) {
    problems.push('JWT_SECRET is shorter than 32 characters; generate one with: openssl rand -base64 48');
  }
  const client = process.env.DB_CLIENT || 'better-sqlite3';
  if (client === 'better-sqlite3') {
    problems.push('DB_CLIENT=better-sqlite3 is not supported in production; use pg or mysql2.');
  } else if (client === 'pg' || client === 'mysql2') {
    for (const v of ['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASSWORD']) {
      if (!process.env[v]) problems.push(`${v} is not set (required for DB_CLIENT=${client}).`);
    }
  } else {
    problems.push(`Unsupported DB_CLIENT '${client}'.`);
  }
  if (!process.env.CORS_ORIGIN) {
    problems.push('CORS_ORIGIN is not set; set it to https://analytics.kynox.io');
  }
  return problems;
}
