// 1.1.4: the admin's users area, as pure functions (tested in tests/tools-admin-114.test.js). No server change: the
// data comes from the existing admin_list_users and admin_list_trips; "add to a trip" uses the existing share_trip,
// which the server allows only for an approved owner and only for an approved friend (supabase/migrations/0002).

/** The pending count is asked again no more than once in this time (and on opening "Admin", for free). */
export const BADGE_TTL_MS = 10 * 60_000;

const isObj = (v) => v !== null && typeof v === 'object';

/** Users waiting for approval. */
export const pendingOf = (users) => (Array.isArray(users) ? users.filter((u) => u?.status === 'pending' && u.role !== 'admin').length : 0);

/** Should the count be asked again? Never asked, another admin on this phone, or older than the limit. */
export function badgeDue(cache, userId, nowMs) {
  if (!isObj(cache) || cache.userId !== userId) return true;
  const at = Date.parse(cache.at);
  return !Number.isFinite(at) || nowMs - at >= BADGE_TTL_MS || nowMs < at;
}

/** The number to show: only this admin's own count; 0 means "show nothing". */
export const badgeCount = (cache, userId) => (isObj(cache) && cache.userId === userId && Number.isInteger(cache.n) && cache.n > 0 ? cache.n : 0);

/** Blocked users go to their own closed group; the rest keep the server's order. */
export function splitUsers(users) {
  const list = Array.isArray(users) ? users : [];
  return { active: list.filter((u) => u.status !== 'blocked'), blocked: list.filter((u) => u.status === 'blocked') };
}

/** Trips the admin may add this user to: an approved regular user, only trips the admin owns (from my_trips), and not
 *  a trip the user is already on (from admin_list_trips). Empty = the option is not shown. */
export function tripsToOffer(user, ownedTrips, adminTrips) {
  if (!user || user.role !== 'user' || user.status !== 'approved') return [];
  const on = new Set((Array.isArray(adminTrips) ? adminTrips : [])
    .filter((x) => (x.members ?? []).some((m) => m.user_id === user.id)).map((x) => x.id));
  return (Array.isArray(ownedTrips) ? ownedTrips : []).filter((x) => x.role === 'owner' && !on.has(x.id));
}
