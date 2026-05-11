import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { getActiveClock } from '../_core/clock';
import { ForbiddenError } from "@shared/_core/errors";
import { parse as parseCookieHeader } from "cookie";
import type { Request } from "express";
import { SignJWT, jwtVerify } from "jose";
import type { User } from "../../drizzle/schema";
import * as db from "../db";
import { ENV } from "./env";

/**
 * AWS Cognito OIDC SDK.
 *
 * Replaces the previous Manus `/webdev.v1.WebDevAuthPublicService/*` gRPC-ish
 * endpoints with Cognito's standard OAuth2 / OIDC endpoints:
 *   - POST {COGNITO_DOMAIN}/oauth2/token      — code → tokens
 *   - GET  {COGNITO_DOMAIN}/oauth2/userInfo   — access token → user claims
 *
 * The external contract on `SDKServer` (exchangeCodeForToken, getUserInfo,
 * createSessionToken, verifySession, authenticateRequest) is unchanged so the
 * existing oauth.ts callback and context.ts middleware keep working.
 */

// Utility function
const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

export type SessionPayload = {
  openId: string;
  appId: string;
  name: string;
};

// Normalized response shapes — callers still see camelCase keys.
export type ExchangeTokenResponse = {
  accessToken: string;
  tokenType: string;
  expiresIn: number;
  refreshToken?: string;
  scope: string;
  idToken: string;
};

export type GetUserInfoResponse = {
  openId: string;
  name: string;
  email?: string | null;
  platform?: string | null;
  loginMethod?: string | null;
};

const OAUTH_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 500;

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const isRetryableStatus = (status: number) => status >= 500 && status < 600;

const isRetryableError = (error: unknown): boolean => {
  if (error instanceof Error) {
    // fetch throws TypeError on network failure; timeout → AbortError
    if (error.name === "AbortError") return true;
    if (error.name === "TypeError") return true;
    // Our thrown HTTP errors carry status in the message — cheap parse.
    const m = /HTTP (\d{3})/.exec(error.message);
    if (m) return isRetryableStatus(parseInt(m[1], 10));
  }
  return false;
};

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function requestWithRetry<T>(
  operation: () => Promise<T>,
  operationName: string,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      if (attempt > 0) {
        console.log(`[OAuth] ${operationName} retry attempt ${attempt}/${MAX_RETRIES}`);
        await delay(RETRY_DELAY_MS * attempt);
      }
      return await operation();
    } catch (error) {
      lastError = error;
      console.error(
        `[OAuth] ${operationName} attempt ${attempt + 1} failed:`,
        error instanceof Error ? error.message : "Unknown error",
      );

      if (!isRetryableError(error) || attempt === MAX_RETRIES) {
        throw error;
      }
    }
  }

  throw lastError;
}

class CognitoOAuthService {
  constructor(
    private readonly domain: string,
    private readonly clientId: string,
    private readonly clientSecret: string,
  ) {
    console.log("[OAuth] Cognito SDK initialized with domain:", domain);
    if (!domain || !clientId || !clientSecret) {
      console.error(
        "[OAuth] ERROR: Cognito is not fully configured. " +
          "Set COGNITO_DOMAIN, COGNITO_CLIENT_ID, and COGNITO_CLIENT_SECRET.",
      );
    }
  }

  private decodeState(state: string): string {
    // state is base64-encoded JSON { redirectUri, rememberMe } or a plain URI.
    try {
      const decoded = Buffer.from(state, "base64").toString("utf-8");
      if (decoded.startsWith("{")) {
        const parsed = JSON.parse(decoded);
        return typeof parsed.redirectUri === "string" ? parsed.redirectUri : "";
      }
      return decoded;
    } catch {
      return "";
    }
  }

  private basicAuthHeader(): string {
    const raw = `${this.clientId}:${this.clientSecret}`;
    return `Basic ${Buffer.from(raw, "utf-8").toString("base64")}`;
  }

  async exchangeCode(code: string, state: string): Promise<ExchangeTokenResponse> {
    const redirectUri = this.decodeState(state) || ENV.cognitoRedirectUri;
    if (!redirectUri) {
      throw new Error("Redirect URI missing (state empty and COGNITO_REDIRECT_URI unset)");
    }

    const url = `${this.domain}/oauth2/token`;
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: this.clientId,
    });

    return requestWithRetry(async () => {
      const res = await fetchWithTimeout(
        url,
        {
          method: "POST",
          headers: {
            "content-type": "application/x-www-form-urlencoded",
            authorization: this.basicAuthHeader(),
          },
          body: body.toString(),
        },
        OAUTH_TIMEOUT_MS,
      );

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Cognito token exchange failed: HTTP ${res.status} – ${text}`);
      }

      const raw = (await res.json()) as {
        access_token: string;
        id_token: string;
        refresh_token?: string;
        token_type: string;
        expires_in: number;
        scope?: string;
      };

      return {
        accessToken: raw.access_token,
        idToken: raw.id_token,
        refreshToken: raw.refresh_token,
        tokenType: raw.token_type,
        expiresIn: raw.expires_in,
        scope: raw.scope ?? "openid email profile",
      };
    }, "exchangeCode");
  }

  async getUserInfo(accessToken: string): Promise<GetUserInfoResponse> {
    const url = `${this.domain}/oauth2/userInfo`;

    return requestWithRetry(async () => {
      const res = await fetchWithTimeout(
        url,
        {
          method: "GET",
          headers: {
            authorization: `Bearer ${accessToken}`,
          },
        },
        OAUTH_TIMEOUT_MS,
      );

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Cognito userInfo failed: HTTP ${res.status} – ${text}`);
      }

      const raw = (await res.json()) as {
        sub: string;
        email?: string;
        email_verified?: string | boolean;
        name?: string;
        username?: string;
        "cognito:username"?: string;
        identities?: string;
      };

      // Infer a login-method label for UI ("google" / "email" / …).
      const loginMethod = deriveLoginMethodFromIdentities(raw.identities);

      return {
        openId: raw.sub,
        name: raw.name || raw.username || raw["cognito:username"] || "",
        email: raw.email ?? null,
        platform: loginMethod,
        loginMethod,
      };
    }, "getUserInfo");
  }
}

// Cognito returns identities as a JSON string when federated; e.g.
// '[{"providerName":"Google","providerType":"Google",...}]'. When the user is
// a native Cognito user it's absent → treat as "email".
const deriveLoginMethodFromIdentities = (
  identities: string | undefined,
): string => {
  if (!identities) return "email";
  try {
    const parsed = JSON.parse(identities) as Array<{ providerName?: string; providerType?: string }>;
    const first = Array.isArray(parsed) ? parsed[0] : undefined;
    const name = first?.providerName || first?.providerType;
    return typeof name === "string" && name.length > 0 ? name.toLowerCase() : "email";
  } catch {
    return "email";
  }
};

class SDKServer {
  private readonly oauth: CognitoOAuthService;

  constructor() {
    this.oauth = new CognitoOAuthService(
      ENV.cognitoDomain,
      ENV.cognitoClientId,
      ENV.cognitoClientSecret,
    );
  }

  /**
   * Exchange OAuth authorization code for tokens.
   * @example
   * const tokenResponse = await sdk.exchangeCodeForToken(code, state);
   */
  async exchangeCodeForToken(code: string, state: string): Promise<ExchangeTokenResponse> {
    return this.oauth.exchangeCode(code, state);
  }

  /**
   * Get user information from the Cognito userInfo endpoint.
   * @example
   * const userInfo = await sdk.getUserInfo(tokenResponse.accessToken);
   */
  async getUserInfo(accessToken: string): Promise<GetUserInfoResponse> {
    return this.oauth.getUserInfo(accessToken);
  }

  private parseCookies(cookieHeader: string | undefined) {
    if (!cookieHeader) {
      return new Map<string, string>();
    }

    const parsed = parseCookieHeader(cookieHeader);
    return new Map(Object.entries(parsed));
  }

  private getSessionSecret() {
    const secret = ENV.cookieSecret;
    return new TextEncoder().encode(secret);
  }

  /**
   * Create a session token for an authenticated user.
   * @example
   * const sessionToken = await sdk.createSessionToken(userInfo.openId);
   */
  async createSessionToken(
    openId: string,
    options: { expiresInMs?: number; name?: string } = {},
  ): Promise<string> {
    return this.signSession(
      {
        openId,
        appId: ENV.appId,
        name: options.name || "",
      },
      options,
    );
  }

  async signSession(
    payload: SessionPayload,
    options: { expiresInMs?: number } = {},
  ): Promise<string> {
    const issuedAt = getActiveClock().now();
    const expiresInMs = options.expiresInMs ?? ONE_YEAR_MS;
    const expirationSeconds = Math.floor((issuedAt + expiresInMs) / 1000);
    const secretKey = this.getSessionSecret();

    return new SignJWT({
      openId: payload.openId,
      appId: payload.appId,
      name: payload.name,
    })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setExpirationTime(expirationSeconds)
      .sign(secretKey);
  }

  async verifySession(
    cookieValue: string | undefined | null,
  ): Promise<{ openId: string; appId: string; name: string } | null> {
    if (!cookieValue) {
      console.warn("[Auth] Missing session cookie");
      return null;
    }

    try {
      const secretKey = this.getSessionSecret();
      const { payload } = await jwtVerify(cookieValue, secretKey, {
        algorithms: ["HS256"],
      });
      const { openId, appId, name } = payload as Record<string, unknown>;

      // Only openId and appId are strictly required - name can be empty
      if (!isNonEmptyString(openId) || !isNonEmptyString(appId)) {
        console.warn("[Auth] Session payload missing required fields (openId or appId)", {
          openId: !!openId,
          appId: !!appId,
        });
        return null;
      }

      const validName = typeof name === "string" ? name : "";

      return {
        openId,
        appId,
        name: validName,
      };
    } catch (error) {
      console.warn("[Auth] Session verification failed", String(error));
      return null;
    }
  }

  async authenticateRequest(req: Request): Promise<User> {
    const cookies = this.parseCookies(req.headers.cookie);
    const sessionCookie = cookies.get(COOKIE_NAME);
    const session = await this.verifySession(sessionCookie);

    if (!session) {
      throw ForbiddenError("Invalid session cookie");
    }

    const sessionUserId = session.openId;
    const signedInAt = new Date();
    const user = await db.getUserByOpenId(sessionUserId);

    // Cognito flow: the user row is created at OAuth callback. If the DB is
    // missing the user but the session is valid, treat it as a stale session
    // and force re-login instead of the old Manus `getUserInfoWithJwt` sync.
    if (!user) {
      console.warn("[Auth] Valid session but user missing in DB — requiring re-login", {
        openId: sessionUserId,
      });
      throw ForbiddenError("User not found — please sign in again");
    }

    await db.upsertUser({
      openId: user.openId,
      email: user.email || "",
      lastSignedIn: signedInAt,
    });

    return user;
  }
}

export const sdk = new SDKServer();
