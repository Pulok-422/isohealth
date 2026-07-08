// Vercel Serverless Function — ORS matrix (many-to-many travel times/distances).

type Handler = (req: any, res: any) => Promise<any>;

const ALLOWED_PROFILES = new Set(['foot-walking', 'cycling-regular', 'driving-car']);
const MAX_DESTINATIONS = 25;

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

    const locations = [
      ...origins.map((o: any) => [o.lon, o.lat]),
      ...destinations.map((d: any) => [d.lon, d.lat]),
    ];
    const sourceIndices = origins.map((_: any, i: number) => i);
    const destIndices = destinations.map((_: any, i: number) => i + origins.length);

    const orsRes = await fetch(`https://api.openrouteservice.org/v2/matrix/${profile}`, {
      method: 'POST',
      headers: { Authorization: ORS_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        locations,
        sources: sourceIndices,
        destinations: destIndices,
        metrics: ['duration', 'distance'],
      }),
    });

    if (!orsRes.ok) {
      const text = await orsRes.text().catch(() => '');
      const status = orsRes.status;
      let error = 'Matrix computation failed';
      if (status === 401 || status === 403) error = 'ORS API key rejected';
      else if (status === 429) error = 'ORS rate limit exceeded';
      console.error(`ORS matrix error [${status}]: ${text}`);
      return res.status(status === 429 ? 429 : 502).json({ success: false, error });
    }

    const data = await orsRes.json();
    return res.status(200).json({ success: true, data });
  } catch (err: any) {
    console.error('Matrix handler crashed:', err);
    return res.status(500).json({ success: false, error: err?.message || 'Unexpected server error' });
  }
};

export default handler;