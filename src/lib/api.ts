import type { Facility, TransportProfile } from '@/types/health';

type SuccessEnvelope<T> = { success: true; data: T };
type ErrorEnvelope = { success: false; error: string };
type Envelope<T> = SuccessEnvelope<T> | ErrorEnvelope;

async function postJson<T>(path: string, body: unknown): Promise<T> {
  let response: Response;

  try {
    response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error(`Network error while calling ${path}`);
  }

  let payload: Envelope<T> | null = null;

  try {
    payload = (await response.json()) as Envelope<T>;
  } catch {
    // Non-JSON response
  }

  if (!response.ok || !payload || payload.success !== true) {
    const message =
      (payload && 'error' in payload && payload.error) ||
      `Request failed (${response.status})`;

    throw new Error(message);
  }

  return payload.data;
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

function clampFacilityRadius(radius: number) {
  if (!Number.isFinite(radius)) return 8000;
  return Math.min(Math.max(radius, 1000), 12000);
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

function buildOverpassFacilityQuery(lat: number, lon: number, radiusMeters: number) {
  const b = bboxFromRadius(lat, lon, radiusMeters);

  return `
[out:json][timeout:25];
(
  node["amenity"~"^(hospital|clinic|pharmacy|doctors|dentist)$"](${b.south},${b.west},${b.north},${b.east});
  way["amenity"~"^(hospital|clinic|pharmacy|doctors|dentist)$"](${b.south},${b.west},${b.north},${b.east});
  relation["amenity"~"^(hospital|clinic|pharmacy|doctors|dentist)$"](${b.south},${b.west},${b.north},${b.east});

  node["healthcare"](${b.south},${b.west},${b.north},${b.east});
  way["healthcare"](${b.south},${b.west},${b.north},${b.east});
  relation["healthcare"](${b.south},${b.west},${b.north},${b.east});

  node["name"~"hospital|clinic|pharmacy|medical|diagnostic|doctor|health|হাসপাতাল|ক্লিনিক|ফার্মেসি|ডায়াগনস্টিক|ডায়াগনস্টিক|মেডিকেল|ডাক্তার|স্বাস্থ্য",i](${b.south},${b.west},${b.north},${b.east});
  way["name"~"hospital|clinic|pharmacy|medical|diagnostic|doctor|health|হাসপাতাল|ক্লিনিক|ফার্মেসি|ডায়াগনস্টিক|ডায়াগনস্টিক|মেডিকেল|ডাক্তার|স্বাস্থ্য",i](${b.south},${b.west},${b.north},${b.east});
  relation["name"~"hospital|clinic|pharmacy|medical|diagnostic|doctor|health|হাসপাতাল|ক্লিনিক|ফার্মেসি|ডায়াগনস্টিক|ডায়াগনস্টিক|মেডিকেল|ডাক্তার|স্বাস্থ্য",i](${b.south},${b.west},${b.north},${b.east});
);
out body center 500;
`;
}

function normaliseFacility(el: any, originLat: number, originLon: number): Facility | null {
  const facilityLat = el.lat ?? el.center?.lat;
  const facilityLon = el.lon ?? el.center?.lon;
  const tags = el.tags || {};

  if (typeof facilityLat !== 'number' || typeof facilityLon !== 'number') {
    return null;
  }

  const amenity = String(tags.amenity || '').toLowerCase();
  const healthcare = String(tags.healthcare || '').toLowerCase();
  const name = String(
    tags.name ||
      tags['name:en'] ||
      tags.brand ||
      tags.operator ||
      ''
  ).trim();

  let type: Facility['type'] = 'healthcare';

  if (amenity === 'hospital' || healthcare === 'hospital' || /hospital|হাসপাতাল/i.test(name)) {
    type = 'hospital';
  } else if (
    amenity === 'clinic' ||
    healthcare === 'clinic' ||
    healthcare === 'centre' ||
    /clinic|diagnostic|medical|health centre|ক্লিনিক|ডায়াগনস্টিক|ডায়াগনস্টিক|মেডিকেল/i.test(name)
  ) {
    type = 'clinic';
  } else if (
    amenity === 'pharmacy' ||
    healthcare === 'pharmacy' ||
    /pharmacy|drug|ফার্মেসি/i.test(name)
  ) {
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
    name:
      name ||
      tags.operator ||
      tags.brand ||
      `${type.charAt(0).toUpperCase() + type.slice(1)}`,
    type,
    lat: facilityLat,
    lon: facilityLon,
    tags: {
      ...tags,
      osmType: String(el.type || ''),
      osmId: String(el.id || ''),
      distanceKm: String(distanceKm),
    },
  };
}

async function queryOverpassDirect(query: string) {
  const endpoints = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
  ];

  let lastError = '';

  for (const endpoint of endpoints) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 25000);

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
        lastError = `${endpoint} returned ${response.status}: ${text.slice(0, 160)}`;
        console.warn(lastError);
        continue;
      }

      return JSON.parse(text);
    } catch (error: any) {
      lastError = error?.message || 'Overpass request failed';
      console.warn('Overpass endpoint failed:', endpoint, lastError);
    } finally {
      window.clearTimeout(timer);
    }
  }

  throw new Error(lastError || 'All Overpass endpoints failed');
}

export async function fetchFacilities(
  lat: number,
  lon: number,
  radius: number = 8000
): Promise<Facility[]> {
  const safeRadius = clampFacilityRadius(radius);
  const query = buildOverpassFacilityQuery(lat, lon, safeRadius);

  console.log('Fetching facilities directly from Overpass:', {
    lat,
    lon,
    radius: safeRadius,
  });

  try {
    const raw = await queryOverpassDirect(query);
    const rawElements = raw?.elements || [];

    console.log('Raw Overpass elements:', rawElements.length);

    const facilities = rawElements
      .map((el: any) => normaliseFacility(el, lat, lon))
      .filter(Boolean)
      .filter((f: Facility) => {
        const distanceKm = Number(f.tags?.distanceKm || 0);
        return distanceKm * 1000 <= safeRadius;
      });

    const seen = new Set<string>();

    const unique = facilities.filter((f: Facility) => {
      const osmType = f.tags?.osmType || '';
      const osmId = f.tags?.osmId || '';
      const key = osmId
        ? `${osmType}-${osmId}`
        : `${f.lat.toFixed(5)},${f.lon.toFixed(5)},${f.type},${f.name}`;

      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    unique.sort((a: Facility, b: Facility) => {
      const da = Number(a.tags?.distanceKm || 0);
      const db = Number(b.tags?.distanceKm || 0);
      return da - db;
    });

    console.log('Fetched facilities:', unique.length, unique.slice(0, 20));

    return unique.slice(0, 500);
  } catch (error) {
    console.error('Direct Overpass facility fetch failed:', error);
    return [];
  }
}

export async function generateIsochrones(
  lat: number,
  lon: number,
  profile: TransportProfile = 'foot-walking',
  ranges: number[] = [300, 600, 900, 1800],
  range_type: 'time' | 'distance' = 'time'
) {
  return postJson<any>('/api/generate-isochrones', {
    lat,
    lon,
    profile,
    ranges,
    range_type,
  });
}

export async function calculateRoute(
  start: { lat: number; lon: number },
  end: { lat: number; lon: number },
  profile: TransportProfile = 'driving-car'
) {
  return postJson<any>('/api/calculate-route', {
    start,
    end,
    profile,
  });
}

export async function computeMatrix(
  origins: { lat: number; lon: number }[],
  destinations: { lat: number; lon: number }[],
  profile: TransportProfile = 'driving-car'
) {
  return postJson<any>('/api/compute-matrix', {
    origins,
    destinations,
    profile,
  });
}
