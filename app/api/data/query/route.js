import { NextResponse } from 'next/server';
import { query } from '@/app/lib/server/db';
import { requireUser } from '@/app/lib/server/auth';

const PUBLIC_TABLES = new Set(['fund_related', 'fund_secid', 'fund_topic', 'gs_qdii']);
const PRIVATE_TABLES = new Set(['user_configs', 'ocr_daily_usage']);

const TABLE_COLUMNS = {
  user_configs: new Set(['id', 'data', 'updated_at', 'user_id', 'last_device_id', 'ytd_return_rate']),
  fund_related: new Set(['fund_code', 'related_sector']),
  fund_secid: new Set(['related_sector', 'secid']),
  fund_topic: new Set(['*', 'id', 'sector_type', 'sector_id', 'sector_name', 'net_inflow', 'change_pct', 'update_at']),
  ocr_daily_usage: new Set(['count']),
  gs_qdii: new Set(['fund_code', 'gztime', 'gszzl', 'gzstatus'])
};

function parseColumns(table, columns) {
  if (!columns || columns === '*') return '*';
  const allowed = TABLE_COLUMNS[table] || new Set();
  return String(columns)
    .split(',')
    .map((column) => column.trim())
    .filter((column) => allowed.has(column))
    .join(', ');
}

function errorResponse(error) {
  const status = error.status || 500;
  return NextResponse.json({ error: error.message || '请求失败' }, { status });
}

export async function POST(request) {
  try {
    const body = await request.json();
    const table = String(body.table || '');
    const action = String(body.action || 'select');
    if (!PUBLIC_TABLES.has(table) && !PRIVATE_TABLES.has(table)) {
      return NextResponse.json({ error: '表不允许访问' }, { status: 400 });
    }

    let user = null;
    if (PRIVATE_TABLES.has(table)) user = await requireUser();

    if (action === 'insert' && table === 'user_configs') {
      await query(
        `INSERT INTO user_configs (user_id, data, updated_at)
         VALUES ($1, '{}'::jsonb, now())
         ON CONFLICT (user_id) DO NOTHING`,
        [user.id]
      );
      return NextResponse.json({ data: null, error: null });
    }

    if (action !== 'select') {
      return NextResponse.json({ error: '操作不支持' }, { status: 400 });
    }

    const selectList = parseColumns(table, body.columns);
    if (!selectList) return NextResponse.json({ error: '字段不允许访问' }, { status: 400 });

    const where = [];
    const params = [];
    const addParam = (value) => {
      params.push(value);
      return `$${params.length}`;
    };

    if (table === 'user_configs') {
      where.push(`user_id = ${addParam(user.id)}`);
    }
    if (table === 'ocr_daily_usage') {
      where.push(`user_id = ${addParam(user.id)}`);
    }

    for (const filter of body.filters || []) {
      const column = String(filter.column || '');
      if (!(TABLE_COLUMNS[table] || new Set()).has(column)) continue;
      if (column === 'user_id') continue;
      where.push(`${column} = ${addParam(filter.value)}`);
    }

    for (const filter of body.inFilters || []) {
      const column = String(filter.column || '');
      if (!(TABLE_COLUMNS[table] || new Set()).has(column)) continue;
      const values = Array.isArray(filter.values) ? filter.values : [];
      if (!values.length) {
        where.push('false');
        continue;
      }
      where.push(`${column} = ANY(${addParam(values)})`);
    }

    const sql = `SELECT ${selectList} FROM ${table}${where.length ? ` WHERE ${where.join(' AND ')}` : ''}`;
    const result = await query(sql, params);
    const data = body.maybeSingle ? result.rows[0] || null : result.rows;
    return NextResponse.json({ data, error: null });
  } catch (error) {
    console.error('data query failed', error);
    return errorResponse(error);
  }
}
