// Runs before first paint (classic script in <head>) so the page never flashes the wrong theme.
// Key must match config.storageKeyPrefix + 'theme' (checked in tests).
(function () {
  var KEY = 'tisa:theme';
  var theme = null;
  try { theme = localStorage.getItem(KEY); } catch (e) { /* storage blocked: fall back to system */ }
  if (theme !== 'light' && theme !== 'dark') {
    theme = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  document.documentElement.setAttribute('data-theme', theme);
})();
