import { NextResponse } from 'next/server';
import { query } from '@/app/lib/server/db';
import { requireUser } from '@/app/lib/server/auth';

async function updateUserConfig(userId, payload, deviceId, forceTakeover, merge) {
  const current = await query('SELECT data, last_device_id FROM user_configs WHERE user_id = $1', [userId]);
  const currentRow = current.rows[0];
  if (
    currentRow?.last_device_id &&
    deviceId &&
    currentRow.last_device_id !== deviceId &&
    forceTakeover !== true
  ) {
    return { data: null, error: { message: 'DEVICE_CONFLICT: Logged in on another device' } };
  }

  const nextData = merge ? { ...(currentRow?.data || {}), ...(payload || {}) } : payload || {};
  const ytdRate = Number(nextData.ytdReturnRate);
  await query(
    `INSERT INTO user_configs (user_id, data, updated_at, last_device_id, ytd_return_rate)
     VALUES ($1, $2::jsonb, now(), $3, $4)
     ON CONFLICT (user_id) DO UPDATE
     SET data = EXCLUDED.data,
         updated_at = EXCLUDED.updated_at,
         last_device_id = COALESCE(EXCLUDED.last_device_id, user_configs.last_device_id),
         ytd_return_rate = COALESCE(EXCLUDED.ytd_return_rate, user_configs.ytd_return_rate)`,
    [userId, JSON.stringify(nextData), deviceId || null, Number.isFinite(ytdRate) ? ytdRate : null]
  );
  return { data: null, error: null };
}

async function getFundRecommendedTags(fundCode) {
  const code = String(fundCode || '').trim();
  if (!code) return [];

  const result = await query(
    `SELECT
       COALESCE(NULLIF(ft.sector_name, ''), NULLIF(fr.related_sector, '')) AS topic,
       COALESCE(NULLIF(ft.sector_id, ''), NULLIF(fs.secid, ''), NULLIF(fr.related_sector, '')) AS sector_id
     FROM fund_related fr
     LEFT JOIN fund_topic ft ON ft.sector_name = fr.related_sector
     LEFT JOIN fund_secid fs ON fs.related_sector = fr.related_sector
     WHERE fr.fund_code = $1
       AND NULLIF(fr.related_sector, '') IS NOT NULL
     LIMIT 1`,
    [code]
  );

  return result.rows.filter((row) => row.topic && row.sector_id);
}

export async function POST(request) {
  try {
    const body = await request.json();
    const fn = String(body.fn || '');
    const args = body.args || {};
    const user = await requireUser();

    if (fn === 'update_user_config_partial') {
      return NextResponse.json(
        await updateUserConfig(user.id, args.payload, args.p_last_device_id, args.p_force_takeover, true)
      );
    }

    if (fn === 'update_user_config_full') {
      return NextResponse.json(
        await updateUserConfig(user.id, args.payload, args.p_last_device_id, args.p_force_takeover, false)
      );
    }

    if (fn === 'get_ytd_percentile') {
      const rate = Number(args.p_ytd_rate);
      if (!Number.isFinite(rate)) return NextResponse.json({ data: -1, error: null });
      const result = await query(
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE ytd_return_rate < $2)::int AS beat
         FROM user_configs
         WHERE user_id <> $1 AND ytd_return_rate IS NOT NULL`,
        [user.id, rate]
      );
      const { total, beat } = result.rows[0] || { total: 0, beat: 0 };
      const data = total < 10 ? -1 : Math.round((beat / total) * 10000) / 100;
      return NextResponse.json({ data, error: null });
    }

    if (fn === 'get_fund_recommended_tags') {
      return NextResponse.json({ data: await getFundRecommendedTags(args.p_fund_code), error: null });
    }

    if (fn === 'get_fund_best_source') {
      return NextResponse.json({ data: null, error: null });
    }

    return NextResponse.json({ data: null, error: { message: 'RPC 不支持' } }, { status: 400 });
  } catch (error) {
    console.error('rpc failed', error);
    return NextResponse.json({ data: null, error: { message: error.message || 'RPC 失败' } }, { status: error.status || 500 });
  }
}
