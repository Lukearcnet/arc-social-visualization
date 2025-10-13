(function safeConsoleMute() {
  try {
    // Simple production toggle - set to true for development, false for production
    const ENABLE_LOGGING = false; // Toggle this for dev/prod
    
    // Keep easy toggles in console for runtime control
    window.__CONSOLE = {
      enable()  { localStorage.setItem('enableLogs', '1'); location.reload(); },
      disable() { localStorage.removeItem('enableLogs'); location.reload(); },
      restore(){ Object.assign(console, _orig); console.info('[console-mute] restored'); },
    };

    // Check localStorage override
    const localStorageOverride = localStorage.getItem('enableLogs') === '1';
    const shouldLog = ENABLE_LOGGING || localStorageOverride;

    if (shouldLog) {
      console.info('[console-mute] Logging enabled (set ENABLE_LOGGING=true or run __CONSOLE.enable() to enable)');
      return;
    }

    // Save originals for restoration
    const _orig = {
      log: console.log,
      info: console.info,
      warn: console.warn,
      error: console.error,
      debug: console.debug,
    };

    // Replace with silent wrappers
    const noop = () => {};
    console.log   = noop;
    console.info  = noop;
    console.warn  = noop;
    console.debug = noop;
    // Keep console.error visible for critical issues
    console.error = function (...args) {
      _orig.error.apply(console, args);
    };

    _orig.info('[console-mute] All non-error logs disabled. Run __CONSOLE.enable() to enable.');
  } catch (err) {
    // fail-open, don't break anything
    console.warn('[console-mute] failed open:', err);
  }
})();
