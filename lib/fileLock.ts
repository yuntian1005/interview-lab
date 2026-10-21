import { promises as fs } from "fs";

const defaultTimeoutMs = 5000;
const retryDelayMs = 40;
const staleLockMs = 30000;

export async function withFileLock<T>(targetPath: string, action: () => Promise<T>, timeoutMs = defaultTimeoutMs): Promise<T> {
  const lockPath = `${targetPath}.lock`;
  const startedAt = Date.now();

  while (true) {
    try {
      await fs.mkdir(lockPath);
      break;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") throw error;

      await removeStaleLock(lockPath);
      if (Date.now() - startedAt > timeoutMs) {
        throw new Error(`等待文件锁超时：${targetPath}`);
      }
      await delay(retryDelayMs);
    }
  }

  try {
    return await action();
  } finally {
    await fs.rm(lockPath, { recursive: true, force: true });
  }
}

async function removeStaleLock(lockPath: string) {
  try {
    const stat = await fs.stat(lockPath);
    if (Date.now() - stat.mtimeMs > staleLockMs) {
      await fs.rm(lockPath, { recursive: true, force: true });
    }
  } catch {
    // The lock may have been released by another request between mkdir attempts.
  }
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
