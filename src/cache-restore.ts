import { restoreCache as restoreCacheAction } from "@actions/cache";
import { hashFiles } from "@actions/glob";
import { warning, info, debug, saveState, setOutput } from "@actions/core";
import { arch, platform } from "node:os";
import { dirname } from "node:path";
import type { Inputs } from "./types.js";
import { State, Outputs } from "./types.js";
import {
  detectLockFile,
  getConfiguredProjectDir,
  getDependencyCacheDirectories,
  getTaskCacheDirectories,
  getTaskCacheScope,
} from "./utils.js";

export async function restoreCache(inputs: Inputs, nodeVersion?: string): Promise<void> {
  const projectDir = getConfiguredProjectDir(inputs);

  // Detect lock file
  const lockFile = detectLockFile(inputs.cacheDependencyPath, projectDir);
  if (!lockFile) {
    const message = inputs.cacheDependencyPath
      ? `No lock file found for cache-dependency-path: ${inputs.cacheDependencyPath}. Skipping cache restore.`
      : `No lock file found in project directory: ${projectDir}. Skipping cache restore.`;
    warning(message);
    setOutput(Outputs.CacheHit, false);
    return;
  }

  info(`Using lock file: ${lockFile.path}`);
  const cacheCwd = dirname(lockFile.path);
  info(`Resolving cache directories in: ${cacheCwd}`);

  // Generate cache key: vite-plus-{platform}-{arch}-{lockfile-type}-{hash}
  const runnerOS = process.env.RUNNER_OS || platform();
  const runnerArch = arch();
  const fileHash = await hashFiles(lockFile.path);

  if (!fileHash) {
    throw new Error(`Failed to generate hash for lock file: ${lockFile.path}`);
  }

  const dependencyCachePaths = await getDependencyCacheDirectories(lockFile.type, cacheCwd);
  if (dependencyCachePaths.length) {
    debug(`Dependency cache paths: ${dependencyCachePaths.join(", ")}`);
    saveState(State.DependencyCachePaths, JSON.stringify(dependencyCachePaths));
  } else {
    warning(`No dependency cache directories found for ${lockFile.type} in ${cacheCwd}.`);
  }

  const taskCachePaths = getTaskCacheDirectories(cacheCwd);
  debug(`Task cache paths: ${taskCachePaths.join(", ")}`);
  saveState(State.TaskCachePaths, JSON.stringify(taskCachePaths));

  const dependencyPrimaryKey = `vite-plus-${runnerOS}-${runnerArch}-${lockFile.type}-${fileHash}`;
  const dependencyRestoreKeys = [
    `vite-plus-${runnerOS}-${runnerArch}-${lockFile.type}-`,
    `vite-plus-${runnerOS}-${runnerArch}-`,
  ];
  const taskScope = getTaskCacheScope(cacheCwd, nodeVersion);
  const taskPrimaryKey = `vite-plus-task-${runnerOS}-${runnerArch}-${lockFile.type}-${taskScope}-${fileHash}`;

  debug(`Dependency cache primary key: ${dependencyPrimaryKey}`);
  debug(`Dependency cache restore keys: ${dependencyRestoreKeys.join(", ")}`);
  debug(`Task cache primary key: ${taskPrimaryKey}`);

  let dependencyMatchedKey: string | undefined;
  if (dependencyCachePaths.length) {
    saveState(State.DependencyCachePrimaryKey, dependencyPrimaryKey);
    dependencyMatchedKey = await restoreCacheAction(
      dependencyCachePaths,
      dependencyPrimaryKey,
      dependencyRestoreKeys,
    );
    if (dependencyMatchedKey) {
      info(`Dependency cache restored from key: ${dependencyMatchedKey}`);
      saveState(State.DependencyCacheMatchedKey, dependencyMatchedKey);
    } else {
      info("Dependency cache not found");
    }
  }

  saveState(State.TaskCachePrimaryKey, taskPrimaryKey);
  const taskMatchedKey = await restoreCacheAction(taskCachePaths, taskPrimaryKey);
  if (taskMatchedKey) {
    info(`Task cache restored from key: ${taskMatchedKey}`);
    saveState(State.TaskCacheMatchedKey, taskMatchedKey);
  } else {
    info("Task cache not found");
  }

  setOutput(Outputs.CacheHit, Boolean(dependencyMatchedKey || taskMatchedKey));
}
