// Runs before first paint (classic script in <head>) so the page never flashes the wrong theme.
// Reads settings.theme from the data key (config.storageKeyPrefix + 'v1'); falls back to the Stage 1 key 'tisa:theme'.
(function () {
  var theme = null;
  try {
    var data = JSON.parse(localStorage.getItem('tisa:v1') || 'null');
    theme = data && data.settings ? data.settings.theme : null;
    if (!theme && !data) theme = localStorage.getItem('tisa:theme');
  } catch (e) { /* storage blocked or unreadable: fall back to the device setting */ }
  if (theme !== 'light' && theme !== 'dark') {
    theme = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  document.documentElement.setAttribute('data-theme', theme);
})();
