import { describe, expect, it } from "vitest";
import { unwrapBody } from "./body-unwrap";

describe("unwrapBody — kanban body envelope unwrap", () => {
  it("returns plain text untouched", () => {
    expect(unwrapBody("**Goal** do the thing")).toBe("**Goal** do the thing");
    expect(unwrapBody("")).toBe("");
    expect(unwrapBody(null)).toBe(null);
  });

  it("unwraps a valid JSON envelope", () => {
    expect(unwrapBody('{"title":"T","body":"właściwy tekst"}')).toBe("właściwy tekst");
  });

  it("unwraps a TRUNCATED envelope (real-world regression)", () => {
    // Envelope cut mid-body must still yield the body text.
    const truncated = '{"title":"T","body":"**Goal**\ndo it\n';
    expect(unwrapBody(truncated)).toBe("**Goal**\ndo it\n");
  });

  it("decodes \\uXXXX escapes (QA regression)", () => {
    expect(unwrapBody('{"title":"T","body":"polityk\\u0119 prywatno\\u015bci"}')).toBe("politykę prywatności");
  });

  it("decodes \\n \\t \\r \\\" \\\\ escapes in truncated body", () => {
    expect(unwrapBody('{"body":"a\\nb\\tc\\"d\\\\e"}')).toBe('a\nb\tc"d\\e');
  });

  it("falls back to raw when body has no envelope shape", () => {
    expect(unwrapBody('{"not_a_body_key": 1}')).toBe('{"not_a_body_key": 1}');
  });
});
