// Local-only persistence for the trip (localStorage in the browser). No server, no cookies.
// Storage is injected so Node tests can use an in-memory fake.
import { validateDates } from './trip.js';

const VERSION = 1;

function clean(trip) {
  const out = {};
  if (trip?.dates && validateDates(trip.dates).length === 0) {
    out.dates = { start: trip.dates.start, end: trip.dates.end };
  }
  const b = trip?.budget;
  if (b && Number.isFinite(b.amount) && b.amount > 0 && /^[A-Z]{3}$/.test(b.currency)) {
    out.budget = { amount: b.amount, currency: b.currency };
  }
  return out;
}

export function createStore(storage, prefix) {
  const key = `${prefix}trip`;
  return {
    load() {
      try {
        const raw = storage?.getItem(key);
        if (!raw) return {};
        const data = JSON.parse(raw);
        return data?.v === VERSION ? clean(data.trip) : {};
      } catch {
        return {}; // corrupt or blocked storage: start empty rather than crash
      }
    },
    save(trip) {
      try {
        if (!storage) return false;
        storage.setItem(key, JSON.stringify({ v: VERSION, trip: clean(trip) }));
        return true;
      } catch {
        return false; // e.g. private mode or quota: the app keeps working for this session
      }
    },
  };
}
