import path from "node:path";
import type { SpaceMemoryProviderResolver } from "@anviq/adapters";
import { parsePositiveInteger } from "@anviq/db";

type MirrorSync = Pick<SpaceMemoryProviderResolver, "syncMirror">;

interface MirrorLogger {
  info(message: string, data?: object): void;
  error(message: string, error: unknown): void;
}

export function startMemoryMirror(
  memory: MirrorSync,
  env: NodeJS.ProcessEnv,
  dataDir: string,
  logger: MirrorLogger,
): (() => void) | undefined {
  const mode = env.MEMORY_MIRROR_MODE;
  if (mode !== "export" && mode !== "two-way") return undefined;
  const dir = env.MEMORY_MIRROR_DIR ?? path.join(dataDir, "memory-mirror");
  const intervalMs = parsePositiveInteger(env.MEMORY_MIRROR_INTERVAL_MS, 10_000);
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const result = await memory.syncMirror({ dir, mode });
      if (Object.values(result).some((count) => count > 0)) {
        logger.info("memory mirror synced", result);
      }
    } catch (error) {
      logger.error("memory mirror sync failed", error);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void run(), intervalMs);
  timer.unref();
  void run();
  return () => clearInterval(timer);
}
