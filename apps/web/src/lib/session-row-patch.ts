// A session.updated frame carries the whole session row, so a rename or an
// archive can replace one row in a cached list instead of refetching every
// session. Merging over the cached row keeps fields the list endpoint adds
// and the overlay's `_pending*` fields. Null means the frame names no row in
// this list - a new session, or one outside its scope - and the caller must
// refetch instead.
export function patchSessionRow<T extends object>(
  rows: readonly T[],
  info: unknown,
): T[] | null {
  if (!info || typeof info !== "object") return null;
  const id = (info as { id?: unknown }).id;
  if (typeof id !== "string") return null;
  const index = rows.findIndex((row) => (row as { id?: unknown }).id === id);
  if (index === -1) return null;
  const next = rows.slice();
  next[index] = { ...rows[index], ...info };
  return next;
}
