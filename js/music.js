/* ============================================================
   Friendster Clone — music blob store (IndexedDB)
   Audio files are too large for localStorage, so the raw audio
   blobs live here, keyed by song id. Track metadata (title,
   artist) stays in the localStorage DB on the user record.
   ============================================================ */

const MusicStore = (() => {
  const DB_NAME = "friendster_music";
  const STORE = "tracks";
  let _dbp = null;

  function open() {
    if (_dbp) return _dbp;
    _dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return _dbp;
  }

  async function tx(mode) {
    const db = await open();
    return db.transaction(STORE, mode).objectStore(STORE);
  }

  return {
    async put(id, blob) {
      const store = await tx("readwrite");
      return new Promise((resolve, reject) => {
        const r = store.put(blob, id);
        r.onsuccess = () => resolve();
        r.onerror = () => reject(r.error);
      });
    },
    async get(id) {
      const store = await tx("readonly");
      return new Promise((resolve, reject) => {
        const r = store.get(id);
        r.onsuccess = () => resolve(r.result || null);
        r.onerror = () => reject(r.error);
      });
    },
    async remove(id) {
      const store = await tx("readwrite");
      return new Promise((resolve, reject) => {
        const r = store.delete(id);
        r.onsuccess = () => resolve();
        r.onerror = () => reject(r.error);
      });
    },
    /** Return an object URL for playback, or null if missing. */
    async url(id) {
      const blob = await this.get(id);
      return blob ? URL.createObjectURL(blob) : null;
    },
  };
})();
