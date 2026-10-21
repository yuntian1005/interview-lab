import { promises as fs } from "fs";
import path from "path";
import { withFileLock } from "@/lib/fileLock";
import { InterviewSession } from "@/lib/types";

type Database = {
  sessions: InterviewSession[];
};

const dataDir = path.join(process.cwd(), "data");
const dbPath = path.join(dataDir, "interviews.json");

async function ensureDb(): Promise<void> {
  await fs.mkdir(dataDir, { recursive: true });

  try {
    await fs.access(dbPath);
  } catch {
    await withFileLock(dbPath, async () => {
      try {
        await fs.access(dbPath);
      } catch {
        await fs.writeFile(dbPath, JSON.stringify({ sessions: [] }, null, 2), "utf8");
      }
    });
  }
}

export async function readDb(): Promise<Database> {
  await ensureDb();
  return readDbFile();
}

export async function writeDb(db: Database): Promise<void> {
  await ensureDb();
  await withFileLock(dbPath, () => writeDbFile(db));
}

async function readDbFile(): Promise<Database> {
  const raw = await fs.readFile(dbPath, "utf8");
  return JSON.parse(raw) as Database;
}

async function writeDbFile(db: Database): Promise<void> {
  await writeJsonFile(dbPath, db);
}

export async function listSessions(): Promise<InterviewSession[]> {
  const db = await readDb();
  return db.sessions.sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export async function listSessionsByUser(userId: string): Promise<InterviewSession[]> {
  const db = await readDb();
  return db.sessions
    .filter((session) => session.user_id === userId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export async function getSession(sessionId: string): Promise<InterviewSession | undefined> {
  const db = await readDb();
  return db.sessions.find((session) => session.session_id === sessionId);
}

export async function getUserSession(sessionId: string, userId: string): Promise<InterviewSession | undefined> {
  const session = await getSession(sessionId);
  if (!session || session.user_id !== userId) return undefined;
  return session;
}

export async function saveSession(session: InterviewSession): Promise<void> {
  await ensureDb();
  await withFileLock(dbPath, async () => {
    const db = await readDbFile();
    const index = db.sessions.findIndex((item) => item.session_id === session.session_id);

    if (index >= 0) {
      db.sessions[index] = session;
    } else {
      db.sessions.push(session);
    }

    await writeDbFile(db);
  });
}

export async function deleteSession(sessionId: string, userId: string): Promise<boolean> {
  await ensureDb();
  return withFileLock(dbPath, async () => {
    const db = await readDbFile();
    const nextSessions = db.sessions.filter((session) => !(session.session_id === sessionId && session.user_id === userId));
    const deleted = nextSessions.length !== db.sessions.length;

    if (deleted) {
      await writeDbFile({ sessions: nextSessions });
    }

    return deleted;
  });
}

export function makeId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function writeJsonFile(filePath: string, payload: unknown) {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, JSON.stringify(payload, null, 2), "utf8");
  await fs.rename(tempPath, filePath);
}
