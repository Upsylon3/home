// One editor, one serialized stream. Plaintext stays in memory until saved or
// explicitly discarded; this is not an offline cache or conflict resolver.
export function createNoteSaveQueue({ update, onSaved, onState, delay = 1500 }) {
  let pending = null, active = null, timer = null, disposed = false;
  function cancelTimer() { clearTimeout(timer); timer = null; }
  function edit(fields) {
    if (disposed) return;
    pending = { ...pending, ...fields };
    onState(active ? 'saving' : 'pending', '');
    cancelTimer();
    timer = setTimeout(() => { void flush(); }, delay);
  }
  function flush() {
    cancelTimer();
    if (disposed) return Promise.resolve(false);
    if (active) return active;
    if (!pending) return Promise.resolve(true);
    active = (async () => {
      while (pending && !disposed) {
        const fields = pending;
        pending = null;
        onState('saving', '');
        try {
          const note = await update(fields);
          if (!disposed) onSaved(note);
        } catch (err) {
          if (disposed) return false;
          // Newer edits win over the rejected snapshot, including tags.
          pending = { ...fields, ...pending };
          if (!disposed) onState('error', err.message);
          return false;
        }
      }
      if (!disposed) onState('saved', '');
      return !disposed;
    })().finally(() => { active = null; });
    return active;
  }
  return {
    edit, flush,
    resume() { disposed = false; },
    hasUnsaved: () => Boolean(pending || active),
    dispose() { disposed = true; pending = null; cancelTimer(); }
  };
}
