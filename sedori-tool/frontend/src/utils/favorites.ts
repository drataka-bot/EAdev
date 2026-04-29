const KEY = "sedori_favorites_v1";

function readSet(): Set<string> {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? new Set(arr) : new Set();
  } catch {
    return new Set();
  }
}

function writeSet(s: Set<string>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify([...s]));
  } catch {
    // noop
  }
}

export function loadFavorites(): Set<string> {
  return readSet();
}

export function toggleFavorite(asin: string): Set<string> {
  const s = readSet();
  if (s.has(asin)) s.delete(asin);
  else s.add(asin);
  writeSet(s);
  return s;
}

export function isFavorite(asin: string | null): boolean {
  if (!asin) return false;
  return readSet().has(asin);
}

export function clearFavorites(): void {
  writeSet(new Set());
}
