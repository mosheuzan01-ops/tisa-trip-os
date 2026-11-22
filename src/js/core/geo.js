// Stage 10: "my current location", one reading per tap. No tracking: never a continuous watch, nothing in the
// background, nothing sent anywhere. The reading stays on the phone until the user saves or shares it.
// Tested in tests/stage10-places.test.js (P-13 to P-16).
export const GEO_OPTIONS = { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 };

/** Degrees as text with 6 decimals (about 10 cm), the form the place fields keep. */
export const formatCoord = (n) => Number(n).toFixed(6);

const ERRORS = { 1: 'denied', 2: 'unavailable', 3: 'timeout' };

/**
 * One position reading. Never rejects.
 * @returns {Promise<{ok: true, lat: string, lng: string, accuracy: number} | {ok: false, error: 'unsupported'|'denied'|'unavailable'|'timeout'}>}
 */
export function locate(geo = globalThis.navigator?.geolocation, options = GEO_OPTIONS) {
  if (!geo || typeof geo.getCurrentPosition !== 'function') return Promise.resolve({ ok: false, error: 'unsupported' });
  return new Promise((resolve) => {
    try {
      geo.getCurrentPosition(
        (pos) => resolve({ ok: true, lat: formatCoord(pos.coords.latitude), lng: formatCoord(pos.coords.longitude), accuracy: Math.round(pos.coords.accuracy) }),
        (err) => resolve({ ok: false, error: ERRORS[err?.code] ?? 'unavailable' }),
        options,
      );
    } catch {
      resolve({ ok: false, error: 'unavailable' });
    }
  });
}

/** 'granted' | 'denied' | 'prompt' | 'unknown'. Only reads the state; it never asks for permission. */
export async function geoPermission(nav = globalThis.navigator) {
  try {
    if (!nav?.permissions?.query) return 'unknown';
    const { state } = await nav.permissions.query({ name: 'geolocation' });
    return ['granted', 'denied', 'prompt'].includes(state) ? state : 'unknown';
  } catch {
    return 'unknown';
  }
}
