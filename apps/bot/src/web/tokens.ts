import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** 32 random bytes, base64url (43 chars). */
export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

/** SHA-256 hex of the token; only this is stored. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function isWellFormedToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(token);
}

export function hashesEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export interface SessionLike {
  endedAt: Date | null;
  guildId: string;
}

/** A session is valid when not ended and its guild is still allowed. */
export function isSessionUsable(
  session: SessionLike | null | undefined,
  guildAllowed: boolean,
): boolean {
  return !!session && session.endedAt === null && guildAllowed;
}

/** Origin check: when panel_base_url is set the request Origin must match it; absent Origin on a mutating request is rejected. */
export function originAllowed(
  origin: string | undefined,
  panelBaseUrl: string | undefined,
): boolean {
  if (!panelBaseUrl || !origin) return false;
  try {
    return new URL(origin).origin === new URL(panelBaseUrl).origin;
  } catch {
    return false;
  }
}
