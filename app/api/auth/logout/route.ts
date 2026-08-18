import { NextResponse } from "next/server";

export async function POST() {
  // Clear any session / proxy auth cookies
  const response = NextResponse.json({ ok: true, message: "Logged out successfully" });
  response.cookies.delete("session");
  response.cookies.delete("aoc_session");
  response.cookies.delete("token");
  return response;
}
