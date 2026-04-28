import argon2 from "argon2";
import jwt from "jsonwebtoken";
import { HttpError } from "./errors";

export interface AuthUser {
  id: string;
  username: string;
}

interface JwtPayload {
  sub: string;
  username: string;
}

export function normalizeUsername(username: string) {
  return username.trim().toLowerCase();
}

export async function hashPassword(password: string) {
  return argon2.hash(password, { type: argon2.argon2id });
}

export async function verifyPassword(hash: string, password: string) {
  return argon2.verify(hash, password);
}

export function signAuthToken(user: AuthUser, jwtSecret: string) {
  return jwt.sign({ sub: user.id, username: user.username }, jwtSecret, {
    expiresIn: "7d"
  });
}

export function verifyAuthToken(token: string, jwtSecret: string): AuthUser {
  try {
    const payload = jwt.verify(token, jwtSecret) as JwtPayload;

    if (!payload.sub || !payload.username) {
      throw new Error("Missing auth payload");
    }

    return { id: payload.sub, username: payload.username };
  } catch {
    throw new HttpError(401, "Invalid or expired session");
  }
}
