type Handler = (req: any, res: any) => Promise<any>;

export const config = {
  maxDuration: 10,
};

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

type FacilityType = 'hospital' | 'clinic' | 'pharmacy' | 'doctors' | 'healthcare';

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

function clampRadius(radius: unknown) {
  const parsed = Number(radius);
  if (!Number.isFinite(parsed)) return 7000;

  // Keep it smaller to avoid Vercel 504.
  return Math.min(Math.max(parsed, 1000), 8000);
}

function bboxFromRadius(lat: number, lon: number, radiusMeters: number) {
  const radiusKm = radiusMeters / 1000;
  const latDelta = radiusKm / 111;
  const lonDelta = radiusKm / (111 * Math.cos((lat * Math.PI) / 180));

  return {
    south: lat - latDelta,
    west: lon - lonDelta,
    north: lat + latDelta,
    east: lon + lonDelta,
  };
}

function buildFastQuery(lat: number, lon: number, radiusMeters: number) {
  const b = bboxFromRadius(lat, lon, radiusMeters);

  // BBOX query is much faster than large around queries.
  // Limit output to prevent Vercel timeout.
  return `
[out:json][timeout:6];
(
  node["amenity"~"^(hospital|clinic|pharmacy|doctors)$"](${b.south},${b.west},${b.north},${b.east});
  node["healthcare"~"^(hospital|clinic|pharmacy|doctor|doctors|centre|health_post|community_health_worker)$"](${b.south},${b.west},${b.north},${b.east});

  way["amenity"~"^(hospital|clinic|pharmacy|doctors)$"](${b.south},${b.west},${b.north},${b.east});
  way["healthcare"~"^(hospital|clinic|pharmacy|doctor|doctors|centre|health_post|community_health_worker)$"](${b.south},${b.west},${b.north},${b.east});
);
out center tags 250;
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

  let type: FacilityType = 'healthcare';

  if (amenity === 'hospital' || healthcare === 'hospital') {
    type = 'hospital';
  } else if (amenity === 'clinic' || healthcare === 'clinic' || healthcare === 'centre') {
    type = 'clinic';
  } else if (amenity === 'pharmacy' || healthcare === 'pharmacy') {
    type = 'pharmacy';
  } else if (
    amenity === 'doctors' ||
    healthcare === 'doctor' ||
    healthcare === 'doctors'
  ) {
    type = 'doctors';
  }

  const distanceKm = haversineKm(originLat, originLon, facilityLat, facilityLon);

  return {
    id: `${el.type || 'osm'}-${el.id}`,
    osmType: el.type,
    osmId: el.id,
    name:
      name ||
      tags.operator ||
      tags.brand ||
      `${type.charAt(0).toUpperCase() + type.slice(1)}`,
    type,
    lat: facilityLat,
    lon: facilityLon,
    distanceKm,
    tags,
  };
}

async function fetchOverpass(query: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7500);

  try {
    const response = await fetch(OVERPASS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      },
      body: `data=${encodeURIComponent(query)}`,
      signal: controller.signal,
    });

    const text = await response.text();

    if (!response.ok) {
      throw new Error(`Overpass returned ${response.status}: ${text.slice(0, 120)}`);
    }

    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
  }
}

const handler: Handler = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');

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

    const radius = clampRadius(body.radius);

    let raw: any;

    try {
      raw = await fetchOverpass(buildFastQuery(lat, lon, radius));
    } catch (error: any) {
      console.error('Overpass failed:', error?.message || error);

      // Important: return JSON instead of letting Vercel timeout/crash.
      return res.status(200).json({
        success: true,
        data: {
          facilities: [],
          radiusUsed: radius,
          source: 'OpenStreetMap Overpass',
          warning:
            'Facility service is temporarily unavailable or too slow. Isochrone analysis is still available.',
        },
      });
    }

    const facilities = (raw.elements || [])
      .map((el: any) => normaliseFacility(el, lat, lon))
      .filter(Boolean)
      .filter((f: any) => f.distanceKm * 1000 <= radius);

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

    console.log('Overpass facilities found:', unique.length, 'radius:', radius);

    return res.status(200).json({
      success: true,
      data: {
        facilities: unique.slice(0, 250),
        radiusUsed: radius,
        source: 'OpenStreetMap Overpass',
        debug: {
          lat,
          lon,
          radius,
          count: unique.length,
        },
      },
    });
  } catch (error: any) {
    console.error('Facility API crashed:', error?.message || error);

    return res.status(200).json({
      success: true,
      data: {
        facilities: [],
        radiusUsed: null,
        source: 'OpenStreetMap Overpass',
        warning: 'Facility fetch failed safely. Isochrone analysis is still available.',
      },
    });
  }
};

export default handler;
