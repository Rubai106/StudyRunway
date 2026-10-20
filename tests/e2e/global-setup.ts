import { encode } from "next-auth/jwt";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { E2E_AUTH_SECRET } from "./auth-state";

export default async function globalSetup() {
  const cookieName = "authjs.session-token";
  const token = await encode({
    token: {
      sub: "playwright-student",
      name: "StudyRunway Test Student",
      email: "playwright-student@example.test",
    },
    secret: E2E_AUTH_SECRET,
    salt: cookieName,
  });
  const statePath = path.join(process.cwd(), "test-results", "e2e-auth-state.json");
  await mkdir(path.dirname(statePath), { recursive: true });
  await writeFile(statePath, JSON.stringify({
    cookies: [{
      name: cookieName,
      value: token,
      domain: "localhost",
      path: "/",
      expires: -1,
      httpOnly: true,
      secure: false,
      sameSite: "Lax",
    }],
    origins: [],
  }));
}
