// Vercel Serverless Function: fetch healthcare facilities from OSM Overpass.
// No API key required. The query is intentionally broad because OSM healthcare
// tagging varies by country and mapper.

type Handler = (req: any, res: any) => Promise<any>;

const OVERPASS_URLS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.openstreetmap.ru/api/interpreter',
];

const MIN_RADIUS = 500;
const MAX_RADIUS = 50000;

function clampRadius(radius: unknown, fallback = 10000) {
  const parsed = Number(radius);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, MIN_RADIUS), MAX_RADIUS);
}

function buildQuery(lat: number, lon: number, radiusMeters: number) {
  return `
[out:json][timeout:45];
(
  node["amenity"~"hospital|clinic|pharmacy|doctors"](around:${radiusMeters},${lat},${lon});
  way["amenity"~"hospital|clinic|pharmacy|doctors"](around:${radiusMeters},${lat},${lon});
  relation["amenity"~"hospital|clinic|pharmacy|doctors"](around:${radiusMeters},${lat},${lon});

  node["healthcare"~"hospital|clinic|pharmacy|doctor|doctors|centre|health_post|community_health_worker"](around:${radiusMeters},${lat},${lon});
  way["healthcare"~"hospital|clinic|pharmacy|doctor|doctors|centre|health_post|community_health_worker"](around:${radiusMeters},${lat},${lon});
  relation["healthcare"~"hospital|clinic|pharmacy|doctor|doctors|centre|health_post|community_health_worker"](around:${radiusMeters},${lat},${lon});
);
out center tags;
`;
}

function normaliseFacility(el: any) {
  const facilityLat = el.lat ?? el.center?.lat;
  const facilityLon = el.lon ?? el.center?.lon;
  const tags = el.tags || {};

  if (typeof facilityLat !== 'number' || typeof facilityLon !== 'number') return null;

  let type: 'hospital' | 'clinic' | 'pharmacy' | 'doctors' | 'healthcare' = 'healthcare';
  const amenity = String(tags.amenity || '').toLowerCase();
  const healthcare = String(tags.healthcare || '').toLowerCase();

  if (amenity === 'hospital' || healthcare === 'hospital') type = 'hospital';
  else if (amenity === 'clinic' || healthcare === 'clinic' || healthcare === 'centre') type = 'clinic';
  else if (amenity === 'pharmacy' || healthcare === 'pharmacy') type = 'pharmacy';
  else if (amenity === 'doctors' || healthcare === 'doctor' || healthcare === 'doctors') type = 'doctors';

  return {
    id: `${el.type || 'osm'}-${el.id}`,
    osmType: el.type,
    osmId: el.id,
    name: tags.name || tags['name:en'] || tags.brand || `${type.charAt(0).toUpperCase() + type.slice(1)}`,
    type,
    lat: facilityLat,
    lon: facilityLon,
    tags,
  };
}

async function queryOverpass(query: string) {
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

        if (r.ok) return r.json();
        lastError = `${url} -> ${r.status}`;
      } catch (e: any) {
        lastError = `${url}: ${e?.message || 'network error'}`;
      }

      if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 1200));
    }
  }

  throw new Error(lastError || 'Overpass request failed');
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

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    const { lat, lon } = body;

    if (typeof lat !== 'number' || typeof lon !== 'number') {
      return res.status(400).json({ success: false, error: 'Invalid coordinates' });
    }

    const requestedRadius = clampRadius(body.radius, 10000);
    const radii = Array.from(new Set([requestedRadius, 15000, 25000, 50000].map((r) => clampRadius(r))));

    let lastError = '';

    for (const radiusMeters of radii) {
      try {
        const raw = await queryOverpass(buildQuery(lat, lon, radiusMeters));

        const facilities = (raw.elements || [])
          .map(normaliseFacility)
          .filter(Boolean);

        const seen = new Set<string>();
        const unique = facilities.filter((f: any) => {
          const key = f.osmId
            ? `${f.osmType}-${f.osmId}`
            : `${f.lat.toFixed(5)},${f.lon.toFixed(5)},${f.type},${f.name}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });

        console.log('Overpass facilities found:', unique.length, 'radius:', radiusMeters);

        if (unique.length > 0 || radiusMeters === radii[radii.length - 1]) {
          return res.status(200).json({
            success: true,
            data: {
              facilities: unique,
              radiusUsed: radiusMeters,
              source: 'OpenStreetMap Overpass',
            },
          });
        }
      } catch (e: any) {
        lastError = e?.message || 'Overpass request failed';
        console.error('Overpass radius failed:', radiusMeters, lastError);
      }
    }

    return res.status(502).json({
      success: false,
      error: `Facility service temporarily unavailable${lastError ? `: ${lastError}` : ''}`,
    });
  } catch (err: any) {
    console.error('Facilities handler crashed:', err);
    return res.status(500).json({ success: false, error: err?.message || 'Unexpected server error' });
  }
};

export default handler;
