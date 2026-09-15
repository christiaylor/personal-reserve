import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const secret = process.env.AUTH_SECRET || 'personal-reserve-dev-secret';

function toBase64(value) {
  return Buffer.from(value).toString('base64');
}

export function createToken(userId) {
  const random = randomBytes(24).toString('hex');
  const payload = `${userId}:${random}`;
  const sig = createHmac('sha256', secret).update(payload).digest('hex');
  return `${toBase64(payload)}.${sig}`;
}

export function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;

  const expected = createHmac('sha256', secret).update(Buffer.from(payload, 'base64').toString('utf8')).digest('hex');
  const actual = Buffer.from(sig, 'hex');
  const expectedBuf = Buffer.from(expected, 'hex');

  try {
    if (actual.length !== expectedBuf.length || !timingSafeEqual(actual, expectedBuf)) {
      return null;
    }
  } catch {
    return null;
  }

  const decoded = Buffer.from(payload, 'base64').toString('utf8');
  const [userId] = decoded.split(':');
  return userId || null;
}

export function getCookieToken(req) {
  const cookieHeader = req.headers.cookie || '';
  const match = cookieHeader.split(';').map((cookie) => cookie.trim()).find((cookie) => cookie.startsWith('personal_reserve_session='));
  if (!match) return null;
  return decodeURIComponent(match.split('=')[1]);
}

export function setAuthCookie(res, token) {
  res.setHeader('Set-Cookie', `personal_reserve_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800`);
}

export function clearAuthCookie(res) {
  res.setHeader('Set-Cookie', 'personal_reserve_session=; Path=/; HttpOnly; Max-Age=0');
}
