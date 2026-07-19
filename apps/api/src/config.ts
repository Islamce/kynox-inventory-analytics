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
  },
  version: '1.0.0',
};
