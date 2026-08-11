const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:8788';

let reauthenticationStarted = false;

/**
 * Move the top-level browser through the API's Access application, then back
 * to the dashboard. A top-level navigation is required because an expired
 * cross-origin Access request cannot complete its login redirect via fetch.
 */
export function reauthenticateWithAccess(): void {
  if (reauthenticationStarted) return;
  reauthenticationStarted = true;

  const returnUrl = window.location.href;
  const loginUrl = new URL('/cdn-cgi/access/login', API_BASE);
  loginUrl.searchParams.set('redirect_url', returnUrl);
  window.location.assign(loginUrl.toString());
}

/**
 * Clear the application Access cookie without replacing the SPA with
 * Cloudflare's logout result page. The caller can then show a useful signed-
 * out screen with a direct way back into Agency OS.
 */
export async function endAccessSession(): Promise<void> {
  await fetch('/cdn-cgi/access/logout', {
    credentials: 'include',
    cache: 'no-store',
  });
}

export function signBackIn(): void {
  window.location.replace(window.location.origin);
}
