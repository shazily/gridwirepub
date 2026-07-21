/**
 * Path traversal / jail guards for folder, NFS, and CBFS-style local connectors.
 */
import path from "node:path";

/**
 * @param {string} rawPath
 * @param {string} [allowedRoot]
 * @returns {string}
 */
export function assertSafeConnectorPath(rawPath, allowedRoot) {
  const trimmed = rawPath?.trim();
  if (!trimmed) {
    throw new Error("connector path is required");
  }
  if (trimmed.includes("\0")) {
    throw new Error("connector path contains invalid characters");
  }

  const withoutGlob = trimmed.replace(/\/[^/]*\*[^/]*$/, "") || trimmed;
  const resolved = path.resolve(withoutGlob);

  if (allowedRoot?.trim()) {
    const root = path.resolve(allowedRoot.trim());
    const rel = path.relative(root, resolved);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      throw new Error(`connector path escapes allowed root: ${resolved}`);
    }
  }

  const parts = withoutGlob.split(/[/\\]/);
  if (parts.some((p) => p === "..")) {
    throw new Error("connector path must not contain parent-directory segments");
  }

  return resolved;
}

/**
 * @param {string} dir
 * @param {string} fileName
 * @returns {string}
 */
export function safeJoinUnderDir(dir, fileName) {
  if (!fileName?.trim() || fileName.includes("/") || fileName.includes("\\") || fileName.includes("..")) {
    throw new Error("invalid connector file name");
  }
  const base = path.basename(fileName);
  if (base !== fileName || base === "." || base === "..") {
    throw new Error("invalid connector file name");
  }
  return path.join(dir, base);
}
