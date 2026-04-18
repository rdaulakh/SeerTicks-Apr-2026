import type { CookieOptions, Request } from "express";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function isSecureRequest(req: Request) {
  // With trust proxy enabled, req.protocol should correctly reflect HTTPS
  if (req.protocol === "https") return true;

  // Check x-forwarded-proto header (common for proxies)
  const forwardedProto = req.headers["x-forwarded-proto"];
  if (forwardedProto) {
    const protoList = Array.isArray(forwardedProto)
      ? forwardedProto
      : forwardedProto.split(",");
    if (protoList.some(proto => proto.trim().toLowerCase() === "https")) {
      return true;
    }
  }

  // Check if host contains manus domain (always secure)
  const host = req.get('host') || '';
  if (host.includes('manus') || host.includes('.computer')) {
    return true;
  }

  return false;
}

function isLocalRequest(req: Request) {
  const host = req.get('host') || '';
  const hostname = host.split(':')[0];
  return LOCAL_HOSTS.has(hostname);
}

export function getSessionCookieOptions(
  req: Request
): Pick<CookieOptions, "domain" | "httpOnly" | "path" | "sameSite" | "secure"> {
  const isSecure = isSecureRequest(req);
  const isLocal = isLocalRequest(req);
  
  // Log cookie configuration for debugging
  console.log('[Cookie] Configuration:', {
    host: req.get('host'),
    protocol: req.protocol,
    'x-forwarded-proto': req.get('x-forwarded-proto'),
    isSecure,
    isLocal,
  });
  
  // Use SameSite=Lax for OAuth redirects - this works for top-level navigation
  // SameSite=Lax allows cookies to be sent on top-level navigations (like OAuth redirects)
  // while still providing CSRF protection
  if (isSecure) {
    return {
      httpOnly: true,
      path: "/",
      sameSite: "lax", // Lax works better for OAuth top-level redirects
      secure: true,
    };
  }
  
  // For local development (localhost)
  return {
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secure: false,
  };
}
