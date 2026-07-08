// Vercel Serverless Function — generate ORS isochrones.
// Reads ORS_API_KEY from process.env (server-side only). Never expose to browser.

type Handler = (req: any, res: any) => Promise<any>;

const ALLOWED_PROFILES = new Set(['foot-walking', 'cycling-regular', 'driving-car']);

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

    if (typeof lat !== 'number' || typeof lon !== 'number' || Number.isNaN(lat) || Number.isNaN(lon)) {
      return res.status(400).json({ success: false, error: 'Invalid coordinates' });
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

    const defaultRanges = range_type === 'distance' ? [1000, 2000, 3000, 5000] : [300, 600, 900, 1800];
    const finalRanges: number[] = Array.isArray(ranges) && ranges.length > 0
      ? ranges.filter((n: any) => typeof n === 'number' && n > 0)
      : defaultRanges;

    if (finalRanges.length === 0) {
      return res.status(400).json({ success: false, error: 'No valid ranges provided' });
    }

    const orsRes = await fetch(`https://api.openrouteservice.org/v2/isochrones/${profile}`, {
      method: 'POST',
      headers: { Authorization: ORS_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        locations: [[lon, lat]],
        range: finalRanges,
        range_type,
        attributes: ['area', 'reachfactor'],
      }),
    });

    if (!orsRes.ok) {
      const text = await orsRes.text().catch(() => '');
      const status = orsRes.status;
      let error = 'OpenRouteService request failed';
      if (status === 401 || status === 403) error = 'ORS API key rejected';
      else if (status === 429) error = 'ORS rate limit exceeded — please try again shortly';
      else if (status === 400) error = 'Invalid isochrone request';
      console.error(`ORS isochrone error [${status}]: ${text}`);
      return res.status(status === 429 ? 429 : 502).json({ success: false, error });
    }

    const data = await orsRes.json();
    return res.status(200).json({ success: true, data });
  } catch (err: any) {
    console.error('Isochrone handler crashed:', err);
    return res.status(500).json({ success: false, error: err?.message || 'Unexpected server error' });
  }
};

export default handler;