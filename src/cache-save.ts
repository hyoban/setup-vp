import { saveCache as saveCacheAction } from "@actions/cache";
import { getState, info, warning } from "@actions/core";
import { State } from "./types.js";

export async function saveCache(): Promise<void> {
  await saveNamedCache(
    "Dependency cache",
    State.DependencyCachePrimaryKey,
    State.DependencyCacheMatchedKey,
    State.DependencyCachePaths,
  );
  await saveNamedCache(
    "Task cache",
    State.TaskCachePrimaryKey,
    State.TaskCacheMatchedKey,
    State.TaskCachePaths,
  );
}

async function saveNamedCache(
  label: string,
  primaryKeyState: State,
  matchedKeyState: State,
  cachePathsState: State,
): Promise<void> {
  const primaryKey = getState(primaryKeyState);
  const matchedKey = getState(matchedKeyState);
  const cachePathsJson = getState(cachePathsState);

  if (!primaryKey) {
    info(`No ${label.toLowerCase()} key found. Skipping cache save.`);
    return;
  }

  if (!cachePathsJson) {
    info(`No ${label.toLowerCase()} paths found. Skipping cache save.`);
    return;
  }

  // Skip if cache hit on primary key (no changes)
  if (primaryKey === matchedKey) {
    info(`${label} hit on primary key "${primaryKey}". Skipping save.`);
    return;
  }

  const cachePaths: string[] = JSON.parse(cachePathsJson) as string[];

  if (!cachePaths.length) {
    info(`Empty ${label.toLowerCase()} paths. Skipping cache save.`);
    return;
  }

  try {
    const cacheId = await saveCacheAction(cachePaths, primaryKey);
    if (cacheId === -1) {
      warning(`${label} save failed or was skipped.`);
      return;
    }
    info(`${label} saved with key: ${primaryKey}`);
  } catch (error) {
    // Don't fail the action if cache save fails
    warning(`Failed to save ${label.toLowerCase()}: ${String(error)}`);
  }
}
