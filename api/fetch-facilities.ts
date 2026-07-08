// Vercel Serverless Function: fetch healthcare facilities from OSM Overpass.
// This version is optimized for Vercel and Dhaka-like dense urban areas.

type Handler = (req: any, res: any) => Promise<any>;

export const config = {
  maxDuration: 30,
};

const OVERPASS_URLS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

const MIN_RADIUS = 1000;
const MAX_RADIUS = 30000;

function clampRadius(radius: unknown, fallback = 12000) {
  const parsed = Number(radius);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, MIN_RADIUS), MAX_RADIUS);
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;

  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function buildHealthcareQuery(lat: number, lon: number, radiusMeters: number) {
  return `
[out:json][timeout:20];
(
  nwr["amenity"~"^(hospital|clinic|pharmacy|doctors)$"](around:${radiusMeters},${lat},${lon});
  nwr["healthcare"~"^(hospital|clinic|pharmacy|doctor|doctors|centre|health_post|community_health_worker)$"](around:${radiusMeters},${lat},${lon});
  nwr["healthcare"](around:${radiusMeters},${lat},${lon});
);
out center tags;
`;
}

function buildNameFallbackQuery(lat: number, lon: number, radiusMeters: number) {
  return `
[out:json][timeout:20];
(
  nwr["name"~"hospital|clinic|pharmacy|medical|health|diagnostic|doctor|hospital|clinic|pharmacy",i](around:${radiusMeters},${lat},${lon});
  nwr["name:en"~"hospital|clinic|pharmacy|medical|health|diagnostic|doctor",i](around:${radiusMeters},${lat},${lon});
);
out center tags;
`;
}

function normaliseFacility(el: any, originLat: number, originLon: number) {
  const facilityLat = el.lat ?? el.center?.lat;
  const facilityLon = el.lon ?? el.center?.lon;
  const tags = el.tags || {};

  if (typeof facilityLat !== 'number' || typeof facilityLon !== 'number') return null;

  const amenity = String(tags.amenity || '').toLowerCase();
  const healthcare = String(tags.healthcare || '').toLowerCase();
  const name = String(tags.name || tags['name:en'] || tags.brand || '').trim();

  let type: 'hospital' | 'clinic' | 'pharmacy' | 'doctors' | 'healthcare' = 'healthcare';

  if (amenity === 'hospital' || healthcare === 'hospital' || /hospital/i.test(name)) {
    type = 'hospital';
  } else if (
    amenity === 'clinic' ||
    healthcare === 'clinic' ||
    healthcare === 'centre' ||
    /clinic|diagnostic|medical centre|health centre/i.test(name)
  ) {
    type = 'clinic';
  } else if (amenity === 'pharmacy' || healthcare === 'pharmacy' || /pharmacy|drug/i.test(name)) {
    type = 'pharmacy';
  } else if (
    amenity === 'doctors' ||
    healthcare === 'doctor' ||
    healthcare === 'doctors' ||
    /doctor|physician/i.test(name)
  ) {
    type = 'doctors';
  }

  const displayName =
    name ||
    tags.operator ||
    tags.brand ||
    `${type.charAt(0).toUpperCase() + type.slice(1)}`;

  return {
    id: `${el.type || 'osm'}-${el.id}`,
    osmType: el.type,
    osmId: el.id,
    name: displayName,
    type,
    lat: facilityLat,
    lon: facilityLon,
    distanceKm: haversineKm(originLat, originLon, facilityLat, facilityLon),
    tags,
  };
}

async function fetchWithTimeout(url: string, query: string, timeoutMs = 9000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'POST',
      body: query,
      headers: {
        'Content-Type': 'text/plain;charset=UTF-8',
      },
      signal: controller.signal,
    });

    const text = await response.text();

    if (!response.ok) {
      throw new Error(`Overpass returned ${response.status}: ${text.slice(0, 160)}`);
    }

    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
  }
}

async function queryOverpass(query: string) {
  let lastError = '';

  for (const url of OVERPASS_URLS) {
    try {
      return await fetchWithTimeout(url, query);
    } catch (error: any) {
      lastError = error?.message || 'Overpass request failed';
      console.error('Overpass endpoint failed:', url, lastError);
    }
  }

  throw new Error(lastError || 'All Overpass endpoints failed');
}

async function runFacilitySearch(lat: number, lon: number, radiusMeters: number) {
  const raw = await queryOverpass(buildHealthcareQuery(lat, lon, radiusMeters));

  let facilities = (raw.elements || [])
    .map((el: any) => normaliseFacility(el, lat, lon))
    .filter(Boolean);

  // Fallback for poorly tagged OSM data.
  if (facilities.length === 0) {
    const fallbackRaw = await queryOverpass(buildNameFallbackQuery(lat, lon, radiusMeters));
    facilities = (fallbackRaw.elements || [])
      .map((el: any) => normaliseFacility(el, lat, lon))
      .filter(Boolean);
  }

  const seen = new Set<string>();

  const unique = facilities.filter((f: any) => {
    const key = f.osmId
      ? `${f.osmType}-${f.osmId}`
      : `${Number(f.lat).toFixed(5)},${Number(f.lon).toFixed(5)},${f.type},${f.name}`;

    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  unique.sort((a: any, b: any) => a.distanceKm - b.distanceKm);

  return unique.slice(0, 500);
}

const handler: Handler = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({
      success: false,
      error: 'Method not allowed',
    });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};

    const lat = Number(body.lat);
    const lon = Number(body.lon);

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid coordinates',
      });
    }

    const requestedRadius = clampRadius(body.radius, 12000);
    const radii = Array.from(
      new Set([requestedRadius, 15000, 25000, 30000].map((r) => clampRadius(r)))
    );

    let lastError = '';

    for (const radiusMeters of radii) {
      try {
        const facilities = await runFacilitySearch(lat, lon, radiusMeters);

        console.log('Overpass facilities found:', facilities.length, 'radius:', radiusMeters);

        if (facilities.length > 0 || radiusMeters === radii[radii.length - 1]) {
          return res.status(200).json({
            success: true,
            data: {
              facilities,
              radiusUsed: radiusMeters,
              source: 'OpenStreetMap Overpass',
              debug: {
                lat,
                lon,
                radiusMeters,
                count: facilities.length,
              },
            },
          });
        }
      } catch (error: any) {
        lastError = error?.message || 'Overpass request failed';
        console.error('Facility search failed at radius:', radiusMeters, lastError);
      }
    }

    return res.status(200).json({
      success: true,
      data: {
        facilities: [],
        radiusUsed: radii[radii.length - 1],
        source: 'OpenStreetMap Overpass',
        warning: lastError || 'No mapped health facilities found nearby',
      },
    });
  } catch (error: any) {
    console.error('Facilities handler crashed:', error);

    return res.status(500).json({
      success: false,
      error: error?.message || 'Unexpected facility server error',
    });
  }
};

export default handler;
