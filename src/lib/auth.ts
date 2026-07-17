import { cookies } from "next/headers";
import { createHmac, timingSafeEqual } from "crypto";

const COOKIE_NAME = "homey_dashboard_session";

function expectedToken(password: string): string {
  return createHmac("sha256", password).update("homey-dashboard").digest("hex");
}

export async function isAuthenticated(): Promise<boolean> {
  const password = process.env.DASHBOARD_PASSWORD;
  if (!password) return false;
  const jar = await cookies();
  const value = jar.get(COOKIE_NAME)?.value;
  if (!value) return false;
  const expected = expectedToken(password);
  try {
    return timingSafeEqual(Buffer.from(value), Buffer.from(expected));
  } catch {
    return false;
  }
}

export function sessionCookieValue(password: string): string {
  return expectedToken(password);
}

export { COOKIE_NAME };
