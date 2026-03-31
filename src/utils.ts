import { info, warning, debug } from "@actions/core";
import { getExecOutput } from "@actions/exec";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative } from "node:path";
import type { Inputs } from "./types.js";
import { LockFileType } from "./types.js";
import type { LockFileInfo } from "./types.js";

export function getVitePlusHome(): string {
  const home = process.platform === "win32" ? process.env.USERPROFILE : process.env.HOME;
  return join(home || homedir(), ".vite-plus");
}

export function getWorkspaceDir(): string {
  return process.env.GITHUB_WORKSPACE || process.cwd();
}

export function resolvePath(filePath: string, baseDir: string): string {
  return isAbsolute(filePath) ? filePath : join(baseDir, filePath);
}

export function getConfiguredProjectDir(inputs: Inputs): string {
  if (!inputs.workingDirectory) {
    return getWorkspaceDir();
  }

  const projectDir = resolvePath(inputs.workingDirectory, getWorkspaceDir());

  if (!existsSync(projectDir)) {
    throw new Error(
      `working-directory not found: ${inputs.workingDirectory} (resolved to ${projectDir})`,
    );
  }

  if (!statSync(projectDir).isDirectory()) {
    throw new Error(
      `working-directory is not a directory: ${inputs.workingDirectory} (resolved to ${projectDir})`,
    );
  }

  return projectDir;
}

export function getInstallCwd(projectDir: string, cwd?: string): string {
  return cwd ? resolvePath(cwd, projectDir) : projectDir;
}

// Lock file patterns in priority order
const LOCK_FILES: Array<{ filename: string; type: LockFileType }> = [
  { filename: "pnpm-lock.yaml", type: LockFileType.Pnpm },
  { filename: "package-lock.json", type: LockFileType.Npm },
  { filename: "npm-shrinkwrap.json", type: LockFileType.Npm },
  { filename: "yarn.lock", type: LockFileType.Yarn },
];

/**
 * Detect a lock file in the provided workspace directory.
 * Defaults to the GitHub workspace root.
 */
export function detectLockFile(
  explicitPath?: string,
  workspace = getWorkspaceDir(),
): LockFileInfo | undefined {
  // If explicit path provided, use it
  if (explicitPath) {
    const fullPath = resolvePath(explicitPath, workspace);

    if (existsSync(fullPath)) {
      const filename = basename(fullPath);
      const lockInfo = LOCK_FILES.find((l) => l.filename === filename);
      if (lockInfo) {
        return {
          type: lockInfo.type,
          path: fullPath,
          filename,
        };
      }
      // Unknown lock file type - try to infer from name
      return inferLockFileType(fullPath, filename);
    }
    return undefined;
  }

  const workspaceRoot = getWorkspaceDir();

  // Auto-detect: search the provided directory first, then walk upward to the workspace root.
  // This lets package-level working directories reuse the monorepo root lock file.
  let currentDir = workspace;
  while (true) {
    const lockFile = findLockFileInDirectory(currentDir);
    if (lockFile) {
      return lockFile;
    }

    if (currentDir === workspaceRoot) {
      return undefined;
    }

    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) {
      return undefined;
    }

    currentDir = parentDir;
  }
}

function inferLockFileType(fullPath: string, filename: string): LockFileInfo {
  // Infer type from filename patterns
  if (filename.includes("pnpm")) {
    return { type: LockFileType.Pnpm, path: fullPath, filename };
  }
  if (filename.includes("yarn")) {
    return { type: LockFileType.Yarn, path: fullPath, filename };
  }
  // Default to npm
  return { type: LockFileType.Npm, path: fullPath, filename };
}

/**
 * Get dependency cache directories based on package manager type.
 */
export async function getDependencyCacheDirectories(
  lockType: LockFileType,
  cwd: string,
): Promise<string[]> {
  switch (lockType) {
    case LockFileType.Npm:
    case LockFileType.Pnpm:
    case LockFileType.Yarn:
      return getPackageManagerCacheDirs(cwd);
    default:
      return [];
  }
}

export function getTaskCacheDirectories(cwd: string): string[] {
  return [join(cwd, "node_modules", ".vite", "task-cache")];
}

export function getTaskCacheScope(cwd: string, nodeVersion?: string): string {
  const workspace = getWorkspaceDir();
  const projectPath = relative(workspace, cwd) || ".";
  const normalizedProjectPath = projectPath.replaceAll("\\", "/");
  const workflow = process.env.GITHUB_WORKFLOW_REF || process.env.GITHUB_WORKFLOW || "default";
  const job = process.env.GITHUB_JOB || "default";
  const runtime = nodeVersion || "system";

  return createHash("sha256")
    .update(`${workflow}\n${job}\n${runtime}\n${normalizedProjectPath}`)
    .digest("hex")
    .slice(0, 16);
}

async function getCommandOutput(
  command: string,
  args: string[],
  options?: { cwd?: string },
): Promise<string | undefined> {
  const cmdStr = `${command} ${args.join(" ")}`;
  try {
    const result = await getExecOutput(command, args, {
      cwd: options?.cwd,
      silent: true,
      ignoreReturnCode: true,
    });
    if (result.exitCode === 0) {
      return result.stdout.trim();
    }
    debug(`Command "${cmdStr}" exited with code ${result.exitCode}`);
    return undefined;
  } catch (error) {
    warning(`Failed to run "${cmdStr}": ${String(error)}`);
    return undefined;
  }
}

async function getPackageManagerCacheDirs(cwd: string): Promise<string[]> {
  const cacheDir = await getCommandOutput("vp", ["pm", "cache", "dir"], { cwd });
  return cacheDir ? [cacheDir] : [];
}

function findLockFileInDirectory(workspace: string): LockFileInfo | undefined {
  const workspaceContents = readdirSync(workspace);

  for (const lockInfo of LOCK_FILES) {
    if (workspaceContents.includes(lockInfo.filename)) {
      const fullPath = join(workspace, lockInfo.filename);
      info(`Auto-detected lock file: ${lockInfo.filename}`);
      return {
        type: lockInfo.type,
        path: fullPath,
        filename: lockInfo.filename,
      };
    }
  }

  return undefined;
}
