export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";

export const APP_TITLE = import.meta.env.VITE_APP_TITLE || "App";

export const APP_LOGO = "https://placehold.co/128x128/E1E7EF/1F2937?text=App";

// Generate login URL at runtime so redirect URI reflects the current origin.
// Optionally include rememberMe preference in the state parameter.
//
// Post-Manus migration: we target the Cognito Hosted UI
// (https://<prefix>.auth.<region>.amazoncognito.com/login).
export const getLoginUrl = (rememberMe: boolean = false) => {
  const cognitoDomain = import.meta.env.VITE_COGNITO_DOMAIN;
  const clientId = import.meta.env.VITE_COGNITO_CLIENT_ID;
  const redirectUri = `${window.location.origin}/api/oauth/callback`;

  // Encode state with remember_me preference — preserved from prior flow so
  // the server callback (oauth.ts::parseStateParam) can still extract it.
  const stateData = JSON.stringify({
    redirectUri,
    rememberMe,
  });
  const state = btoa(stateData);

  const url = new URL(`${cognitoDomain}/login`);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);

  return url.toString();
};
