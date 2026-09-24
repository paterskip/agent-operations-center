import { NextResponse } from "next/server";
import fs from "node:fs";
import { readFile } from "node:fs/promises";
import crypto from "node:crypto";
import argon2 from "argon2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const USERS_DB = "/data/authelia/users_database.yml";
const PARAMS = { type: argon2.argon2id as 2, timeCost: 5, memoryCost: 131072, parallelism: 4, hashLength: 32 };

// PHC w dokładnym formacie Authelii: $argon2id$v=19$m=...,t=...,p=...$salt$hash (bez paddingu =)
function phc(salt: Buffer, hash: Buffer): string {
  const b64 = (b: Buffer) => b.toString("base64").replace(/=+$/, "");
  return `$argon2id$v=19$m=${PARAMS.memoryCost},t=${PARAMS.timeCost},p=${PARAMS.parallelism}$${b64(salt)}$${b64(hash)}`;
}

function findPasswordLine(text: string, username: string): { line: string; hash: string; start: number; end: number } | null {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => line === `  ${username}:`);
  if (start >= 0) {
    const endOffset = lines.slice(start + 1).findIndex((line) => /^ {2}\S[^:]*:\s*$/.test(line));
    const end = endOffset < 0 ? lines.length : start + 1 + endOffset;
    const passwordIndex = lines.slice(start + 1, end).findIndex((line) => /^ {4}password:\s*'([^']+)'\s*$/.test(line));
    if (passwordIndex >= 0) {
      const lineIndex = start + 1 + passwordIndex;
      const match = lines[lineIndex].match(/^ {4}password:\s*'([^']+)'\s*$/);
      if (match) return { line: lines[lineIndex], hash: match[1], start: lineIndex, end };
    }
  }
  const legacyIndex = lines.findIndex((line) => /^\s*password:\s*['"][^'"]+['"]\s*$/.test(line));
  if (legacyIndex < 0) return null;
  const legacyMatch = lines[legacyIndex].match(/^\s*password:\s*['"]([^'"]+)['"]\s*$/);
  return legacyMatch ? { line: lines[legacyIndex], hash: legacyMatch[1], start: legacyIndex, end: legacyIndex + 1 } : null;
}

function atomicWrite(path: string, content: string) {
  const temp = `${path}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temp, content, { encoding: "utf8", mode: 0o600, flag: "wx" });
  fs.renameSync(temp, path);
  fs.chmodSync(path, 0o600);
}

export async function POST(request: Request) {
  const expectedOrigin = process.env.AOC_PUBLIC_URL || "https://agents.paterski.com";
  if (request.headers.get("origin") !== expectedOrigin) return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });

  let body: { current?: string; next?: string } = {};
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Nieprawidłowy JSON." }, { status: 400 }); }

  const username = process.env.AOC_USERNAME || "ceo";
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(username)) return NextResponse.json({ error: "Nieprawidłowy użytkownik." }, { status: 500 });
  const { current, next } = body;
  if (typeof current !== "string" || current.length < 1 || current.length > 512 || typeof next !== "string" || next.length < 12 || next.length > 256) {
    return NextResponse.json({ error: "Nowe hasło musi mieć od 12 do 256 znaków." }, { status: 400 });
  }

  let text: string;
  try { text = await readFile(USERS_DB, "utf8"); }
  catch { return NextResponse.json({ error: "Brak dostępu do magazynu haseł." }, { status: 500 }); }

  const passwordLine = findPasswordLine(text, username);
  if (!passwordLine) return NextResponse.json({ error: "Nie znaleziono wpisu hasła." }, { status: 500 });
  const ok = await argon2.verify(passwordLine.hash, current).catch(() => false);
  if (!ok) return NextResponse.json({ error: "Obecne hasło jest niepoprawne." }, { status: 401 });

  const salt = crypto.randomBytes(16);
  const raw = await argon2.hash(next, { ...PARAMS, salt, raw: true });
  const newHash = phc(salt, Buffer.from(raw));
  const lines = text.split("\n");
  lines[passwordLine.start] = `    password: '${newHash}'`;
  try { atomicWrite(USERS_DB, lines.join("\n")); }
  catch { return NextResponse.json({ error: "Nie udało się zapisać hasła." }, { status: 500 }); }
  return NextResponse.json({ ok: true });
}
