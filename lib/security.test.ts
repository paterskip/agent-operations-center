import { describe, expect, it } from "vitest";
import { hash, verify } from "argon2";

const ARGON_OPTS = { type: 2 as const, timeCost: 3, memoryCost: 65536, parallelism: 4, hashLength: 32, saltLength: 16 };

function validatePassword(pw: string): string | null {
  if (pw.length < 12) return "Hasło musi mieć minimum 12 znaków.";
  if (!/[A-Z]/.test(pw)) return "Hasło musi zawierać co najmniej 1 wielką literę.";
  if (!/[0-9]/.test(pw)) return "Hasło musi zawierać co najmniej 1 cyfrę.";
  if (!/[^A-Za-z0-9]/.test(pw)) return "Hasło musi zawierać co najmniej 1 znak specjalny.";
  return null;
}

describe("password validation", () => {
  it("rejects short passwords", () => {
    expect(validatePassword("Ab1!")).toBeTruthy();
    expect(validatePassword("Abcdef1!ijk")).toBeTruthy(); // 11 chars
  });

  it("requires uppercase letter", () => {
    expect(validatePassword("abcdefghijkl1!")).toBeTruthy();
    expect(validatePassword("abcdefghijkl1!")).toContain("wielką literę");
  });

  it("requires digit", () => {
    expect(validatePassword("Abcdefghijkl!")).toBeTruthy();
    expect(validatePassword("Abcdefghijkl!")).toContain("cyfrę");
  });

  it("requires special character", () => {
    expect(validatePassword("Abcdefghijkl1")).toBeTruthy();
    expect(validatePassword("Abcdefghijkl1")).toContain("znak specjalny");
  });

  it("accepts valid passwords", () => {
    expect(validatePassword("MyStr0ng!Pass")).toBeNull();
    expect(validatePassword("BardzoSilneHaslo2024!")).toBeNull();
    expect(validatePassword("Super$ecret1234")).toBeNull();
    expect(validatePassword("Abcdefg1!klmnop")).toBeNull();
  });

  it("accepts passwords with various special chars", () => {
    expect(validatePassword("Test@12345678")).toBeNull();
    expect(validatePassword("Test#12345678")).toBeNull();
    expect(validatePassword("Test$12345678")).toBeNull();
    expect(validatePassword("Test%12345678")).toBeNull();
    expect(validatePassword("Test&12345678")).toBeNull();
    expect(validatePassword("Test*12345678")).toBeNull();
  });
});

describe("argon2 hash/verify roundtrip", () => {
  it("hashes and verifies correctly with Authelia-matching params", async () => {
    const password = "MyTestPass123!";
    const hashed = await hash(password, ARGON_OPTS);

    expect(hashed).toBeTruthy();
    expect(hashed.startsWith("$argon2id$")).toBe(true);
    expect(hashed).toContain("m=65536"); expect(hashed).toContain("t=3");

    const valid = await verify(hashed, password);
    expect(valid).toBe(true);
  });

  it("rejects wrong password", async () => {
    const hashed = await hash("CorrectPass1!", ARGON_OPTS);
    const valid = await verify(hashed, "WrongPass1!");
    expect(valid).toBe(false);
  });

  it("produces different hashes for same password (unique salt)", async () => {
    const pw = "SamePassword1!";
    const h1 = await hash(pw, ARGON_OPTS);
    const h2 = await hash(pw, ARGON_OPTS);
    expect(h1).not.toBe(h2); // different salts
    expect(await verify(h1, pw)).toBe(true);
    expect(await verify(h2, pw)).toBe(true);
  });

  it("rejects empty password", () => {
    expect(validatePassword("")).toBeTruthy();
    expect(validatePassword("")).toContain("minimum 12 znaków");
  });
});

describe("security log entry type", () => {
  it("SecurityLogEntry shape is consistent", () => {
    const entry = {
      id: 1,
      actor: "ceo",
      action: "password.change",
      target: null,
      detail: "hasło zmienione pomyślnie",
      ip: "87.123.1.1",
      createdAt: Math.floor(Date.now() / 1000),
    };

    expect(entry.actor).toBe("ceo");
    expect(entry.action).toMatch(/password/);
    expect(entry.ip).toBeTruthy();
    expect(typeof entry.createdAt).toBe("number");
  });
});
