// Vercel Serverless Function — ORS matrix (many-to-many travel times/distances).

type Handler = (req: any, res: any) => Promise<any>;

const ALLOWED_PROFILES = new Set(['foot-walking', 'cycling-regular', 'driving-car']);
const MAX_DESTINATIONS = 25;
const REQUEST_TIMEOUT_MS = 25_000;

export const config = { maxDuration: 30 };

function isValidCoord(c: unknown): c is { lat: number; lon: number } {
  if (!c || typeof c !== 'object') return false;
  const { lat, lon } = c as { lat?: unknown; lon?: unknown };
  return (
    typeof lat === 'number' && Number.isFinite(lat) && lat >= -90 && lat <= 90 &&
    typeof lon === 'number' && Number.isFinite(lon) && lon >= -180 && lon <= 180
  );
}

function isValidValueOrNull(v: unknown): boolean {
  return v === null || (typeof v === 'number' && Number.isFinite(v) && v >= 0);
}

const handler: Handler = async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const ORS_API_KEY = process.env.ORS_API_KEY;
  if (!ORS_API_KEY) {
    return res.status(500).json({ success: false, error: 'Server is missing ORS_API_KEY environment variable' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    const { origins, destinations, profile = 'driving-car' } = body;

    if (!Array.isArray(origins) || !Array.isArray(destinations)) {
      return res.status(400).json({ success: false, error: 'origins and destinations must be arrays' });
    }
    if (origins.length === 0 || destinations.length === 0) {
      return res.status(400).json({ success: false, error: 'origins and destinations must not be empty' });
    }
    if (destinations.length > MAX_DESTINATIONS) {
      return res.status(400).json({ success: false, error: `Too many destinations (${destinations.length}). Limit is ${MAX_DESTINATIONS}.` });
    }
    if (!ALLOWED_PROFILES.has(profile)) {
      return res.status(400).json({ success: false, error: 'Unsupported travel mode' });
    }
    if (!origins.every(isValidCoord) || !destinations.every(isValidCoord)) {
      return res.status(400).json({ success: false, error: 'All origins and destinations must have finite lat/lon in valid ranges.' });
    }

    const locations = [
      ...origins.map((o) => [o.lon, o.lat]),
      ...destinations.map((d) => [d.lon, d.lat]),
    ];
    const sourceIndices = origins.map((_, i) => i);
    const destIndices = destinations.map((_, i) => i + origins.length);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let orsRes: Response;
    try {
      orsRes = await fetch(`https://api.openrouteservice.org/v2/matrix/${profile}`, {
        method: 'POST',
        headers: { Authorization: ORS_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locations,
          sources: sourceIndices,
          destinations: destIndices,
          metrics: ['duration', 'distance'],
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (!orsRes.ok) {
      const text = await orsRes.text().catch(() => '');
      const status = orsRes.status;
      let error = 'Matrix computation failed';
      if (status === 401 || status === 403) error = 'ORS API key rejected';
      else if (status === 429) error = 'ORS rate limit exceeded';
      else if (status >= 500) error = 'The routing service is temporarily unavailable';
      console.error(`ORS matrix error [${status}]: ${text}`);
      const outStatus = status === 429 ? 429 : status >= 500 ? 503 : 502;
      return res.status(outStatus).json({ success: false, error });
    }

    const data = await orsRes.json();

    const durations = Array.isArray(data?.durations) ? data.durations : null;
    const distances = Array.isArray(data?.distances) ? data.distances : null;
    if (
      !durations || !distances ||
      durations.length !== origins.length || distances.length !== origins.length ||
      !durations.every((row: unknown) => Array.isArray(row) && row.length === destinations.length && row.every(isValidValueOrNull)) ||
      !distances.every((row: unknown) => Array.isArray(row) && row.length === destinations.length && row.every(isValidValueOrNull))
    ) {
      return res.status(502).json({ success: false, error: 'Routing service returned an unexpected matrix response.' });
    }

    return res.status(200).json({ success: true, data: { durations, distances } });
  } catch (err) {
    const e = err as Error & { name?: string };
    console.error('Matrix handler crashed:', e);
    if (e?.name === 'AbortError') {
      return res.status(503).json({ success: false, error: 'Routing service timed out.' });
    }
    return res.status(500).json({ success: false, error: e?.message || 'Unexpected server error' });
  }
};

export default handler;