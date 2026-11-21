// Pre-stage-10 PR A: what the data on this device holds, for the settings screen. On iPhone, Safari and the
// app opened from the home screen keep separate data; this line lets the user compare the two sides and move
// data with a backup file. Nothing is merged or copied automatically. Pure; tests/ready-checklist.test.js.
const count = (v) => (Array.isArray(v) ? v.length : 0);

export function dataSummary(state) {
  const trip = state?.trips?.[state?.activeTripId] ?? {};
  return {
    createdAt: state?.createdAt ?? null,
    items: count(trip.checklist),
    stops: count(trip.destinations),
    expenses: count(trip.expenses),
    photos: count(trip.photos),
  };
}
