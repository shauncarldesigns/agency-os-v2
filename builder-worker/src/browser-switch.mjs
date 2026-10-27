// Kept separate from Playwright so startup and safe shutdown can be tested
// without opening Chrome or making paid website builds.
export function createBrowserSwitch({ readEnabled, closeBrowser, isBusy }) {
  let enabled = false;
  let refreshing;
  const refresh = () => {
    if (refreshing) return refreshing;
    refreshing = (async () => {
      try { enabled = (await readEnabled()) === true; }
      catch { enabled = false; } // API/configuration failures never open Chrome.
      if (!enabled && !isBusy()) await closeBrowser();
      return enabled;
    })().finally(() => { refreshing = undefined; });
    return refreshing;
  };
  return { refresh, isEnabled: () => enabled };
}
