// Vercel Serverless Function — ORS directions between two coordinates.

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
    return res.status(500).json({ success: false, error: 'Server is missing ORS_API_KEY environment variable' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    const { start, end, profile = 'driving-car' } = body;

    if (!start || !end || typeof start.lat !== 'number' || typeof start.lon !== 'number' || typeof end.lat !== 'number' || typeof end.lon !== 'number') {
      return res.status(400).json({ success: false, error: 'Invalid start or end coordinates' });
    }
    if (!ALLOWED_PROFILES.has(profile)) {
      return res.status(400).json({ success: false, error: 'Unsupported travel mode' });
    }

    const orsRes = await fetch(`https://api.openrouteservice.org/v2/directions/${profile}/geojson`, {
      method: 'POST',
      headers: { Authorization: ORS_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ coordinates: [[start.lon, start.lat], [end.lon, end.lat]] }),
    });

    if (!orsRes.ok) {
      const text = await orsRes.text().catch(() => '');
      const status = orsRes.status;
      let error = 'Route calculation failed';
      if (status === 401 || status === 403) error = 'ORS API key rejected';
      else if (status === 429) error = 'ORS rate limit exceeded';
      console.error(`ORS route error [${status}]: ${text}`);
      return res.status(status === 429 ? 429 : 502).json({ success: false, error });
    }

    const data = await orsRes.json();
    return res.status(200).json({ success: true, data });
  } catch (err: any) {
    console.error('Route handler crashed:', err);
    return res.status(500).json({ success: false, error: err?.message || 'Unexpected server error' });
  }
};

export default handler;