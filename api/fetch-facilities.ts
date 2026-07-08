type Handler = (req: any, res: any) => Promise<any>;

export const config = {
  maxDuration: 10,
};

type FacilityType = 'hospital' | 'clinic' | 'pharmacy' | 'doctors' | 'healthcare';

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

function clampRadius(radius: unknown) {
  const parsed = Number(radius);
  if (!Number.isFinite(parsed)) return 7000;

  // Keep this small enough for Vercel Hobby.
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

function buildQuery(lat: number, lon: number, radius: number) {
  return `
[out:json][timeout:8];
(
  node["amenity"="hospital"](around:${radius},${lat},${lon});
  node["amenity"="clinic"](around:${radius},${lat},${lon});
  node["amenity"="pharmacy"](around:${radius},${lat},${lon});
  node["amenity"="doctors"](around:${radius},${lat},${lon});

  way["amenity"="hospital"](around:${radius},${lat},${lon});
  way["amenity"="clinic"](around:${radius},${lat},${lon});
  way["amenity"="pharmacy"](around:${radius},${lat},${lon});
  way["amenity"="doctors"](around:${radius},${lat},${lon});

  relation["amenity"="hospital"](around:${radius},${lat},${lon});
  relation["amenity"="clinic"](around:${radius},${lat},${lon});
  relation["amenity"="pharmacy"](around:${radius},${lat},${lon});
  relation["amenity"="doctors"](around:${radius},${lat},${lon});

  node["healthcare"](around:${radius},${lat},${lon});
  way["healthcare"](around:${radius},${lat},${lon});
  relation["healthcare"](around:${radius},${lat},${lon});

  node["name"~"hospital|clinic|pharmacy|medical|diagnostic|health",i](around:${radius},${lat},${lon});
  way["name"~"hospital|clinic|pharmacy|medical|diagnostic|health",i](around:${radius},${lat},${lon});
);
out center 300;
`;
}

function normaliseFacility(el: any, originLat: number, originLon: number) {
  const facilityLat = el.lat ?? el.center?.lat;
  const facilityLon = el.lon ?? el.center?.lon;
  const tags = el.tags || {};

  if (typeof facilityLat !== 'number' || typeof facilityLon !== 'number') {
    return null;
  }

  const amenity = String(tags.amenity || '').toLowerCase();
  const healthcare = String(tags.healthcare || '').toLowerCase();
  const name = String(tags.name || tags['name:en'] || tags.brand || tags.operator || '').trim();

  let type: FacilityType = 'healthcare';

  if (amenity === 'hospital' || healthcare === 'hospital' || /hospital/i.test(name)) {
    type = 'hospital';
  } else if (
    amenity === 'clinic' ||
    healthcare === 'clinic' ||
    healthcare === 'centre' ||
    /clinic|diagnostic|medical|health centre/i.test(name)
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

async function queryOverpass(query: string) {
  let lastError = '';

  for (const endpoint of OVERPASS_ENDPOINTS) {
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
        lastError = `Overpass ${response.status}: ${text.slice(0, 180)}`;
        console.error(lastError);
        continue;
      }

      return JSON.parse(text);
    } catch (error: any) {
      lastError = error?.message || 'Overpass request failed';
      console.error('Overpass endpoint failed:', endpoint, lastError);
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error(lastError || 'All Overpass endpoints failed');
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
    const query = buildQuery(lat, lon, radius);

    console.log('Facility query input:', { lat, lon, radius });

    let raw: any;

    try {
      raw = await queryOverpass(query);
    } catch (error: any) {
      console.error('Facility Overpass failed:', error?.message || error);

      return res.status(200).json({
        success: true,
        data: {
          facilities: [],
          radiusUsed: radius,
          source: 'OpenStreetMap Overpass',
          warning: error?.message || 'Overpass failed',
        },
      });
    }

    const rawElements = raw?.elements || [];

    console.log('Raw Overpass elements:', rawElements.length);

    const facilities = rawElements
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

    console.log('Normalised facilities:', unique.length);

    return res.status(200).json({
      success: true,
      data: {
        facilities: unique.slice(0, 300),
        radiusUsed: radius,
        source: 'OpenStreetMap Overpass',
        debug: {
          lat,
          lon,
          radius,
          rawElementCount: rawElements.length,
          facilityCount: unique.length,
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
        warning: error?.message || 'Facility fetch failed safely',
      },
    });
  }
};

export default handler;
