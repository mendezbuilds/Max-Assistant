import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, checkPassword, expectedSessionToken } from "@/lib/auth";
import { loginWithLockout } from "@/lib/login-lockout";

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const password = String(form.get("password") ?? "");

  const url = new URL(req.url);
  url.pathname = "/login";
  url.search = "";

  // Attempts are limited: 5 consecutive failures lock logging in for 15 minutes. The password is
  // only checked by the attempt that wins a slot, never while locked (see lib/login-lockout.ts).
  const result = await loginWithLockout(() => checkPassword(password));

  if (!result.ok) {
    if (result.reason === "locked") {
      url.searchParams.set("error", "locked");
      url.searchParams.set("mins", String(result.retryInMinutes));
    } else if (result.justLocked) {
      url.searchParams.set("error", "locked");
      url.searchParams.set("mins", "15");
    } else {
      url.searchParams.set("error", "wrong");
      url.searchParams.set("left", String(result.attemptsRemaining));
    }
    return NextResponse.redirect(url, { status: 303 });
  }

  url.pathname = "/";
  url.search = "";
  const res = NextResponse.redirect(url, { status: 303 });
  res.cookies.set(SESSION_COOKIE, await expectedSessionToken(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });
  return res;
}
