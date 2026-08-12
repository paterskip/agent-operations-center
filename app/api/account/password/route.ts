import { NextRequest, NextResponse } from "next/server";
import { readFileSync, writeFileSync } from "node:fs";
import { hash, verify } from "argon2";
import { audit } from "@/lib/state";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const USERS_PATH = process.env.AUTHELIA_USERS_PATH || "deploy/authelia/users_database.yml";
const ARGON_OPTS = { type: 2 as const, timeCost: 3, memoryCost: 65536, parallelism: 4, hashLength: 32, saltLength: 16 };

function readUsersYaml(): string {
  // Ścieżka pochodzi z env (AUTHELIA_USERS_PATH) i jest rozwiązywana dopiero w runtime.
  // turbopackIgnore zapobiega tracowaniu całego projektu do outputu build-time.
  return readFileSync(/*turbopackIgnore: true*/ USERS_PATH, "utf8");
}

function writeUsersYaml(content: string): void {
  writeFileSync(/*turbopackIgnore: true*/ USERS_PATH, content, "utf8");
}

function extractPasswordHash(yaml: string, username: string): string | null {
  const lines = yaml.split("\n");
  let inUser = false;
  for (const line of lines) {
    if (line.trim() === `${username}:`) { inUser = true; continue; }
    if (inUser && line.match(/^\s{2}\w/)) break; // next top-level key
    if (inUser) {
      const m = line.match(/^\s{4}password:\s*['"]?([^'"]+)['"]?/);
      if (m) return m[1];
    }
  }
  return null;
}

function replacePasswordHash(yaml: string, username: string, newHash: string): string {
  const lines = yaml.split("\n");
  let inUser = false;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === `${username}:`) { inUser = true; continue; }
    if (inUser && lines[i].match(/^\s{2}\w/)) break; // next top-level key
    if (inUser && lines[i].match(/^\s{4}password:/)) {
      lines[i] = lines[i].replace(/password:\s*['"]?[^'"]+['"]?/, `password: '${newHash}'`);
      break;
    }
  }
  return lines.join("\n");
}

function validatePassword(pw: string): string | null {
  if (pw.length < 12) return "Hasło musi mieć minimum 12 znaków.";
  if (!/[A-Z]/.test(pw)) return "Hasło musi zawierać co najmniej 1 wielką literę.";
  if (!/[0-9]/.test(pw)) return "Hasło musi zawierać co najmniej 1 cyfrę.";
  if (!/[^A-Za-z0-9]/.test(pw)) return "Hasło musi zawierać co najmniej 1 znak specjalny.";
  return null;
}

function ip(request: NextRequest): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

export async function POST(request: NextRequest) {
  const expectedOrigin = process.env.AOC_PUBLIC_URL || "https://agents.paterski.com";
  if (request.headers.get("origin") !== expectedOrigin) {
    return NextResponse.json({ error: "Nieprawidłowe źródło żądania" }, { status: 403 });
  }
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return NextResponse.json({ error: "Wymagany JSON" }, { status: 415 });
  }

  const username = request.headers.get("remote-user") || "";
  if (username !== process.env.AOC_USERNAME) {
    return NextResponse.json({ error: "Brak autoryzacji" }, { status: 401 });
  }

  try {
    const body = await request.json() as Record<string, unknown>;
    const currentPassword = String(body.currentPassword || "");
    const newPassword = String(body.newPassword || "");

    // Validate passwords
    const pwError = validatePassword(newPassword);
    if (pwError) return NextResponse.json({ error: pwError }, { status: 400 });
    if (currentPassword === newPassword) {
      return NextResponse.json({ error: "Nowe hasło musi być inne niż obecne." }, { status: 400 });
    }

    // Read current users DB
    const yaml = readUsersYaml();
    const currentHash = extractPasswordHash(yaml, username);
    if (!currentHash) {
      return NextResponse.json({ error: "Nie znaleziono użytkownika w bazie." }, { status: 500 });
    }

    // Verify current password
    const valid = await verify(currentHash, currentPassword);
    if (!valid) {
      audit(username, "password.failed", null, `nieprawidłowe obecne hasło`, ip(request));
      return NextResponse.json({ error: "Obecne hasło jest nieprawidłowe." }, { status: 400 });
    }

    // Hash new password
    const newHash = await hash(newPassword, ARGON_OPTS);

    // Write updated config
    const updated = replacePasswordHash(yaml, username, newHash);
    writeUsersYaml(updated);

    // Audit
    audit(username, "password.change", null, `hasło zmienione pomyślnie`, ip(request));

    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: "Nie udało się zmienić hasła. Spróbuj ponownie." }, { status: 500 });
  }
}
