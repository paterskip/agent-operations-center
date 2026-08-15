import { NextResponse } from "next/server";
import fs from "node:fs";
import crypto from "node:crypto";
import argon2 from "argon2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const USERS_DB = process.env.AOC_USERS_DB || "/data/authelia/users_database.yml";
const PARAMS = { type: argon2.argon2id as 2, timeCost: 5, memoryCost: 131072, parallelism: 4, hashLength: 32 };

// PHC w dokładnym formacie Authelii: $argon2id$v=19$m=...,t=...,p=...$salt$hash (bez paddingu =)
function phc(salt: Buffer, hash: Buffer): string {
  const b64 = (b: Buffer) => b.toString("base64").replace(/=+$/, "");
  return `$argon2id$v=19$m=${PARAMS.memoryCost},t=${PARAMS.timeCost},p=${PARAMS.parallelism}$${b64(salt)}$${b64(hash)}`;
}

export async function POST(request: Request) {
  const expectedOrigin = process.env.AOC_PUBLIC_URL || "https://agents.paterski.com";
  if (request.headers.get("origin") !== expectedOrigin) return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });

  let body: { current?: string; next?: string } = {};
  try { body = await request.json(); } catch { /* 400 poniżej */ }

  const { current, next } = body;
  if (!current || typeof current !== "string" || !next || typeof next !== "string" || next.length < 12) {
    return NextResponse.json({ error: "Nowe hasło musi mieć co najmniej 12 znaków." }, { status: 400 });
  }

  let txt: string;
  try { txt = fs.readFileSync(USERS_DB, "utf8"); }
  catch { return NextResponse.json({ error: "Brak dostępu do magazynu haseł." }, { status: 500 }); }

  const m = txt.match(/password: ['"]([^'"]+)['"]/);
  if (!m) return NextResponse.json({ error: "Nie znaleziono wpisu hasła." }, { status: 500 });
  const storedHash = m[1];

  const ok = await argon2.verify(storedHash, current).catch(() => false);
  if (!ok) return NextResponse.json({ error: "Obecne hasło jest niepoprawne." }, { status: 401 });

  const salt = crypto.randomBytes(16);
  const raw = await argon2.hash(next, { ...PARAMS, salt, raw: true });
  const newHash = phc(salt, Buffer.from(raw));

  // zapis in-place (ten sam inode → file-watcher Authelii widzi zmianę)
  fs.writeFileSync(USERS_DB, txt.replace(storedHash, newHash));
  return NextResponse.json({ ok: true });
}
