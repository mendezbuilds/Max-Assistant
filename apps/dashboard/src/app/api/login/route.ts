import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, checkPassword, expectedSessionToken } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const password = String(form.get("password") ?? "");

  const url = new URL(req.url);

  if (!(await checkPassword(password))) {
    url.pathname = "/login";
    url.searchParams.set("error", "1");
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
