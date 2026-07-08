type Handler = (req: any, res: any) => Promise<any>;

export const config = {
  maxDuration: 10,
};

const VERSION = 'v6-node-only-debug';

type FacilityType = 'hospital' | 'clinic' | 'pharmacy' | 'doctors' | 'healthcare';

type RawNode = {
  type?: string;
  id?: number | string;
  lat?: number;
  lon?: number;
  tags?: Record<string, any>;
};

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

function clampRadius(radius: unknown) {
  const parsed = Number(radius);
  if (!Number.isFinite(parsed)) return 5000;
  return Math.min(Math.max(parsed, 1000), 7000);
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

function buildNodeAroundQuery(lat: number, lon: number, radius: number) {
  return `
[out:json][timeout:7];
(
  node["amenity"="hospital"](around:${radius},${lat},${lon});
  node["amenity"="clinic"](around:${radius},${lat},${lon});
  node["amenity"="pharmacy"](around:${radius},${lat},${lon});
  node["amenity"="doctors"](around:${radius},${lat},${lon});
  node["amenity"="dentist"](around:${radius},${lat},${lon});

  node["healthcare"="hospital"](around:${radius},${lat},${lon});
  node["healthcare"="clinic"](around:${radius},${lat},${lon});
  node["healthcare"="pharmacy"](around:${radius},${lat},${lon});
  node["healthcare"="doctor"](around:${radius},${lat},${lon});
  node["healthcare"="doctors"](around:${radius},${lat},${lon});
  node["healthcare"="centre"](around:${radius},${lat},${lon});
  node["healthcare"="dentist"](around:${radius},${lat},${lon});
);
out body 300;
`;
}

function normaliseNode(el: RawNode, originLat: number, originLon: number) {
  if (typeof el.lat !== 'number' || typeof el.lon !== 'number') return null;

  const tags = el.tags || {};
  const amenity = String(tags.amenity || '').toLowerCase();
  const healthcare = String(tags.healthcare || '').toLowerCase();

  let type: FacilityType = 'healthcare';

  if (amenity === 'hospital' || healthcare === 'hospital') {
    type = 'hospital';
  } else if (amenity === 'clinic' || healthcare === 'clinic' || healthcare === 'centre') {
    type = 'clinic';
  } else if (amenity === 'pharmacy' || healthcare === 'pharmacy') {
    type = 'pharmacy';
  } else if (
    amenity === 'doctors' ||
    amenity === 'dentist' ||
    healthcare === 'doctor' ||
    healthcare === 'doctors' ||
    healthcare === 'dentist'
  ) {
    type = 'doctors';
  }

  const distanceKm = haversineKm(originLat, originLon, el.lat, el.lon);

  return {
    id: `${el.type || 'node'}-${el.id}`,
    osmType: el.type || 'node',
    osmId: el.id,
    name:
      tags.name ||
      tags['name:en'] ||
      tags.operator ||
      tags.brand ||
      `${type.charAt(0).toUpperCase() + type.slice(1)}`,
    type,
    lat: el.lat,
    lon: el.lon,
    distanceKm,
    tags,
  };
}

async function queryEndpoint(endpoint: string, query: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8500);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      },
      body: `data=${encodeURIComponent(query)}`,
      signal: controller.signal,
    });

    const text = await response.text();

    if (!response.ok) {
      throw new Error(`Overpass ${response.status}: ${text.slice(0, 200)}`);
    }

    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
  }
}

async function queryOverpass(query: string) {
  let lastError = '';

  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      return await queryEndpoint(endpoint, query);
    } catch (error: any) {
      lastError = error?.message || 'Overpass failed';
      console.error('Overpass endpoint failed:', endpoint, lastError);
    }
  }

  throw new Error(lastError || 'All Overpass endpoints failed');
}

const handler: Handler = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') return res.status(204).end();

  if (req.method !== 'POST') {
    return res.status(405).json({
      success: false,
      error: 'Method not allowed',
      version: VERSION,
    });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};

    const lat = Number(body.lat);
    const lon = Number(body.lon);
    const radius = clampRadius(body.radius);

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid coordinates',
        version: VERSION,
      });
    }

    const query = buildNodeAroundQuery(lat, lon, radius);

    let rawElements: RawNode[] = [];
    let warning = '';

    try {
      const raw = await queryOverpass(query);
      rawElements = Array.isArray(raw?.elements) ? raw.elements : [];
    } catch (error: any) {
      warning = error?.message || 'Overpass query failed';
      console.error('Facility node-only query failed:', warning);
    }

    const facilities = rawElements
      .map((el) => normaliseNode(el, lat, lon))
      .filter(Boolean)
      .filter((f: any) => Number(f.distanceKm) * 1000 <= radius);

    const seen = new Set<string>();

    const unique = facilities.filter((f: any) => {
      const key = f.osmId
        ? `${f.osmType}-${f.osmId}`
        : `${Number(f.lat).toFixed(5)},${Number(f.lon).toFixed(5)},${f.type},${f.name}`;

      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    unique.sort((a: any, b: any) => Number(a.distanceKm) - Number(b.distanceKm));

    const debug = {
      version: VERSION,
      lat,
      lon,
      radius,
      rawElementCount: rawElements.length,
      facilityCount: unique.length,
      warning,
      firstRawElement: rawElements[0] || null,
      firstFacility: unique[0] || null,
    };

    console.log('Facility API debug:', debug);

    return res.status(200).json({
      success: true,
      data: {
        facilities: unique.slice(0, 300),
        radiusUsed: radius,
        source: 'OpenStreetMap Overpass',
        warning: unique.length === 0 ? warning || 'No node-based OSM healthcare facilities returned' : undefined,
        debug,
      },
    });
  } catch (error: any) {
    return res.status(200).json({
      success: true,
      data: {
        facilities: [],
        radiusUsed: null,
        source: 'OpenStreetMap Overpass',
        warning: error?.message || 'Facility fetch failed safely',
        debug: {
          version: VERSION,
          crashed: true,
        },
      },
    });
  }
};

export default handler;
