const REQUIRED_GOOGLE_AUTH_ENV = [
  "AUTH_SECRET",
  "AUTH_GOOGLE_ID",
  "AUTH_GOOGLE_SECRET",
] as const;

/** Report missing names only; never expose credential values to the UI. */
export function getGoogleAuthConfiguration() {
  const missing = REQUIRED_GOOGLE_AUTH_ENV.filter(
    (name) => !process.env[name]?.trim(),
  );
  return { configured: missing.length === 0, missing: [...missing] };
}
