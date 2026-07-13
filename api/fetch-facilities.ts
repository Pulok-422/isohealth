// Vercel Serverless Function — fetch healthcare facilities from OpenStreetMap Overpass.

type Handler = (req: any, res: any) => Promise<any>;

export const config = {
  maxDuration: 30,
};

type FacilityType =
  | 'hospital'
  | 'clinic'
  | 'pharmacy'
  | 'doctors'
  | 'dentist'
  | 'laboratory'
  | 'healthcare';

type OsmObjectType = 'node' | 'way' | 'relation';

type RawOsmElement = {
  type?: OsmObjectType;
  id?: number | string;
  lat?: number;
  lon?: number;
  center?: { lat?: number; lon?: number };
  tags?: Record<string, unknown>;
};

type RawOverpassResponse = { elements?: RawOsmElement[] };

type NormalizedFacility = {
  id: string;
  source: 'OpenStreetMap';
  osmType: OsmObjectType;
  osmId: number | string;
  name: string;
  localName?: string;
  type: FacilityType;
  lat: number;
  lon: number;
  tags: Record<string, string>;
  operator?: string;
  openingHours?: string;
  emergency?: string;
  speciality?: string;
  straightLineDistanceMeters: number;
};

const OVERPASS_ENDPOINTS = [
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass-api.de/api/interpreter',
];

const MAX_FACILITIES = 1000;
const DEDUPE_TOLERANCE_METERS = 15;

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function buildFacilityQuery(lat: number, lon: number, radius: number): string {
  return `
[out:json][timeout:20];
(
  nwr["amenity"~"^(hospital|clinic|pharmacy|doctors|dentist)$"](around:${radius},${lat},${lon});
  nwr["healthcare"~"^(hospital|clinic|pharmacy|doctor|doctors|centre|health_centre|dentist|laboratory)$"](around:${radius},${lat},${lon});
);
out center tags qt;
`;
}

function tagsToStringMap(raw: Record<string, unknown> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw) return out;
  for (const [key, value] of Object.entries(raw)) {
    if (value == null) continue;
    out[key] = String(value);
  }
  return out;
}

function mapFacilityType(tags: Record<string, string>): FacilityType {
  const amenity = (tags.amenity || '').toLowerCase();
  const healthcare = (tags.healthcare || '').toLowerCase();

  if (amenity === 'hospital' || healthcare === 'hospital') return 'hospital';
  if (
    amenity === 'clinic' ||
    healthcare === 'clinic' ||
    healthcare === 'centre' ||
    healthcare === 'health_centre'
  ) {
    return 'clinic';
  }
  if (amenity === 'pharmacy' || healthcare === 'pharmacy') return 'pharmacy';
  if (amenity === 'doctors' || healthcare === 'doctor' || healthcare === 'doctors') return 'doctors';
  if (amenity === 'dentist' || healthcare === 'dentist') return 'dentist';
  if (healthcare === 'laboratory') return 'laboratory';
  return 'healthcare';
}

function prettyType(type: FacilityType): string {
  return type.charAt(0).toUpperCase() + type.slice(1);
}

function resolveName(tags: Record<string, string>, type: FacilityType): { name: string; localName?: string } {
  const localName = tags.name || tags['name:local'] || undefined;
  const name =
    tags['name:en'] ||
    tags.name ||
    tags.official_name ||
    tags.operator ||
    tags.brand ||
    prettyType(type);
  return { name, localName: localName && localName !== name ? localName : undefined };
}

function normalizeElement(el: RawOsmElement, originLat: number, originLon: number): NormalizedFacility | null {
  const lat = typeof el.lat === 'number' ? el.lat : el.center?.lat;
  const lon = typeof el.lon === 'number' ? el.lon : el.center?.lon;
  if (typeof lat !== 'number' || typeof lon !== 'number') return null;
  if (!el.type || el.id == null) return null;

  const tags = tagsToStringMap(el.tags);
  const type = mapFacilityType(tags);
  const { name, localName } = resolveName(tags, type);

  return {
    id: `${el.type}-${el.id}`,
    source: 'OpenStreetMap',
    osmType: el.type,
    osmId: el.id,
    name,
    localName,
    type,
    lat,
    lon,
    tags,
    operator: tags.operator || tags.brand || undefined,
    openingHours: tags.opening_hours || undefined,
    emergency: tags.emergency || undefined,
    speciality: tags['healthcare:speciality'] || tags.speciality || undefined,
    straightLineDistanceMeters: haversineMeters(originLat, originLon, lat, lon),
  };
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

function dedupeFacilities(list: NormalizedFacility[]): { unique: NormalizedFacility[]; possibleDuplicates: number } {
  const seenIds = new Set<string>();
  const primary: NormalizedFacility[] = [];
  for (const f of list) {
    const key = `${f.osmType}-${f.osmId}`;
    if (seenIds.has(key)) continue;
    seenIds.add(key);
    primary.push(f);
  }

  let possibleDuplicates = 0;
  const kept: NormalizedFacility[] = [];
  for (const f of primary) {
    const dup = kept.find((k) => {
      if (k.type !== f.type) return false;
      if (normalizeName(k.name) !== normalizeName(f.name)) return false;
      return haversineMeters(k.lat, k.lon, f.lat, f.lon) <= DEDUPE_TOLERANCE_METERS;
    });
    if (dup) {
      possibleDuplicates++;
      continue;
    }
    kept.push(f);
  }

  return { unique: kept, possibleDuplicates };
}

async function queryEndpoint(endpoint: string, query: string, timeoutMs: number): Promise<RawOverpassResponse> {
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
      const err = new Error(`Overpass ${response.status}`) as Error & { status?: number };
      err.status = response.status;
      throw err;
    }
    try {
      return JSON.parse(text) as RawOverpassResponse;
    } catch {
      throw new Error('Overpass returned invalid JSON');
    }
  } finally {
    clearTimeout(timer);
  }
}

function sendCors(res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');
}

const handler: Handler = async (req, res) => {
  sendCors(res);

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  let body: any = {};
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
  } catch {
    return res.status(400).json({ success: false, error: 'Request body must be valid JSON.' });
  }

  const lat = Number(body.lat);
  const lon = Number(body.lon);
  const radius = Number(body.radius);

  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    return res.status(400).json({ success: false, error: 'Latitude must be a finite number between -90 and 90.' });
  }
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
    return res.status(400).json({ success: false, error: 'Longitude must be a finite number between -180 and 180.' });
  }
  if (!Number.isFinite(radius) || radius < 1000 || radius > 50_000) {
    return res.status(400).json({ success: false, error: 'Radius must be between 1000 and 50000 metres.' });
  }

  const query = buildFacilityQuery(lat, lon, radius);

  let lastStatus: number | undefined;
  let lastError = '';
  let providerUsed = '';
  let rawResponse: RawOverpassResponse | null = null;

  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      rawResponse = await queryEndpoint(endpoint, query, 10_000);
      providerUsed = endpoint;
      break;
    } catch (error) {
      const e = error as Error & { status?: number };
      lastStatus = e.status;
      lastError = e.message || 'Overpass request failed';
      console.error('Overpass endpoint failed:', endpoint, lastError);
    }
  }

  if (!rawResponse) {
    const status = lastStatus === 429 ? 429 : 503;
    return res.status(status).json({
      success: false,
      error:
        status === 429
          ? 'The OpenStreetMap facility service is rate-limited. Please try again shortly.'
          : 'The OpenStreetMap facility service is temporarily unavailable.',
    });
  }

  const rawElements = Array.isArray(rawResponse.elements) ? rawResponse.elements : [];
  const normalized = rawElements
    .map((el) => normalizeElement(el, lat, lon))
    .filter((f): f is NormalizedFacility => f !== null)
    .sort((a, b) => a.straightLineDistanceMeters - b.straightLineDistanceMeters);

  const { unique, possibleDuplicates } = dedupeFacilities(normalized);
  const truncated = unique.length > MAX_FACILITIES;
  const facilities = truncated ? unique.slice(0, MAX_FACILITIES) : unique;

  return res.status(200).json({
    success: true,
    data: {
      facilities,
      radiusUsed: radius,
      source: 'OpenStreetMap Overpass',
      provider: providerUsed,
      truncated,
      rawElementCount: rawElements.length,
      normalizedCount: unique.length,
      possibleDuplicateCount: possibleDuplicates,
    },
  });
};

export default handler;
