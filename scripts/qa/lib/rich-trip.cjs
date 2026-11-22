// Stage 13: the sample trip (lib/sample-trip.cjs) with one of everything: an expense, two people, a place, a day
// note, a check-in, a bag with an item, a transfer, a photo's details, an info note and a smart-suitcase activity.
// Sample data only (rule 16). Built with the app's own core functions. The photo file itself goes to IndexedDB
// in the browser (putSamplePhoto), with the same id.
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { sampleState } = require('./sample-trip.cjs');

const ROOT = path.join(__dirname, '..', '..', '..');
const mod = (p) => import(pathToFileURL(path.join(ROOT, p)).href);
const PHOTO_ID = 'rich-photo-1';

async function richState() {
  const st = await sampleState();
  const trip = st.trips[st.activeTripId];
  const [money, places, jr, ci, lg, tr, info, { TH }] = await Promise.all(['src/js/core/money.js', 'src/js/core/places.js', 'src/js/core/journal.js',
    'src/js/core/checkins.js', 'src/js/core/luggage.js', 'src/js/core/transfers.js', 'src/js/core/info.js', 'data/packs/th.js'].map(mod));
  let n = 0;
  const makeId = () => `rich-${++n}`;
  const at = '2030-11-01T10:00:00.000Z';
  const stop = trip.destinations[0];
  const rates = money.effectiveRates(trip.rates, TH.planningRates);
  trip.people = [{ id: 'rich-p1', name: 'חבר א' }, { id: 'rich-p2', name: 'חבר ב' }];
  const cat = Object.keys(trip.budget.categoriesMinor)[0];
  trip.expenses = [money.makeExpense({ amount: '50', currency: 'ILS', category: cat, date: stop.startDate, destinationId: stop.id, description: 'הוצאת דוגמה', method: 'card', status: 'paid', note: '' }, rates, makeId)];
  trip.places = [places.makePlace({ name: 'מקום דוגמה', category: 'food', status: 'want', coords: '13.75, 100.5', stopId: stop.id, photoIds: [PHOTO_ID] }, makeId, at)];
  trip.journal = jr.setNote(trip.journal, stop.startDate, 'הערת דוגמה', at);
  trip.checkins = [ci.makeCheckin({ kind: 'hotel', title: 'מלון דוגמה', stopId: stop.id, date: stop.startDate, time: '14:00', zone: 'Asia/Bangkok', booking: '', link: '', note: '' }, makeId)];
  const bag = lg.makeBag({ name: 'תיק דוגמה', limit: '23' }, makeId);
  trip.luggage = lg.saveItem(lg.saveBag(trip.luggage, bag), lg.makeLuggageItem({ name: 'פריט דוגמה', weight: '1' }, makeId), bag.id);
  trip.transfers = [tr.makeTransfer({ kind: 'bus', from: 'א', to: 'ב', date: stop.endDate, time: '09:00', company: '', booking: '', price: '', currency: 'THB', link: '', status: 'planned', note: '' }, makeId)];
  trip.photos = [{ id: PHOTO_ID, date: stop.startDate, dateSource: 'manual', stopId: null, caption: 'דוגמה', featured: true, width: 40, height: 30, bytes: 100, addedAt: at }];
  trip.info = info.setNote(trip.info, 'insurance', 'הערת ביטוח לדוגמה');
  trip.smartBag = { activities: ['snorkel'] };
  return st;
}

/** Put the sample photo's file in IndexedDB, through the app's own photo store (run in the page). */
async function putSamplePhoto(page) {
  await page.evaluate(async (id) => {
    const { putPhoto } = await import('/src/js/photo-store.js');
    const c = new OffscreenCanvas(40, 30);
    c.getContext('2d').fillRect(0, 0, 40, 30);
    const buf = await (await c.convertToBlob({ type: 'image/jpeg' })).arrayBuffer();
    await putPhoto({ id, type: 'image/jpeg', full: buf, thumb: buf.slice(0) });
  }, PHOTO_ID);
}

module.exports = { richState, putSamplePhoto, PHOTO_ID };
