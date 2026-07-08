type Handler = (req: any, res: any) => Promise<any>;

export const config = {
  maxDuration: 10,
};

type FacilityType = 'hospital' | 'clinic' | 'pharmacy' | 'doctors' | 'healthcare';

type RawElement = {
  type?: string;
  id?: number | string;
  lat?: number;
  lon?: number;
  center?: { lat?: number; lon?: number };
  tags?: Record<string, any>;
};

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

function clampRadius(radius: unknown) {
  const parsed = Number(radius);
  if (!Number.isFinite(parsed)) return 8000;

  // Keep below 10 km for Vercel Hobby. Large Dhaka queries can time out.
  return Math.min(Math.max(parsed, 1000), 10000);
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

function bboxFromRadius(lat: number, lon: number, radiusMeters: number) {
  const radiusKm = radiusMeters / 1000;
  const latDelta = radiusKm / 111;
  const lonDelta = radiusKm / (111 * Math.max(Math.cos((lat * Math.PI) / 180), 0.15));

  return {
    south: lat - latDelta,
    west: lon - lonDelta,
    north: lat + latDelta,
    east: lon + lonDelta,
  };
}

function buildFastQuery(lat: number, lon: number, radius: number) {
  const b = bboxFromRadius(lat, lon, radius);

  return `
[out:json][timeout:6];
(
  node["amenity"~"^(hospital|clinic|pharmacy|doctors|dentist)$"](${b.south},${b.west},${b.north},${b.east});
  way["amenity"~"^(hospital|clinic|pharmacy|doctors|dentist)$"](${b.south},${b.west},${b.north},${b.east});
  relation["amenity"~"^(hospital|clinic|pharmacy|doctors|dentist)$"](${b.south},${b.west},${b.north},${b.east});

  node["healthcare"](${b.south},${b.west},${b.north},${b.east});
  way["healthcare"](${b.south},${b.west},${b.north},${b.east});
  relation["healthcare"](${b.south},${b.west},${b.north},${b.east});

  node["name"~"hospital|clinic|pharmacy|medical|diagnostic|doctor|health|care|হাসপাতাল|ক্লিনিক|ফার্মেসি|ডায়াগনস্টিক|ডায়াগনস্টিক|মেডিকেল|ডাক্তার|স্বাস্থ্য",i](${b.south},${b.west},${b.north},${b.east});
  way["name"~"hospital|clinic|pharmacy|medical|diagnostic|doctor|health|care|হাসপাতাল|ক্লিনিক|ফার্মেসি|ডায়াগনস্টিক|ডায়াগনস্টিক|মেডিকেল|ডাক্তার|স্বাস্থ্য",i](${b.south},${b.west},${b.north},${b.east});
  relation["name"~"hospital|clinic|pharmacy|medical|diagnostic|doctor|health|care|হাসপাতাল|ক্লিনিক|ফার্মেসি|ডায়াগনস্টিক|ডায়াগনস্টিক|মেডিকেল|ডাক্তার|স্বাস্থ্য",i](${b.south},${b.west},${b.north},${b.east});
);
out tags center 800;
`;
}

function buildNodeOnlyFallbackQuery(lat: number, lon: number, radius: number) {
  return `
[out:json][timeout:5];
(
  node["amenity"~"^(hospital|clinic|pharmacy|doctors|dentist)$"](around:${radius},${lat},${lon});
  node["healthcare"](around:${radius},${lat},${lon});
  node["name"~"hospital|clinic|pharmacy|medical|diagnostic|doctor|health|care|হাসপাতাল|ক্লিনিক|ফার্মেসি|ডায়াগনস্টিক|ডায়াগনস্টিক|মেডিকেল|ডাক্তার|স্বাস্থ্য",i](around:${radius},${lat},${lon});
);
out tags 500;
`;
}

function normaliseFacility(el: RawElement, originLat: number, originLon: number) {
  const facilityLat = el.lat ?? el.center?.lat;
  const facilityLon = el.lon ?? el.center?.lon;
  const tags = el.tags || {};

  if (typeof facilityLat !== 'number' || typeof facilityLon !== 'number') return null;

  const amenity = String(tags.amenity || '').toLowerCase();
  const healthcare = String(tags.healthcare || '').toLowerCase();
  const name = String(tags.name || tags['name:en'] || tags.brand || tags.operator || '').trim();
  const searchable = `${amenity} ${healthcare} ${name}`.toLowerCase();

  const looksHealthcare =
    amenity === 'hospital' ||
    amenity === 'clinic' ||
    amenity === 'pharmacy' ||
    amenity === 'doctors' ||
    amenity === 'dentist' ||
    healthcare.length > 0 ||
    /hospital|clinic|pharmacy|medical|diagnostic|doctor|health|care|হাসপাতাল|ক্লিনিক|ফার্মেসি|ডায়াগনস্টিক|ডায়াগনস্টিক|মেডিকেল|ডাক্তার|স্বাস্থ্য/i.test(searchable);

  if (!looksHealthcare) return null;

  let type: FacilityType = 'healthcare';

  if (amenity === 'hospital' || healthcare === 'hospital' || /hospital|হাসপাতাল/i.test(name)) {
    type = 'hospital';
  } else if (
    amenity === 'clinic' ||
    healthcare === 'clinic' ||
    healthcare === 'centre' ||
    /clinic|diagnostic|medical|health centre|ক্লিনিক|ডায়াগনস্টিক|ডায়াগনস্টিক|মেডিকেল/i.test(name)
  ) {
    type = 'clinic';
  } else if (amenity === 'pharmacy' || healthcare === 'pharmacy' || /pharmacy|drug|ফার্মেসি/i.test(name)) {
    type = 'pharmacy';
  } else if (
    amenity === 'doctors' ||
    amenity === 'dentist' ||
    healthcare === 'doctor' ||
    healthcare === 'doctors' ||
    healthcare === 'dentist' ||
    /doctor|physician|dentist|ডাক্তার/i.test(name)
  ) {
    type = 'doctors';
  }

  const distanceKm = haversineKm(originLat, originLon, facilityLat, facilityLon);

  return {
    id: `${el.type || 'osm'}-${el.id}`,
    osmType: el.type,
    osmId: el.id,
    name: name || tags.operator || tags.brand || `${type.charAt(0).toUpperCase() + type.slice(1)}`,
    type,
    lat: facilityLat,
    lon: facilityLon,
    distanceKm,
    tags,
  };
}

async function queryOneEndpoint(endpoint: string, query: string, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: `data=${encodeURIComponent(query)}`,
      signal: controller.signal,
    });

    const text = await response.text();

    if (!response.ok) {
      throw new Error(`Overpass ${response.status}: ${text.slice(0, 220)}`);
    }

    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
  }
}

async function queryOverpass(query: string, timeoutMs = 6500) {
  let lastError = '';

  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      return await queryOneEndpoint(endpoint, query, timeoutMs);
    } catch (error: any) {
      lastError = error?.message || 'Overpass request failed';
      console.error('Overpass endpoint failed:', endpoint, lastError);
    }
  }

  throw new Error(lastError || 'All Overpass endpoints failed');
}

function uniqueFacilities(rawElements: RawElement[], lat: number, lon: number, radius: number) {
  const facilities = rawElements
    .map((el) => normaliseFacility(el, lat, lon))
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
  return unique;
}

const handler: Handler = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') return res.status(204).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    const lat = Number(body.lat);
    const lon = Number(body.lon);

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return res.status(400).json({ success: false, error: 'Invalid coordinates' });
    }

    const radius = clampRadius(body.radius);
    const debug: Record<string, any> = { lat, lon, radius, strategy: 'bbox' };

    let rawElements: RawElement[] = [];
    let warning = '';

    try {
      const raw = await queryOverpass(buildFastQuery(lat, lon, radius), 6500);
      rawElements = raw?.elements || [];
      debug.rawElementCount = rawElements.length;
    } catch (error: any) {
      warning = error?.message || 'BBox Overpass query failed';
      debug.bboxError = warning;
      console.error('Facility bbox query failed:', warning);
    }

    let unique = uniqueFacilities(rawElements, lat, lon, radius);

    if (unique.length === 0) {
      try {
        debug.strategy = 'node-only-fallback';
        const raw = await queryOverpass(buildNodeOnlyFallbackQuery(lat, lon, Math.min(radius, 8000)), 5500);
        rawElements = raw?.elements || [];
        debug.fallbackRawElementCount = rawElements.length;
        unique = uniqueFacilities(rawElements, lat, lon, Math.min(radius, 8000));
      } catch (error: any) {
        warning = error?.message || warning || 'Node-only Overpass query failed';
        debug.fallbackError = warning;
        console.error('Facility node fallback failed:', warning);
      }
    }

    debug.facilityCount = unique.length;
    console.log('Facility fetch result:', debug);

    return res.status(200).json({
      success: true,
      data: {
        facilities: unique.slice(0, 500),
        radiusUsed: radius,
        source: 'OpenStreetMap Overpass',
        warning: unique.length === 0 ? warning || 'No OSM healthcare features returned for this query' : undefined,
        debug,
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
        warning: error?.message || 'Facility fetch failed safely',
        debug: { crashed: true },
      },
    });
  }
};

export default handler;
