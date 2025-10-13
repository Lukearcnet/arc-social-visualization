(function safeConsoleMute() {
  try {
    // Toggle logic — add ?mute=1 or localStorage.muteLogs="1" to activate
    const params = new URLSearchParams(location.search);
    const MUTED = params.get('mute') === '1' || localStorage.getItem('muteLogs') === '1';

    // Keep easy toggles in console
    window.__CONSOLE = {
      mute()   { localStorage.setItem('muteLogs', '1'); location.reload(); },
      unmute() { localStorage.removeItem('muteLogs'); location.reload(); },
      restore(){ Object.assign(console, _orig); console.info('[console-mute] restored'); },
    };

    if (!MUTED) {
      console.info('[console-mute] active logs (add ?mute=1 or run __CONSOLE.mute() to silence)');
      return;
    }

    // Save originals
    const _orig = {
      log: console.log,
      info: console.info,
      warn: console.warn,
      error: console.error,
      debug: console.debug,
    };

    // Replace with silent wrappers (still record internally if you need)
    const noop = () => {};
    console.log   = noop;
    console.info  = noop;
    console.warn  = noop;
    console.debug = noop;
    // Keep console.error visible (optional)
    console.error = function (...args) {
      _orig.error.apply(console, args);
    };

    _orig.info('[console-mute] All non-error logs hidden. Run __CONSOLE.restore() to restore.');
  } catch (err) {
    // fail-open, don't break anything
    console.warn('[console-mute] failed open:', err);
  }
})();
