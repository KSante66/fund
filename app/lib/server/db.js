import 'server-only';
import { Pool } from 'pg';

const connectionString =
  process.env.DATABASE_URL ||
  `postgres://${encodeURIComponent(process.env.DB_USER || 'invest')}:${encodeURIComponent(
    process.env.DB_PASSWORD || 'zxQQ0817'
  )}@${process.env.DB_HOST || '120.46.220.39'}:${process.env.DB_PORT || '5432'}/${process.env.DB_NAME || 'invest'}`;

const globalForDb = globalThis;

export const pool =
  globalForDb.__investNotesPool ||
  new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 8000
  });

if (process.env.NODE_ENV !== 'production') {
  globalForDb.__investNotesPool = pool;
}

let schemaReady;

export async function ensureSchema() {
  if (!schemaReady) {
    schemaReady = pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id BIGSERIAL PRIMARY KEY,
        username VARCHAR(64) NOT NULL UNIQUE,
        password_hash VARCHAR(128) NOT NULL,
        qq_number VARCHAR(32) UNIQUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS user_configs (
        id BIGSERIAL PRIMARY KEY,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        data JSONB NOT NULL DEFAULT '{}'::jsonb,
        updated_at TIMESTAMPTZ,
        user_id TEXT NOT NULL UNIQUE,
        last_device_id TEXT,
        ytd_return_rate NUMERIC
      );

      CREATE INDEX IF NOT EXISTS idx_user_configs_ytd_return_rate
        ON user_configs (ytd_return_rate);

      CREATE TABLE IF NOT EXISTS fund_related (
        id BIGSERIAL PRIMARY KEY,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        fund_code VARCHAR(32) UNIQUE,
        related_sector TEXT
      );

      CREATE TABLE IF NOT EXISTS fund_secid (
        id BIGSERIAL PRIMARY KEY,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        related_sector TEXT,
        secid VARCHAR(64)
      );

      CREATE TABLE IF NOT EXISTS fund_topic (
        id BIGSERIAL PRIMARY KEY,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        update_at TIMESTAMPTZ,
        sector_type TEXT,
        sector_id TEXT UNIQUE,
        sector_name TEXT UNIQUE,
        update_frequency TEXT,
        net_inflow BIGINT,
        change_pct REAL
      );

      CREATE TABLE IF NOT EXISTS ocr_daily_usage (
        id BIGSERIAL PRIMARY KEY,
        user_id TEXT NOT NULL,
        usage_date DATE NOT NULL DEFAULT CURRENT_DATE,
        count INT NOT NULL DEFAULT 0,
        UNIQUE (user_id, usage_date)
      );

      CREATE TABLE IF NOT EXISTS gs_qdii (
        fund_code VARCHAR(32) PRIMARY KEY,
        gztime TEXT,
        gszzl NUMERIC,
        gzstatus TEXT,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
  }
  return schemaReady;
}

export async function query(text, params = []) {
  await ensureSchema();
  return pool.query(text, params);
}
