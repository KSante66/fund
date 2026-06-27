import { NextResponse } from 'next/server';
import { query } from '@/app/lib/server/db';
import { hashPassword, verifyPassword } from '@/app/lib/server/password';
import { setSessionCookie } from '@/app/lib/server/auth';

export async function POST(request) {
  try {
    const body = await request.json();
    const username = String(body.username || '').trim();
    const password = String(body.password || '');

    if (!username || !password) {
      return NextResponse.json({ error: '请输入账号和密码' }, { status: 400 });
    }
    if (!/^[a-zA-Z0-9_@.-]{2,64}$/.test(username)) {
      return NextResponse.json({ error: '账号只能包含字母、数字、下划线、点、@ 或横线，长度 2-64 位' }, { status: 400 });
    }
    if (password.length < 6) {
      return NextResponse.json({ error: '密码至少 6 位' }, { status: 400 });
    }

    const existing = await query('SELECT id, username, password_hash FROM users WHERE username = $1', [username]);
    let user = existing.rows[0];

    if (user) {
      if (!verifyPassword(password, user.password_hash)) {
        return NextResponse.json({ error: '账号或密码错误' }, { status: 401 });
      }
    } else {
      const created = await query(
        'INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id, username',
        [username, hashPassword(password)]
      );
      user = created.rows[0];
    }

    const session = await setSessionCookie(user, request);
    return NextResponse.json({ session });
  } catch (error) {
    console.error('login failed', error);
    return NextResponse.json({ error: error.message || '登录失败' }, { status: 500 });
  }
}
