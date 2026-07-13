// Vercel Serverless Function — generate ORS isochrones.
// Reads ORS_API_KEY from process.env (server-side only). Never expose to browser.

type Handler = (req: any, res: any) => Promise<any>;

const ALLOWED_PROFILES = new Set(['foot-walking', 'cycling-regular', 'driving-car']);
const MAX_TIME_SECONDS = 60 * 60 * 2; // 2h
const MAX_DISTANCE_METERS = 50_000;
const REQUEST_TIMEOUT_MS = 25_000;

export const config = { maxDuration: 30 };

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
    return res
      .status(500)
      .json({ success: false, error: 'Server is missing ORS_API_KEY environment variable' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    const { lat, lon, profile = 'foot-walking', ranges, range_type = 'time' } = body;

    if (typeof lat !== 'number' || typeof lon !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lon)) {
      return res.status(400).json({ success: false, error: 'Latitude and longitude must be finite numbers.' });
    }
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      return res.status(400).json({ success: false, error: 'Coordinates out of range' });
    }
    if (!ALLOWED_PROFILES.has(profile)) {
      return res.status(400).json({ success: false, error: `Unsupported travel mode: ${profile}` });
    }
    if (range_type !== 'time' && range_type !== 'distance') {
      return res.status(400).json({ success: false, error: 'range_type must be "time" or "distance"' });
    }

    if (!Array.isArray(ranges) || ranges.length === 0) {
      return res.status(400).json({ success: false, error: 'ranges must be a non-empty array of positive numbers.' });
    }
    const cleaned = ranges.filter((n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0);
    if (cleaned.length !== ranges.length) {
      return res.status(400).json({ success: false, error: 'All ranges must be finite positive numbers.' });
    }
    const unique = Array.from(new Set(cleaned)).sort((a, b) => a - b);
    const maxAllowed = range_type === 'time' ? MAX_TIME_SECONDS : MAX_DISTANCE_METERS;
    if (unique[unique.length - 1] > maxAllowed) {
      return res.status(400).json({
        success: false,
        error: range_type === 'time'
          ? `Maximum time range is ${MAX_TIME_SECONDS} seconds.`
          : `Maximum distance range is ${MAX_DISTANCE_METERS} metres.`,
      });
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let orsRes: Response;
    try {
      orsRes = await fetch(`https://api.openrouteservice.org/v2/isochrones/${profile}`, {
        method: 'POST',
        headers: { Authorization: ORS_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locations: [[lon, lat]],
          range: unique,
          range_type,
          attributes: ['area', 'reachfactor'],
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (!orsRes.ok) {
      const text = await orsRes.text().catch(() => '');
      const status = orsRes.status;
      let error = 'OpenRouteService request failed';
      if (status === 401 || status === 403) error = 'ORS API key rejected';
      else if (status === 429) error = 'ORS rate limit exceeded — please try again shortly';
      else if (status === 400) error = 'Invalid isochrone request';
      else if (status >= 500) error = 'Isochrone service is temporarily unavailable';
      console.error(`ORS isochrone error [${status}]: ${text}`);
      const outStatus = status === 429 ? 429 : status >= 500 ? 503 : 502;
      return res.status(outStatus).json({ success: false, error });
    }

    const data = await orsRes.json();
    if (!data || data.type !== 'FeatureCollection' || !Array.isArray(data.features)) {
      return res.status(502).json({ success: false, error: 'Isochrone service returned an unexpected response.' });
    }
    const validFeatures = data.features.filter((f: any) =>
      f?.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon') &&
      Number.isFinite(Number(f?.properties?.value))
    );
    if (validFeatures.length === 0) {
      return res.status(502).json({ success: false, error: 'Isochrone service returned no usable polygons.' });
    }
    return res.status(200).json({ success: true, data: { ...data, features: validFeatures } });
  } catch (err) {
    const e = err as Error & { name?: string };
    console.error('Isochrone handler crashed:', e);
    if (e?.name === 'AbortError') {
      return res.status(503).json({ success: false, error: 'Isochrone service timed out.' });
    }
    return res.status(500).json({ success: false, error: e?.message || 'Unexpected server error' });
  }
};

export default handler;