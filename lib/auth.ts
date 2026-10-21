import { promises as fs } from "fs";
import path from "path";
import { cookies } from "next/headers";
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { makeId } from "@/lib/db";
import { withFileLock } from "@/lib/fileLock";

const scrypt = promisify(scryptCallback);
const dataDir = path.join(process.cwd(), "data");
const authPath = path.join(dataDir, "users.json");
const sessionCookieName = "ai_ms_session";
const sessionMaxAgeSeconds = 60 * 60 * 24 * 7;
const maxSessionsPerUser = 5;
const maxLoginFailures = 8;
const loginWindowMs = 15 * 60 * 1000;
const registerWindowMs = 10 * 60 * 1000;
const maxRegistersPerWindow = 8;

export type AuthUser = {
  user_id: string;
  username: string;
  created_at: string;
};

type StoredUser = AuthUser & {
  password_hash: string;
  salt: string;
};

type StoredSession = {
  token: string;
  user_id: string;
  expires_at: string;
  created_at: string;
};

type AuthAttempt = {
  key: string;
  count: number;
  first_at: string;
  locked_until?: string;
};

type AuthDb = {
  users: StoredUser[];
  sessions: StoredSession[];
  login_attempts?: AuthAttempt[];
  register_attempts?: AuthAttempt[];
};

async function ensureAuthDb(): Promise<void> {
  await fs.mkdir(dataDir, { recursive: true });

  try {
    await fs.access(authPath);
  } catch {
    await withFileLock(authPath, async () => {
      try {
        await fs.access(authPath);
      } catch {
        await fs.writeFile(
          authPath,
          JSON.stringify({ users: [], sessions: [], login_attempts: [], register_attempts: [] }, null, 2),
          "utf8"
        );
      }
    });
  }
}

async function readAuthDb(options: { repairCorrupt?: boolean } = {}): Promise<AuthDb> {
  await ensureAuthDb();
  return readAuthDbFile(options);
}

async function readAuthDbFile(options: { repairCorrupt?: boolean } = {}): Promise<AuthDb> {
  const raw = (await fs.readFile(authPath, "utf8")).replace(/^\uFEFF/, "");
  let db: AuthDb;
  try {
    db = JSON.parse(raw) as AuthDb;
  } catch {
    if (!options.repairCorrupt) {
      throw new Error("用户数据文件损坏，请稍后重试。");
    }
    await fs.copyFile(authPath, `${authPath}.corrupt-${Date.now()}.bak`).catch(() => undefined);
    db = { users: [], sessions: [], login_attempts: [], register_attempts: [] };
    await writeAuthDbFile(db);
  }
  db.login_attempts ??= [];
  db.register_attempts ??= [];
  return db;
}

async function writeAuthDb(db: AuthDb): Promise<void> {
  await ensureAuthDb();
  await withFileLock(authPath, () => writeAuthDbFile(db));
}

async function writeAuthDbFile(db: AuthDb): Promise<void> {
  await writeJsonFile(authPath, db);
}

export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

export function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip") || "local";
}

export async function registerUser(input: { username: string; password: string }, clientIp = "local"): Promise<AuthUser> {
  const username = normalizeUsername(input.username);
  validateUsername(username);
  validateNewPassword(input.password);

  await ensureAuthDb();
  return withFileLock(authPath, async () => {
    const db = await readAuthDbFile({ repairCorrupt: true });
    pruneAuthDb(db);
    enforceRegisterLimit(db, clientIp);

    if (db.users.some((user) => user.username === username)) {
      throw new Error("这个用户名已经被注册。");
    }

    const salt = randomBytes(16).toString("hex");
    const passwordHash = await hashPassword(input.password, salt);
    const user: StoredUser = {
      user_id: makeId("u"),
      username,
      password_hash: passwordHash,
      salt,
      created_at: new Date().toISOString()
    };

    db.users.push(user);
    await writeAuthDbFile(db);

    return publicUser(user);
  });
}

export async function verifyUser(input: { username: string; password: string }, clientIp = "local"): Promise<AuthUser> {
  const username = normalizeUsername(input.username);
  validateUsername(username);
  validateLoginPassword(input.password);

  await ensureAuthDb();
  return withFileLock(authPath, async () => {
    const db = await readAuthDbFile({ repairCorrupt: true });
    pruneAuthDb(db);
    enforceLoginLimit(db, username, clientIp);

    const user = db.users.find((item) => item.username === username);
    const genericError = "用户名或密码不正确。";

    if (!user) {
      recordLoginFailure(db, username, clientIp);
      await writeAuthDbFile(db);
      throw new Error(genericError);
    }

    const passwordHash = await hashPassword(input.password, user.salt);
    const expected = Buffer.from(user.password_hash, "hex");
    const actual = Buffer.from(passwordHash, "hex");
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      recordLoginFailure(db, username, clientIp);
      await writeAuthDbFile(db);
      throw new Error(genericError);
    }

    clearLoginFailures(db, username, clientIp);
    await writeAuthDbFile(db);

    return publicUser(user);
  });
}

export async function createLoginSession(userId: string): Promise<string> {
  await ensureAuthDb();
  return withFileLock(authPath, async () => {
    const db = await readAuthDbFile({ repairCorrupt: true });
    const now = new Date();
    const token = randomBytes(32).toString("hex");
    const expiresAt = new Date(now.getTime() + sessionMaxAgeSeconds * 1000).toISOString();

    pruneAuthDb(db);
    db.sessions = db.sessions
      .filter((session) => session.user_id !== userId || new Date(session.expires_at).getTime() > now.getTime())
      .sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime());
    db.sessions = db.sessions.filter((session, index) => session.user_id !== userId || index < maxSessionsPerUser - 1);
    db.sessions.push({
      token,
      user_id: userId,
      expires_at: expiresAt,
      created_at: now.toISOString()
    });

    await writeAuthDbFile(db);
    return token;
  });
}

export async function getCurrentUser(): Promise<AuthUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(sessionCookieName)?.value;
  if (!token) return null;

  const db = await readAuthDb();
  const now = Date.now();
  const session = db.sessions.find((item) => item.token === token && new Date(item.expires_at).getTime() > now);
  if (!session) return null;

  const user = db.users.find((item) => item.user_id === session.user_id);
  return user ? publicUser(user) : null;
}

export async function clearCurrentSession(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(sessionCookieName)?.value;
  if (!token) return;

  await ensureAuthDb();
  await withFileLock(authPath, async () => {
    const db = await readAuthDbFile({ repairCorrupt: true });
    db.sessions = db.sessions.filter((session) => session.token !== token);
    await writeAuthDbFile(db);
  });
}

export async function clearAllUserSessions(userId: string): Promise<void> {
  await ensureAuthDb();
  await withFileLock(authPath, async () => {
    const db = await readAuthDbFile({ repairCorrupt: true });
    db.sessions = db.sessions.filter((session) => session.user_id !== userId);
    await writeAuthDbFile(db);
  });
}

export async function setSessionCookie(token: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(sessionCookieName, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.AUTH_COOKIE_SECURE === "true",
    path: "/",
    maxAge: sessionMaxAgeSeconds
  });
}

export async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(sessionCookieName, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.AUTH_COOKIE_SECURE === "true",
    path: "/",
    maxAge: 0
  });
}

export function unauthorizedResponse() {
  return Response.json({ error: "请先登录后再使用面试系统。" }, { status: 401 });
}

async function hashPassword(password: string, salt: string): Promise<string> {
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return derived.toString("hex");
}

function validateUsername(username: string): void {
  if (!/^[a-z0-9_]{3,24}$/.test(username)) {
    throw new Error("用户名只能包含小写字母、数字和下划线，长度 3-24 位。");
  }
}

function validateLoginPassword(password: string): void {
  if (password.length < 6 || password.length > 64) {
    throw new Error("密码长度需要在 6-64 位之间。");
  }
}

function validateNewPassword(password: string): void {
  if (password.length < 6 || password.length > 64) {
    throw new Error("密码长度需要在 6-64 位之间。");
  }
}

function pruneAuthDb(db: AuthDb) {
  const now = Date.now();
  db.sessions = db.sessions.filter((session) => new Date(session.expires_at).getTime() > now);
  db.login_attempts = (db.login_attempts ?? []).filter((attempt) => {
    const firstAt = new Date(attempt.first_at).getTime();
    const lockedUntil = attempt.locked_until ? new Date(attempt.locked_until).getTime() : 0;
    return now - firstAt <= loginWindowMs || lockedUntil > now;
  });
  db.register_attempts = (db.register_attempts ?? []).filter(
    (attempt) => now - new Date(attempt.first_at).getTime() <= registerWindowMs
  );
}

function enforceLoginLimit(db: AuthDb, username: string, clientIp: string) {
  const key = loginAttemptKey(username, clientIp);
  const attempt = db.login_attempts?.find((item) => item.key === key);
  if (attempt?.locked_until && new Date(attempt.locked_until).getTime() > Date.now()) {
    throw new Error("登录失败次数过多，请稍后再试。");
  }
}

function recordLoginFailure(db: AuthDb, username: string, clientIp: string) {
  db.login_attempts ??= [];
  const key = loginAttemptKey(username, clientIp);
  const now = Date.now();
  let attempt = db.login_attempts.find((item) => item.key === key);

  if (!attempt || now - new Date(attempt.first_at).getTime() > loginWindowMs) {
    attempt = { key, count: 0, first_at: new Date(now).toISOString() };
    db.login_attempts.push(attempt);
  }

  attempt.count += 1;
  if (attempt.count >= maxLoginFailures) {
    attempt.locked_until = new Date(now + loginWindowMs).toISOString();
  }
}

function clearLoginFailures(db: AuthDb, username: string, clientIp: string) {
  const key = loginAttemptKey(username, clientIp);
  db.login_attempts = (db.login_attempts ?? []).filter((item) => item.key !== key);
}

function enforceRegisterLimit(db: AuthDb, clientIp: string) {
  db.register_attempts ??= [];
  const now = Date.now();
  const key = `register:${clientIp}`;
  let attempt = db.register_attempts.find((item) => item.key === key);

  if (!attempt || now - new Date(attempt.first_at).getTime() > registerWindowMs) {
    attempt = { key, count: 0, first_at: new Date(now).toISOString() };
    db.register_attempts.push(attempt);
  }

  attempt.count += 1;
  if (attempt.count > maxRegistersPerWindow) {
    throw new Error("注册请求过于频繁，请稍后再试。");
  }
}

function loginAttemptKey(username: string, clientIp: string) {
  return `login:${clientIp}:${username}`;
}

function publicUser(user: StoredUser): AuthUser {
  return {
    user_id: user.user_id,
    username: user.username,
    created_at: user.created_at
  };
}

async function writeJsonFile(filePath: string, payload: unknown) {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, JSON.stringify(payload, null, 2), "utf8");
  await fs.rename(tempPath, filePath);
}
