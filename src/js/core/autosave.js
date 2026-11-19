// Debounced save: many quick changes become one write after a short pause.
export function createAutosave(save, { delay = 400, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  let timer = null;
  let pending;
  let has = false;
  const run = () => {
    timer = null;
    if (!has) return;
    has = false;
    save(pending);
  };
  return {
    schedule(state) {
      pending = state;
      has = true;
      if (timer !== null) clearTimer(timer);
      timer = setTimer(run, delay);
    },
    /** Save now (e.g. when the page is hidden). */
    flush() {
      if (timer !== null) clearTimer(timer);
      run();
    },
  };
}
