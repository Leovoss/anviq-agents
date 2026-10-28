// Copyright 2026 Anviq LLC. All rights reserved.
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { startMemoryMirror } from "./memory-mirror.js";

const logger = { info: vi.fn(), error: vi.fn() };
const result = { exported: 1, imported: 0, created: 0, deleted: 0, skipped: 0 };

describe("startMemoryMirror", () => {
  it("does nothing unless a mode is set", () => {
    const syncMirror = vi.fn();
    expect(startMemoryMirror({ syncMirror }, {}, "/data", logger)).toBeUndefined();
    expect(startMemoryMirror({ syncMirror }, { MEMORY_MIRROR_MODE: "off" }, "/data", logger)).toBe(
      undefined,
    );
    expect(syncMirror).not.toHaveBeenCalled();
  });

  it("syncs the default folder right away and logs changes", async () => {
    const syncMirror = vi.fn().mockResolvedValue(result);
    const stop = startMemoryMirror(
      { syncMirror },
      { MEMORY_MIRROR_MODE: "two-way" },
      "/data",
      logger,
    );
    await vi.waitFor(() =>
      expect(logger.info).toHaveBeenCalledWith("memory mirror synced", result),
    );
    expect(syncMirror).toHaveBeenCalledWith({
      dir: path.join("/data", "memory-mirror"),
      mode: "two-way",
    });
    stop?.();
  });

  it("keeps running after a failed pass", async () => {
    const syncMirror = vi.fn().mockRejectedValue(new Error("db down"));
    const stop = startMemoryMirror(
      { syncMirror },
      { MEMORY_MIRROR_MODE: "export", MEMORY_MIRROR_DIR: "/mirror" },
      "/data",
      logger,
    );
    await vi.waitFor(() => expect(logger.error).toHaveBeenCalled());
    expect(syncMirror).toHaveBeenCalledWith({ dir: "/mirror", mode: "export" });
    stop?.();
  });
});
