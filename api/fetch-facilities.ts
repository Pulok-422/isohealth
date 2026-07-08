// Vercel Serverless Function — fetch healthcare facilities from OSM Overpass.
// No API key required for Overpass; retries across mirrors for resilience.

type Handler = (req: any, res: any) => Promise<any>;

const OVERPASS_URLS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.openstreetmap.ru/api/interpreter',
];

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

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    const { lat, lon, radius = 10000 } = body;

    if (typeof lat !== 'number' || typeof lon !== 'number') {
      return res.status(400).json({ success: false, error: 'Invalid coordinates' });
    }

    const radiusMeters = Math.min(Math.max(Number(radius) || 10000, 500), 50000);

    const query = `
      [out:json][timeout:45];
      (
        node["amenity"="hospital"](around:${radiusMeters},${lat},${lon});
        node["amenity"="clinic"](around:${radiusMeters},${lat},${lon});
        node["amenity"="pharmacy"](around:${radiusMeters},${lat},${lon});
        node["amenity"="doctors"](around:${radiusMeters},${lat},${lon});
        node["healthcare"~"hospital|clinic|pharmacy|centre|doctor|health_post|community_health_worker"](around:${radiusMeters},${lat},${lon});
        way["amenity"="hospital"](around:${radiusMeters},${lat},${lon});
        way["amenity"="clinic"](around:${radiusMeters},${lat},${lon});
        way["healthcare"~"hospital|clinic|centre"](around:${radiusMeters},${lat},${lon});
      );
      out center body;
    `;

    let overpassResponse: Response | null = null;
    let lastError = '';

    for (const url of OVERPASS_URLS) {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const r = await fetch(url, {
            method: 'POST',
            body: `data=${encodeURIComponent(query)}`,
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            signal: AbortSignal.timeout(40_000),
          });
          if (r.ok) { overpassResponse = r; break; }
          lastError = `${url} -> ${r.status}`;
        } catch (e: any) {
          lastError = `${url}: ${e?.message || 'network error'}`;
        }
        if (attempt === 0) await new Promise((res) => setTimeout(res, 1500));
      }
      if (overpassResponse) break;
    }

    if (!overpassResponse) {
      console.error('Overpass unavailable:', lastError);
      return res.status(502).json({ success: false, error: 'Facility service temporarily unavailable' });
    }

    const raw = await overpassResponse.json();

    const facilities = (raw.elements || [])
      .map((el: any) => {
        const facilityLat = el.lat ?? el.center?.lat;
        const facilityLon = el.lon ?? el.center?.lon;
        const tags = el.tags || {};

        let type: 'hospital' | 'clinic' | 'pharmacy' | 'doctors' | 'healthcare' = 'healthcare';
        if (tags.amenity === 'hospital' || tags.healthcare === 'hospital') type = 'hospital';
        else if (tags.amenity === 'clinic' || tags.healthcare === 'clinic' || tags.healthcare === 'centre') type = 'clinic';
        else if (tags.amenity === 'pharmacy' || tags.healthcare === 'pharmacy') type = 'pharmacy';
        else if (tags.amenity === 'doctors' || tags.healthcare === 'doctor') type = 'doctors';

        return {
          id: el.id,
          name: tags.name || tags['name:en'] || `${type.charAt(0).toUpperCase() + type.slice(1)}`,
          type,
          lat: facilityLat,
          lon: facilityLon,
          tags,
        };
      })
      .filter((f: any) => typeof f.lat === 'number' && typeof f.lon === 'number');

    const seen = new Set<string>();
    const unique = facilities.filter((f: any) => {
      const key = `${f.lat.toFixed(4)},${f.lon.toFixed(4)},${f.type}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return res.status(200).json({ success: true, data: { facilities: unique } });
  } catch (err: any) {
    console.error('Facilities handler crashed:', err);
    return res.status(500).json({ success: false, error: err?.message || 'Unexpected server error' });
  }
};

export default handler;