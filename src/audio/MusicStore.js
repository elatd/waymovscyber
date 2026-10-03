// Remembers the player's own songs between visits (IndexedDB, this browser only).
// Every call is best-effort: blocked or cleared storage just means nothing is restored.
const DB = 'wvc-music';
const STORE = 'tracks';

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { autoIncrement: true });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function done(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
}

export async function saveTracks(files) {
  try {
    const db = await open();
    const tx = db.transaction(STORE, 'readwrite');
    const st = tx.objectStore(STORE);
    st.clear();
    for (const f of files) st.add({ name: f.name, type: f.type, blob: f });
    await done(tx);
    db.close();
  } catch (e) {
    /* storage unavailable: songs just won't be remembered */
  }
}

export async function loadTracks() {
  try {
    const db = await open();
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    const rows = await new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return rows.filter((r) => r && r.blob).map((r) => new File([r.blob], r.name || 'Track', { type: r.type || r.blob.type }));
  } catch (e) {
    return [];
  }
}

export async function clearTracks() {
  try {
    const db = await open();
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).clear();
    await done(tx);
    db.close();
  } catch (e) {
    /* ignore */
  }
}
