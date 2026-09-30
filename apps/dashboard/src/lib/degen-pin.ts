import { NextResponse } from "next/server";
import type { PinCheckResult } from "@max/shared";

/**
 * Converts a verifyPinWithLockout() result into the 401/403/429 response
 * every PIN-gated dashboard route should return — one place for this
 * mapping so all 4 routes (trade, wallet/send, wallet DELETE, pin change)
 * respond identically instead of drifting.
 */
export function pinRejectionResponse(result: Exclude<PinCheckResult, { ok: true }>): NextResponse {
  switch (result.reason) {
    case "no_user":
    case "no_pin_set":
      return NextResponse.json({ error: "No PIN set. Set one in Telegram first." }, { status: 400 });
    case "locked":
      return NextResponse.json(
        { error: `Too many incorrect PIN attempts. Try again in ${result.retryInMinutes} minute(s).` },
        { status: 429 }
      );
    case "incorrect":
      // justLocked: this IS the attempt that triggered the lockout — say
      // so now (429), not the generic "incorrect" (403) that invites an
      // immediate retry the backend will just reject anyway.
      if (result.justLocked) {
        return NextResponse.json(
          { error: "Too many incorrect PIN attempts. Your account is now locked for 15 minutes." },
          { status: 429 }
        );
      }
      return NextResponse.json({ error: "Incorrect PIN" }, { status: 403 });
  }
}
