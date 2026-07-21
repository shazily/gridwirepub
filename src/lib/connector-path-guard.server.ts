/**
 * Path traversal / jail guards for folder, NFS, and CBFS-style local connectors.
 */

import path from "node:path";

/**
 * Resolve a connector path under an optional allowlisted root.
 * Rejects .. segments and absolute escapes outside the root.
 */
export function assertSafeConnectorPath(rawPath: string, allowedRoot?: string): string {
  const trimmed = rawPath?.trim();
  if (!trimmed) {
    throw new Error("connector path is required");
  }
  if (trimmed.includes("\0")) {
    throw new Error("connector path contains invalid characters");
  }

  // Strip trailing glob file segment for directory resolution (e.g. /data/*.xlsx).
  const withoutGlob = trimmed.replace(/\/[^/]*\*[^/]*$/, "") || trimmed;
  const resolved = path.resolve(withoutGlob);

  if (allowedRoot?.trim()) {
    const root = path.resolve(allowedRoot.trim());
    const rel = path.relative(root, resolved);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      throw new Error(`connector path escapes allowed root: ${resolved}`);
    }
  }

  // Block classic traversal tokens even when no root is configured.
  const parts = withoutGlob.split(/[/\\]/);
  if (parts.some((p) => p === "..")) {
    throw new Error("connector path must not contain parent-directory segments");
  }

  return resolved;
}

/** Join a directory + filename safely (filename must be a bare name). */
export function safeJoinUnderDir(dir: string, fileName: string): string {
  if (!fileName?.trim() || fileName.includes("/") || fileName.includes("\\") || fileName.includes("..")) {
    throw new Error("invalid connector file name");
  }
  const base = path.basename(fileName);
  if (base !== fileName || base === "." || base === "..") {
    throw new Error("invalid connector file name");
  }
  return path.join(dir, base);
}
