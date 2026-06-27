import 'server-only';
import crypto from 'crypto';
import { cookies } from 'next/headers';
import { query } from './db';

const COOKIE_NAME = 'invest_notes_session';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

function secret() {
  return process.env.AUTH_SECRET || 'invest-notes-local-auth-secret';
}

function sign(payload) {
  return crypto.createHmac('sha256', secret()).update(payload).digest('hex');
}

function getRequestHeader(request, name) {
  return String(request?.headers?.get?.(name) || '').trim();
}

export function shouldUseSecureSessionCookie(request) {
  if (process.env.NODE_ENV !== 'production') return false;

  const forwardedProto = getRequestHeader(request, 'x-forwarded-proto')
    .split(',')[0]
    .trim()
    .toLowerCase();
  if (forwardedProto) return forwardedProto === 'https';

  const forwarded = getRequestHeader(request, 'forwarded').toLowerCase();
  if (/\bproto=https\b/.test(forwarded)) return true;
  if (/\bproto=http\b/.test(forwarded)) return false;

  const protocol = request?.nextUrl?.protocol || (request?.url ? new URL(request.url).protocol : '');
  return protocol === 'https:';
}

export function makeSessionToken(user) {
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const payload = `${user.id}:${Buffer.from(user.username).toString('base64url')}:${expiresAt}`;
  return {
    token: `${Buffer.from(payload).toString('base64url')}.${sign(payload)}`,
    expiresAt
  };
}

export function parseSessionToken(token) {
  if (!token || !token.includes('.')) return null;
  const [encoded, signature] = token.split('.');
  let payload;
  try {
    payload = Buffer.from(encoded, 'base64url').toString('utf8');
  } catch {
    return null;
  }
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(sign(payload)))) return null;
  const [id, usernameEncoded, expiresAtRaw] = payload.split(':');
  const expiresAt = Number(expiresAtRaw);
  if (!id || !usernameEncoded || !Number.isFinite(expiresAt) || expiresAt * 1000 <= Date.now()) return null;
  return {
    id: String(id),
    username: Buffer.from(usernameEncoded, 'base64url').toString('utf8'),
    expiresAt
  };
}

export async function setSessionCookie(user, request) {
  const { token, expiresAt } = makeSessionToken(user);
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: shouldUseSecureSessionCookie(request),
    path: '/',
    maxAge: SESSION_TTL_SECONDS
  });
  return toSession(user, expiresAt);
}

export async function clearSessionCookie(request) {
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: shouldUseSecureSessionCookie(request),
    path: '/',
    maxAge: 0
  });
}

export function toPublicUser(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    username: row.username,
    email: row.username,
    user_metadata: {}
  };
}

export function toSession(row, expiresAt) {
  return {
    user: toPublicUser(row),
    expires_at: expiresAt
  };
}

export async function getCurrentSession() {
  const cookieStore = await cookies();
  const parsed = parseSessionToken(cookieStore.get(COOKIE_NAME)?.value);
  if (!parsed) return null;

  const result = await query('SELECT id, username FROM users WHERE id = $1', [parsed.id]);
  const user = result.rows[0];
  if (!user) return null;
  return toSession(user, parsed.expiresAt);
}

export async function requireUser() {
  const session = await getCurrentSession();
  if (!session?.user) {
    const error = new Error('未登录');
    error.status = 401;
    throw error;
  }
  return session.user;
}
