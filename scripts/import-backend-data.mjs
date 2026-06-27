import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import mysql from 'mysql2/promise';
import pg from 'pg';

const root = process.cwd();
const backendEnvPath = path.resolve(root, '..', 'backend', '.env');
const localEnvPath = path.resolve(root, '.env.local');

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  for (const rawLine of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const [key, ...rest] = line.replace(/^export\s+/, '').split('=');
    if (!process.env[key]) {
      process.env[key] = rest.join('=').replace(/^["']|["']$/g, '');
    }
  }
}

function loadBackendEnv(file) {
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const rawLine of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const [key, ...rest] = line.replace(/^export\s+/, '').split('=');
    out[key] = rest.join('=').replace(/^["']|["']$/g, '');
  }
  return out;
}

loadEnvFile(localEnvPath);
const backendEnv = loadBackendEnv(backendEnvPath);

const pgConnectionString =
  process.env.DATABASE_URL ||
  `postgres://${encodeURIComponent(process.env.DB_USER || 'invest')}:${encodeURIComponent(
    process.env.DB_PASSWORD || 'zxQQ0817'
  )}@${process.env.DB_HOST || '120.46.220.39'}:${process.env.DB_PORT || '5432'}/${process.env.DB_NAME || 'invest'}`;

const pgPool = new pg.Pool({ connectionString: pgConnectionString });

const mysqlConfig = {
  host: backendEnv.DB_HOST || '127.0.0.1',
  port: Number(backendEnv.DB_PORT || 3306),
  user: backendEnv.DB_USER || 'root',
  password: backendEnv.DB_PASSWORD || '',
  database: backendEnv.DB_NAME || 'invest',
  dateStrings: true
};

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toDateString(value) {
  if (!value) return '';
  return String(value).slice(0, 10);
}

function toTimestamp(value) {
  if (!value) return Date.now();
  const n = new Date(value).getTime();
  return Number.isFinite(n) ? n : Date.now();
}

function cleanCode(code) {
  return String(code || '').trim();
}

function tagId(name) {
  return `backend-${Buffer.from(name).toString('base64url').slice(0, 24)}`;
}

async function ensurePostgresSchema(client) {
  await client.query(`
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
  `);
}

async function importUser(client, user) {
  const result = await client.query(
    `INSERT INTO users (id, username, password_hash, qq_number, created_at, updated_at)
     VALUES ($1, $2, $3, NULLIF($4, ''), COALESCE($5::timestamptz, now()), COALESCE($6::timestamptz, now()))
     ON CONFLICT (username) DO UPDATE
     SET password_hash = EXCLUDED.password_hash,
         qq_number = COALESCE(EXCLUDED.qq_number, users.qq_number),
         updated_at = now()
     RETURNING id`,
    [user.id, user.username, user.password_hash, user.qq_number || '', user.created_at || null, user.updated_at || null]
  );
  await client.query(`SELECT setval(pg_get_serial_sequence('users', 'id'), GREATEST((SELECT MAX(id) FROM users), 1))`);
  return String(result.rows[0].id);
}

async function buildPayload(mysqlConn, userId) {
  const [fundRows] = await mysqlConn.execute(
    `SELECT f.id, f.code, f.name, f.fund_type, f.is_observation, f.sort_order,
            p.money, p.shares, p.cost_nav, p.purchase_date, p.total_realized_earning, p.today_unrealized_earning,
            q.current_nav, q.previous_nav, q.daily_change_percent, q.quote_time, q.net_value_date, q.source
     FROM fund_master f
     LEFT JOIN fund_positions p ON p.fund_id = f.id
     LEFT JOIN fund_quotes q ON q.fund_id = f.id
     WHERE f.user_id = ?
     ORDER BY f.sort_order ASC, f.id ASC`,
    [userId]
  );

  const fundIds = fundRows.map((row) => row.id);
  const fundCodeById = new Map(fundRows.map((row) => [row.id, cleanCode(row.code)]));

  const funds = [];
  const holdings = {};
  const groups = [];
  const favorites = [];

  for (const row of fundRows) {
    const code = cleanCode(row.code);
    if (!code) continue;
    funds.push({
      code,
      name: row.name || code,
      dwjz: row.previous_nav != null ? toNumber(row.previous_nav, null) : undefined,
      gsz: row.current_nav != null ? toNumber(row.current_nav, null) : undefined,
      gszzl: row.daily_change_percent != null ? toNumber(row.daily_change_percent, null) : undefined,
      gztime: row.quote_time || undefined,
      jzrq: toDateString(row.net_value_date) || undefined,
      valuationSource: row.source || undefined
    });
    const share = toNumber(row.shares, 0);
    const cost = toNumber(row.cost_nav, 0);
    if (share || cost) holdings[code] = { share, cost };
    if (!row.is_observation) favorites.push(code);
  }

  const transactions = {};
  const pendingTrades = [];
  if (fundIds.length) {
    const [txnRows] = await mysqlConn.query(
      `SELECT t.id, t.fund_id, t.action, t.shares, t.nav, t.amount, t.fee, t.trade_date, t.confirm_date,
              t.status, t.created_at
       FROM fund_transactions t
       WHERE t.fund_id IN (?)
       ORDER BY t.trade_date ASC, t.id ASC`,
      [fundIds]
    );
    for (const txn of txnRows) {
      const code = fundCodeById.get(txn.fund_id);
      if (!code) continue;
      const type = txn.action === 'clear' ? 'sell' : txn.action;
      const item = {
        id: `backend-txn-${txn.id}`,
        type,
        share: toNumber(txn.shares, 0),
        amount: toNumber(txn.amount, 0),
        price: toNumber(txn.nav, 0),
        feeValue: toNumber(txn.fee, 0),
        feeMode: 'amount',
        date: toDateString(txn.trade_date),
        timestamp: toTimestamp(txn.created_at || txn.trade_date)
      };
      if (txn.status === 'pending') {
        pendingTrades.push({
          id: item.id,
          fundCode: code,
          type,
          share: item.share,
          amount: item.amount,
          feeValue: item.feeValue,
          feeMode: 'amount',
          date: item.date,
          confirmDate: toDateString(txn.confirm_date),
          isAfter3pm: false
        });
      } else if (txn.status === 'confirmed') {
        if (!transactions[code]) transactions[code] = [];
        transactions[code].push(item);
      }
    }

    const [planRows] = await mysqlConn.query(
      `SELECT fund_id, enabled, amount, frequency, day_value, start_date, next_date, last_executed_date
       FROM auto_invest_plans
       WHERE fund_id IN (?)`,
      [fundIds]
    );
    const dcaBucket = {};
    for (const plan of planRows) {
      const code = fundCodeById.get(plan.fund_id);
      if (!code) continue;
      dcaBucket[code] = {
        enabled: Boolean(plan.enabled),
        amount: toNumber(plan.amount, 0),
        cycle: plan.frequency || 'monthly',
        firstDate: toDateString(plan.start_date),
        weeklyDay: plan.frequency === 'weekly' || plan.frequency === 'biweekly' ? toNumber(plan.day_value, 1) : null,
        monthlyDay: plan.frequency === 'monthly' ? toNumber(plan.day_value, 1) : null,
        lastDate: toDateString(plan.last_executed_date || plan.next_date)
      };
    }

    const [tagRows] = await mysqlConn.query(
      `SELECT ft.fund_id, ft.tag_name
       FROM fund_tags ft
       WHERE ft.fund_id IN (?)
       ORDER BY ft.tag_order ASC, ft.id ASC`,
      [fundIds]
    );
    const tagMap = new Map();
    for (const tag of tagRows) {
      const code = fundCodeById.get(tag.fund_id);
      const name = String(tag.tag_name || '').trim();
      if (!code || !name) continue;
      if (!tagMap.has(name)) tagMap.set(name, new Set());
      tagMap.get(name).add(code);
    }

    const tags = [...tagMap.entries()].map(([name, codes]) => ({
      id: tagId(name),
      name,
      theme: 'blue',
      fundCodes: [...codes].sort()
    }));

    const [earningRows] = await mysqlConn.query(
      `SELECT s.snapshot_date, i.fund_code, i.earning, i.amount
       FROM earning_snapshots s
       INNER JOIN earning_snapshot_items i ON i.snapshot_id = s.id
       WHERE s.user_id = ?
       ORDER BY s.snapshot_date ASC`,
      [userId]
    );
    const dailyAll = {};
    for (const row of earningRows) {
      const code = cleanCode(row.fund_code);
      if (!code) continue;
      if (!dailyAll[code]) dailyAll[code] = [];
      dailyAll[code].push({
        date: toDateString(row.snapshot_date),
        earnings: toNumber(row.earning, 0),
        rate: null,
        baseCostAmount: toNumber(row.amount, 0) || null
      });
    }

    return {
      funds,
      favorites,
      groups,
      collapsedCodes: [],
      collapsedTrends: [],
      collapsedValuationTrends: [],
      collapsedEarnings: [],
      refreshMs: 30000,
      holdings,
      groupHoldings: {},
      pendingTrades,
      transactions,
      dcaPlans: { __global__: dcaBucket },
      customSettings: {},
      fundDailyEarnings: { all: dailyAll },
      tags
    };
  }

  return {
    funds,
    favorites,
    groups,
    collapsedCodes: [],
    collapsedTrends: [],
    collapsedValuationTrends: [],
    collapsedEarnings: [],
    refreshMs: 30000,
    holdings,
    groupHoldings: {},
    pendingTrades,
    transactions,
    dcaPlans: { __global__: {} },
    customSettings: {},
    fundDailyEarnings: { all: {} },
    tags: []
  };
}

async function main() {
  const mysqlConn = await mysql.createConnection(mysqlConfig);
  const pgClient = await pgPool.connect();

  try {
    await ensurePostgresSchema(pgClient);
    const [users] = await mysqlConn.execute(
      'SELECT id, username, password_hash, qq_number, created_at, updated_at FROM users ORDER BY id ASC'
    );

    let imported = 0;
    for (const user of users) {
      const pgUserId = await importUser(pgClient, user);
      const payload = await buildPayload(mysqlConn, user.id);
      await pgClient.query(
        `INSERT INTO user_configs (user_id, data, updated_at)
         VALUES ($1, $2::jsonb, now())
         ON CONFLICT (user_id) DO UPDATE
         SET data = EXCLUDED.data,
             updated_at = EXCLUDED.updated_at`,
        [pgUserId, JSON.stringify(payload)]
      );
      imported += 1;
      console.log(`imported ${user.username}: ${payload.funds.length} funds`);
    }

    console.log(`done: imported ${imported} users`);
  } finally {
    pgClient.release();
    await pgPool.end();
    await mysqlConn.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
