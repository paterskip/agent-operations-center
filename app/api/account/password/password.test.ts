import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import argon2 from "argon2";
import fs from "node:fs";
import { readFile } from "node:fs/promises";

vi.mock("argon2");
vi.mock("node:fs");
vi.mock("node:fs/promises");

const mockReadFile = vi.mocked(readFile);
const mockWriteFile = vi.mocked(fs.writeFileSync);
const mockRenameSync = vi.mocked(fs.renameSync);
const mockArgonVerify = vi.mocked(argon2.verify);
const mockArgonHash = vi.mocked(argon2.hash);

const env = process.env as Record<string, string | undefined>;
const savedUsername = env.AOC_USERNAME;
const savedPublicUrl = env.AOC_PUBLIC_URL;
const savedUsersDb = env.AOC_USERS_DB;

// Set required env BEFORE first dynamic import — route.ts reads these at module load
env.AOC_USERNAME = savedUsername ?? "ceo";
env.AOC_PUBLIC_URL = savedPublicUrl ?? "https://agents.example.com";
env.AOC_USERS_DB = "/fake/users.yml";

beforeEach(() => {
  env.AOC_USERNAME = savedUsername ?? "ceo";
  env.AOC_PUBLIC_URL = savedPublicUrl ?? "https://agents.example.com";
  vi.clearAllMocks();
});

afterEach(() => {
  env.AOC_USERNAME = savedUsername;
  env.AOC_PUBLIC_URL = savedPublicUrl;
  env.AOC_USERS_DB = savedUsersDb;
});

// Dynamic import after mocks are set up
const getHandler = async () => {
  const mod = await import("./route");
  return mod.POST;
};

describe("POST /api/account/password — CSRF origin check", () => {
  it("rejects mismatched origin with 403", async () => {
    const POST = await getHandler();
    const req = new NextRequest("https://agents.example.com/api/account/password", {
      method: "POST",
      headers: { origin: "https://evil.example.com", "content-type": "application/json" },
      body: JSON.stringify({ current: "oldpass1234", next: "newpassword12345" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
    expect(mockReadFile).not.toHaveBeenCalled();
  });

  it("rejects missing origin with 403", async () => {
    const POST = await getHandler();
    const req = new NextRequest("https://agents.example.com/api/account/password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ current: "oldpass1234", next: "newpassword12345" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  it("accepts matching origin and proceeds", async () => {
    const POST = await getHandler();
    mockReadFile.mockResolvedValue("users:\n  ceo:\n    password: 'fakehash'\n");
    mockArgonVerify.mockResolvedValue(true);
    mockArgonHash.mockResolvedValue("$argon2id$v=19$m=131072,t=5,p=4$validhash");
    const req = new NextRequest("https://agents.example.com/api/account/password", {
      method: "POST",
      headers: { origin: "https://agents.example.com", "content-type": "application/json" },
      body: JSON.stringify({ current: "oldpass1234", next: "newpassword12345" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
  });
});

describe("POST /api/account/password — input validation", () => {
  it("requires next password min length 12", async () => {
    const POST = await getHandler();
    const req = new NextRequest("https://agents.example.com/api/account/password", {
      method: "POST",
      headers: { origin: "https://agents.example.com", "content-type": "application/json" },
      body: JSON.stringify({ current: "oldpass1234", next: "short" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("rejects non-string current", async () => {
    const POST = await getHandler();
    const req = new NextRequest("https://agents.example.com/api/account/password", {
      method: "POST",
      headers: { origin: "https://agents.example.com", "content-type": "application/json" },
      body: JSON.stringify({ current: 12345, next: "newpassword12345" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("rejects missing current or next", async () => {
    const POST = await getHandler();
    const req = new NextRequest("https://agents.example.com/api/account/password", {
      method: "POST",
      headers: { origin: "https://agents.example.com", "content-type": "application/json" },
      body: JSON.stringify({ current: "", next: "newpassword12345" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});

describe("POST /api/account/password — verify + verify failure", () => {
  it("returns 401 when current password does not verify", async () => {
    const POST = await getHandler();
    mockReadFile.mockResolvedValue("users:\n  ceo:\n    password: '$argon2id$fake'\n");
    mockArgonVerify.mockResolvedValue(false);
    const req = new NextRequest("https://agents.example.com/api/account/password", {
      method: "POST",
      headers: { origin: "https://agents.example.com", "content-type": "application/json" },
      body: JSON.stringify({ current: "wrongpass", next: "newpassword12345" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("writes new hash when current password verifies", async () => {
    const POST = await getHandler();
    const fakeHash = "$argon2id$v=19$m=131072,t=5,p=4$ab salt$ab hash";
    const yamlContent = "users:\n  ceo:\n    password: '" + fakeHash + "'\n";
    mockReadFile.mockResolvedValue(yamlContent);
    mockArgonVerify.mockResolvedValue(true);
    mockArgonHash.mockResolvedValue("$argon2id$v=19$m=131072,t=5,p=4$rawhash");
    const req = new NextRequest("https://agents.example.com/api/account/password", {
      method: "POST",
      headers: { origin: "https://agents.example.com", "content-type": "application/json" },
      body: JSON.stringify({ current: "oldpass1234", next: "newpassword12345" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    // Should have written new content containing the new hash, not the old one
    expect(mockWriteFile).toHaveBeenCalledTimes(1);
    expect(mockRenameSync).toHaveBeenCalledTimes(1);
    const [path, content] = mockWriteFile.mock.calls[0];
    expect(path).toMatch(/^\/fake\/users\.yml\.\d+\.[0-9a-f-]+\.tmp$/);
    expect(content).not.toContain(fakeHash);
    expect((content as string)).toMatch(/\$argon2id\$v=19\$/);
    // rename should point tmp -> final
    const [, dst] = mockRenameSync.mock.calls[0];
    expect(dst).toBe("/fake/users.yml");
  });
});

describe("POST /api/account/password — YAML format parsing", () => {
  // Realny format Authelii: `users:` → `  <name>:` → `    password:`.
  const usersDoc = (entries: Record<string, string>) =>
    "users:\n" + Object.entries(entries).map(([name, hash]) =>
      `  ${name}:\n    disabled: false\n    password: '${hash}'\n`).join("");

  it("parses double-quoted password", async () => {
    const POST = await getHandler();
    mockReadFile.mockResolvedValue("users:\n  ceo:\n    password: \"doublequotedhash\"\n");
    mockArgonVerify.mockResolvedValue(true);
    mockArgonHash.mockResolvedValue("$argon2id$v=19$m=131072,t=5,p=4$r");
    const req = new NextRequest("https://agents.example.com/api/account/password", {
      method: "POST",
      headers: { origin: "https://agents.example.com", "content-type": "application/json" },
      body: JSON.stringify({ current: "oldpass1234", next: "newpassword12345" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(mockWriteFile).toHaveBeenCalledTimes(1);
    expect(mockRenameSync).toHaveBeenCalledTimes(1);
    const [, content] = mockWriteFile.mock.calls[0];
    expect((content as string)).not.toContain("doublequotedhash");
  });

  it("writes to the target user block, not the first password in the file", async () => {
    const POST = await getHandler();
    const adminHash = "$argon2id$v=19$m=131072,t=5,p=4$adminsalt$adminhash";
    const ceoHash = "$argon2id$v=19$m=131072,t=5,p=4$ceosalt$ceohash";
    mockReadFile.mockResolvedValue(usersDoc({ admin: adminHash, ceo: ceoHash }));
    mockArgonVerify.mockResolvedValue(true);
    mockArgonHash.mockResolvedValue("$argon2id$v=19$m=131072,t=5,p=4$newsalt$newhash");
    const req = new NextRequest("https://agents.example.com/api/account/password", {
      method: "POST",
      headers: { origin: "https://agents.example.com", "content-type": "application/json" },
      body: JSON.stringify({ current: "oldpass1234", next: "newpassword12345" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const [, content] = mockWriteFile.mock.calls[0] as [string, string];
    // The ceo hash is replaced; the admin hash is left untouched.
    expect(content).not.toContain(ceoHash);
    expect(content).toContain(adminHash);
    expect(content).toMatch(/^ {4}password: '\$argon2id\$v=19\$/m);
  });

  it("returns 500 when the target user has no password field", async () => {
    const POST = await getHandler();
    mockReadFile.mockResolvedValue("users:\n  ceo:\n    email: user@example.com\n");
    const req = new NextRequest("https://agents.example.com/api/account/password", {
      method: "POST",
      headers: { origin: "https://agents.example.com", "content-type": "application/json" },
      body: JSON.stringify({ current: "oldpass1234", next: "newpassword12345" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(500);
  });

  it("returns 500 when the user is absent from the file", async () => {
    const POST = await getHandler();
    mockReadFile.mockResolvedValue(usersDoc({ admin: "$argon2id$v=19$m=131072,t=5,p=4$s$h" }));
    const req = new NextRequest("https://agents.example.com/api/account/password", {
      method: "POST",
      headers: { origin: "https://agents.example.com", "content-type": "application/json" },
      body: JSON.stringify({ current: "oldpass1234", next: "newpassword12345" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(500);
  });

  it("concurrent requests do not corrupt: each writes full file atomically", async () => {
    const POST = await getHandler();
    const fakeHash = "$argon2id$v=19$m=131072,t=5,p=4$oldsalt$oldhash";
    const yamlContent = usersDoc({ ceo: fakeHash });
    mockReadFile.mockResolvedValue(yamlContent);
    mockArgonVerify.mockResolvedValue(true);
    mockArgonHash.mockImplementation(async () => `$argon2id$v=19$m=131072,t=5,p=4$${Math.random().toString(36).slice(2)}`);

    const mkReq = (next: string) => new NextRequest("https://agents.example.com/api/account/password", {
      method: "POST",
      headers: { origin: "https://agents.example.com", "content-type": "application/json" },
      body: JSON.stringify({ current: "oldpass1234", next }),
    });

    const results = await Promise.all([
      POST(mkReq("concurrentpass1!23")),
      POST(mkReq("concurrentpass4!56")),
      POST(mkReq("concurrentpass7!89")),
    ]);
    // All succeed — atomic write means no partial-file corruption
    for (const r of results) expect(r.status).toBe(200);
    // Each concurrent write used a distinct temp file (pid + distinct content), no clobbering
    expect(mockWriteFile).toHaveBeenCalledTimes(3);
    expect(mockRenameSync).toHaveBeenCalledTimes(3);
    const writtenContents = mockWriteFile.mock.calls.map((c) => c[1] as string);
    // Each write is a complete YAML replacing the old hash (no truncation/partial line)
    for (const wc of writtenContents) {
      expect(wc).not.toContain(fakeHash);
      expect(wc).toContain("  ceo:");
      expect(wc).toMatch(/password: '\$argon2id\$/);
    }
  });
});
