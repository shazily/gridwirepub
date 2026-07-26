import { describe, expect, test } from "bun:test";

import {
  assertSafeStorageKeyPart,
  resolveSafeStoragePath,
  UnsafeStoragePathError,
} from "../../src/lib/storage.server";

function expectUnsafe(
  fn: () => unknown,
  reason: string,
  messageIncludes?: string,
) {
  try {
    fn();
    throw new Error(`expected UnsafeStoragePathError(${reason}) but nothing was thrown`);
  } catch (error) {
    expect(error).toBeInstanceOf(UnsafeStoragePathError);
    const err = error as UnsafeStoragePathError;
    expect(err.reason).toBe(reason);
    if (messageIncludes) {
      expect(err.message).toContain(messageIncludes);
    }
  }
}

describe("storage path jail", () => {
  test("rejects parent segments", () => {
    expectUnsafe(
      () => resolveSafeStoragePath("/tmp/org", "../etc/passwd"),
      "parent_segment",
      "parent_segment",
    );
  });

  test("rejects absolute segments", () => {
    expectUnsafe(
      () => resolveSafeStoragePath("/tmp/org", "/etc/passwd"),
      "absolute_path",
      "absolute_path",
    );
  });

  test("rejects null bytes", () => {
    expectUnsafe(
      () => resolveSafeStoragePath("/tmp/org", "file\0name.csv"),
      "null_byte",
      "null_byte",
    );
  });

  test("rejects literal percent-encoded null (%00)", () => {
    expectUnsafe(
      () => resolveSafeStoragePath("/tmp/org", "file%00.sh"),
      "encoded_null",
      "encoded_null",
    );
    expectUnsafe(() => assertSafeStorageKeyPart("report%00.xlsx"), "encoded_null");
  });

  test("rejects double-encoded null (%2500)", () => {
    expectUnsafe(
      () => resolveSafeStoragePath("/tmp/org", "file%2500.sh"),
      "double_encoded_traversal",
      "double_encoded_traversal",
    );
  });

  test("rejects percent-encoded parent (%2e%2e)", () => {
    expectUnsafe(
      () => resolveSafeStoragePath("/tmp/org", "%2e%2e/passwd"),
      "encoded_parent",
      "encoded_parent",
    );
  });

  test("rejects percent-encoded separators", () => {
    expectUnsafe(
      () => resolveSafeStoragePath("/tmp/org", "a%2fb.csv"),
      "encoded_separator",
      "encoded_separator",
    );
    expectUnsafe(() => assertSafeStorageKeyPart("a%5cb.csv"), "encoded_separator");
  });

  test("rejects empty and invalid key parts with typed errors", () => {
    expectUnsafe(() => assertSafeStorageKeyPart(""), "empty_input");
    expectUnsafe(() => assertSafeStorageKeyPart(".."), "dot_segment");
    expectUnsafe(() => assertSafeStorageKeyPart("/abs"), "nested_segment");
    expectUnsafe(() => assertSafeStorageKeyPart("bad\\slash"), "nested_segment");
  });

  test("allows safe filenames and returns opaque keys under the tenant prefix", () => {
    const key = resolveSafeStoragePath("/tmp/org", "report.csv");
    expect(key.startsWith("tmp/org/")).toBe(true);
    expect(key.endsWith(".csv")).toBe(true);
    expect(key.toLowerCase().includes("report")).toBe(false);
  });
});
