import jwt from 'jsonwebtoken';
import type { AccessTokenPayload, TokenPair } from './types';

const ACCESS_TOKEN_TTL_SECONDS = 15 * 60; // 15 minutes, per ARCHITECTURE.md §1

export function signAccessToken(payload: AccessTokenPayload, secret: string): TokenPair {
  const accessToken = jwt.sign(payload, secret, { expiresIn: ACCESS_TOKEN_TTL_SECONDS });
  return { accessToken, accessTokenExpiresInSeconds: ACCESS_TOKEN_TTL_SECONDS };
}

export function verifyAccessToken(token: string, secret: string): AccessTokenPayload | null {
  try {
    return jwt.verify(token, secret) as AccessTokenPayload;
  } catch {
    return null;
  }
}
