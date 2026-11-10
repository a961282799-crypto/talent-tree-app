/** An in-memory key-value store with the backend interface storage.js expects. */
export function memoryStore(initial = {}, { failSet = false } = {}) {
  const map = new Map(Object.entries(initial))
  return {
    map,
    async get(key) { return map.has(key) ? map.get(key) : null },
    async set(key, value) {
      if (failSet) throw new Error('disk full')
      map.set(key, value)
    },
    async remove(key) { map.delete(key) },
  }
}

/** Fresh backends for storage.js: prefs and legacy share one store, as Capacitor Preferences does on a phone. */
export function phoneBackends({ prefs = {}, files = {}, secrets = {}, failSecrets = false, failFiles = false } = {}) {
  const p = memoryStore(prefs)
  return { prefs: p, legacy: p, files: memoryStore(files, { failSet: failFiles }), secrets: memoryStore(secrets, { failSet: failSecrets }) }
}
