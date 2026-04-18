import { randomBytes } from 'crypto';

/**
 * Resolve JWT secret: fatal in production if missing, random-per-process in dev.
 */
function resolveJwtSecret(): string {
  const envSecret = process.env.JWT_SECRET;
  if (envSecret && envSecret.length >= 16) {
    return envSecret;
  }

  if (process.env.NODE_ENV === 'production') {
    console.error('[FATAL] JWT_SECRET is missing or too short (min 16 chars). Cannot start in production.');
    process.exit(1);
  }

  const devSecret = randomBytes(48).toString('base64');
  console.warn('[SECURITY] JWT_SECRET not set — using random per-process secret. Sessions will not persist across restarts.');
  return devSecret;
}

const JWT_SECRET_RESOLVED = resolveJwtSecret();

export const ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: JWT_SECRET_RESOLVED,
  jwtSecret: JWT_SECRET_RESOLVED,
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
  encryptionMasterKey: process.env.ENCRYPTION_MASTER_KEY ?? "",
  redisUrl: process.env.REDIS_URL ?? "",
  metaapiToken: process.env.METAAPI_TOKEN ?? "",
  whaleAlertApiKey: process.env.WHALE_ALERT_API_KEY ?? "",
  coinApiKey: process.env.COINAPI_KEY ?? "",
  corsOrigins: process.env.CORS_ORIGINS ?? "",
};
