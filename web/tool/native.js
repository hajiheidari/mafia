// Bridge to the app's own iOS plugin (mobile/ios/App/App/EspadnaNative.swift):
// Game Center and iCloud key-value storage. Everything here is a no-op that
// rejects on the web and on Android, so callers just catch and move on.

const cap = () => window.Capacitor;

/** True inside the iOS app (Capacitor's native bridge is present). */
export function isIOSApp() {
  const c = cap();
  if (!c || typeof c.nativePromise !== 'function') return false;
  if (typeof c.getPlatform === 'function') return c.getPlatform() === 'ios';
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

/** True inside the Android app. */
export function isAndroidApp() {
  const c = cap();
  return !!c && typeof c.getPlatform === 'function' && c.getPlatform() === 'android';
}

function call(method, options = {}) {
  if (!isIOSApp()) return Promise.reject(new Error('only in the iOS app'));
  return cap().nativePromise('EspadnaNative', method, options);
}

export const gameCenter = {
  /** { authenticated, name } */
  signIn: () => call('gcAuthenticate'),
  submitPeriodCount: (leaderboardId, timestamps) => call('gcSubmitPeriodCount', { leaderboardId, timestamps }),
  report: (achievements) => call('gcReportAchievements', { achievements }),
  show: (view = 'leaderboards') => call('gcShowDashboard', { view }),
};

export const icloud = {
  get: (key) => call('kvGet', { key }).then((r) => r?.value ?? null),
  set: (key, value) => call('kvSet', { key, value }),
};
