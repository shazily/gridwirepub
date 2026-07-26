/**
 * Path traversal / jail guards for folder, NFS, and CBFS-style local connectors.
 */

import fs from "node:fs";
import path from "node:path";

/**
 * Resolve a connector path under an optional allowlisted root.
 * Rejects .. segments, absolute escapes outside the root, and symlink escapes
 * (realpath must remain under the configured root).
 */
export function assertSafeConnectorPath(rawPath: string, allowedRoot?: string): string {
  const trimmed = rawPath?.trim();
  if (!trimmed) {
    throw new Error("connector path is required");
  }
  if (trimmed.includes("\0")) {
    throw new Error("connector path contains invalid characters");
  }
  if (/^[a-zA-Z]:[\\/]/.test(trimmed) && !allowedRoot?.trim()) {
    // Absolute drive paths require an explicit jail root on Windows-style mounts.
    throw new Error("absolute drive paths require CONNECTOR_ALLOWED_ROOT");
  }

  // Strip trailing glob file segment for directory resolution (e.g. /data/*.xlsx).
  const withoutGlob = trimmed.replace(/\/[^/]*\*[^/]*$/, "") || trimmed;
  const parts = withoutGlob.split(/[/\\]/);
  if (parts.some((p) => p === "..")) {
    throw new Error("connector path must not contain parent-directory segments");
  }

  const resolved = path.resolve(withoutGlob);

  if (allowedRoot?.trim()) {
    const root = path.resolve(allowedRoot.trim());
    const rel = path.relative(root, resolved);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      throw new Error(`connector path escapes allowed root: ${resolved}`);
    }

    // Symlink escape check when the path already exists on disk.
    try {
      if (fs.existsSync(resolved) && fs.existsSync(root)) {
        const realPath = fs.realpathSync(resolved);
        const realRoot = fs.realpathSync(root);
        const realRel = path.relative(realRoot, realPath);
        if (realRel.startsWith("..") || path.isAbsolute(realRel)) {
          throw new Error(`connector path symlink escapes allowed root: ${realPath}`);
        }
        return realPath;
      }
    } catch (err) {
      if (err instanceof Error && /symlink escapes/.test(err.message)) throw err;
      // If realpath fails (race / permissions), fall through with resolved path under root.
    }
  }

  return resolved;
}

/** Join a directory + filename safely (filename must be a bare name). */
export function safeJoinUnderDir(dir: string, fileName: string): string {
  if (!fileName?.trim() || fileName.includes("/") || fileName.includes("\\") || fileName.includes("..")) {
    throw new Error("invalid connector file name");
  }
  if (fileName.includes("\0")) {
    throw new Error("invalid connector file name");
  }
  const base = path.basename(fileName);
  if (base !== fileName || base === "." || base === "..") {
    throw new Error("invalid connector file name");
  }
  const joined = path.join(dir, base);
  const resolvedDir = path.resolve(dir);
  const resolvedFile = path.resolve(joined);
  const rel = path.relative(resolvedDir, resolvedFile);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error("invalid connector file name");
  }
  return joined;
}
