import { describe, it, expect, beforeEach, afterEach, vi } from "vite-plus/test";
import { arch } from "node:os";
import { restoreCache } from "./cache-restore.js";
import { detectLockFile, getCacheDirectories } from "./utils.js";
import { hashFiles } from "@actions/glob";
import { restoreCache as restoreCacheAction } from "@actions/cache";
import { saveState, setOutput, warning, info } from "@actions/core";
import { LockFileType, Outputs, State } from "./types.js";

vi.mock("@actions/cache", () => ({
  restoreCache: vi.fn(),
}));

vi.mock("@actions/glob", () => ({
  hashFiles: vi.fn(),
}));

vi.mock("@actions/core", () => ({
  warning: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  saveState: vi.fn(),
  setOutput: vi.fn(),
}));

vi.mock("./utils.js", () => ({
  detectLockFile: vi.fn(),
  getCacheDirectories: vi.fn(),
  getCacheDirectoryCwd: vi.fn((lockFilePath: string) => {
    const normalized = lockFilePath.replace(/\\/g, "/");
    return normalized.slice(0, normalized.lastIndexOf("/"));
  }),
}));

describe("restoreCache", () => {
  beforeEach(() => {
    vi.stubEnv("RUNNER_OS", "Linux");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetAllMocks();
  });

  it("should resolve dependency cache using the subdirectory lock file cwd", async () => {
    vi.mocked(detectLockFile).mockReturnValue({
      type: LockFileType.Pnpm,
      path: "/test/workspace/web/pnpm-lock.yaml",
      filename: "pnpm-lock.yaml",
    });
    vi.mocked(getCacheDirectories).mockResolvedValue(["/tmp/pnpm-store"]);
    vi.mocked(hashFiles).mockResolvedValue("abc123");
    vi.mocked(restoreCacheAction).mockResolvedValue(undefined);

    await restoreCache({
      version: "latest",
      nodeVersion: undefined,
      nodeVersionFile: undefined,
      runInstall: [{ cwd: "./web" }],
      cache: true,
      cacheDependencyPath: "web/pnpm-lock.yaml",
      registryUrl: undefined,
      scope: undefined,
    });

    expect(info).toHaveBeenCalledWith("Using lock file: /test/workspace/web/pnpm-lock.yaml");
    expect(info).toHaveBeenCalledWith(
      "Resolving dependency cache directory in: /test/workspace/web",
    );
    expect(getCacheDirectories).toHaveBeenCalledWith(LockFileType.Pnpm, "/test/workspace/web");
    expect(saveState).toHaveBeenCalledWith(
      State.CachePrimaryKey,
      `vite-plus-Linux-${arch()}-pnpm-abc123`,
    );
    expect(setOutput).toHaveBeenCalledWith(Outputs.CacheHit, false);
  });

  it("should resolve dependency cache in workspace root for auto-detected lock files", async () => {
    vi.mocked(detectLockFile).mockReturnValue({
      type: LockFileType.Pnpm,
      path: "/test/workspace/pnpm-lock.yaml",
      filename: "pnpm-lock.yaml",
    });
    vi.mocked(getCacheDirectories).mockResolvedValue(["/tmp/pnpm-store"]);
    vi.mocked(hashFiles).mockResolvedValue("def456");
    vi.mocked(restoreCacheAction).mockResolvedValue(undefined);

    await restoreCache({
      version: "latest",
      nodeVersion: undefined,
      nodeVersionFile: undefined,
      runInstall: [],
      cache: true,
      cacheDependencyPath: undefined,
      registryUrl: undefined,
      scope: undefined,
    });

    expect(getCacheDirectories).toHaveBeenCalledWith(LockFileType.Pnpm, "/test/workspace");
  });

  it("should warn with cache cwd details and skip saving cache key when cache dir lookup fails", async () => {
    vi.mocked(detectLockFile).mockReturnValue({
      type: LockFileType.Pnpm,
      path: "/test/workspace/web/pnpm-lock.yaml",
      filename: "pnpm-lock.yaml",
    });
    vi.mocked(getCacheDirectories).mockResolvedValue([]);

    await restoreCache({
      version: "latest",
      nodeVersion: undefined,
      nodeVersionFile: undefined,
      runInstall: [],
      cache: true,
      cacheDependencyPath: "web/pnpm-lock.yaml",
      registryUrl: undefined,
      scope: undefined,
    });

    expect(warning).toHaveBeenCalledWith(
      "No cache directories found for pnpm in /test/workspace/web. Skipping cache restore.",
    );
    expect(saveState).not.toHaveBeenCalledWith(State.CachePrimaryKey, expect.any(String));
    expect(setOutput).toHaveBeenCalledWith(Outputs.CacheHit, false);
  });
});
