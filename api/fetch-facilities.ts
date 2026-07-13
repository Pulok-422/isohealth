// Vercel Serverless Function: fetch healthcare facilities from OpenStreetMap Overpass.

interface ApiRequest {
  method?: string;
  body?: unknown;
}

interface ApiResponse {
  setHeader(name: string, value: string): void;
  status(code: number): ApiResponse;
  json(payload: unknown): ApiResponse;
  end(): void;
}

type Handler = (req: ApiRequest, res: ApiResponse) => Promise<ApiResponse | void>;

export const config = {
  maxDuration: 60,
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

type RawOverpassResponse = {
  elements?: RawOsmElement[];
  remark?: unknown;
};

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

type ProviderOutcome =
  | 'success'
  | 'timeout'
  | 'network_error'
  | 'http_error'
  | 'invalid_json'
  | 'invalid_response';

export type ProviderAttempt = {
  provider: string;
  status?: number;
  durationMs: number;
  outcome: ProviderOutcome;
  message?: string;
};

type ProviderResult = {
  response: RawOverpassResponse;
  attempt: ProviderAttempt;
};

const OVERPASS_ENDPOINTS = [
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
] as const;

const MAX_FACILITIES = 1000;
const DEDUPE_TOLERANCE_METERS = 15;
const PROVIDER_TIMEOUT_MS = 18_000;
const TOTAL_TIMEOUT_MS = 52_000;

function createRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `overpass-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseBody(body: unknown): Record<string, unknown> {
  if (typeof body === 'string') {
    const parsed: unknown = JSON.parse(body || '{}');

    if (!isRecord(parsed)) {
      throw new Error('Request body must be a JSON object.');
    }

    return parsed;
  }

  if (isRecord(body)) {
    return body;
  }

  return {};
}

function haversineMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const earthRadiusMetres = 6_371_000;
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) ** 2;

  return earthRadiusMetres * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function buildFacilityQuery(
  lat: number,
  lon: number,
  radius: number,
): string {
  return `
[out:json][timeout:15];
(
  nwr["amenity"~"^(hospital|clinic|pharmacy|doctors|dentist)$"](around:${radius},${lat},${lon});
  nwr["healthcare"~"^(hospital|clinic|pharmacy|doctor|doctors|centre|health_centre|dentist|laboratory)$"](around:${radius},${lat},${lon});
);
out center tags qt;
`;
}

function tagsToStringMap(
  raw: Record<string, unknown> | undefined,
): Record<string, string> {
  const output: Record<string, string> = {};

  if (!raw) {
    return output;
  }

  for (const [key, value] of Object.entries(raw)) {
    if (value == null) {
      continue;
    }

    output[key] = String(value);
  }

  return output;
}

function mapFacilityType(tags: Record<string, string>): FacilityType {
  const amenity = (tags.amenity || '').toLowerCase();
  const healthcare = (tags.healthcare || '').toLowerCase();

  if (amenity === 'hospital' || healthcare === 'hospital') {
    return 'hospital';
  }

  if (
    amenity === 'clinic' ||
    healthcare === 'clinic' ||
    healthcare === 'centre' ||
    healthcare === 'health_centre'
  ) {
    return 'clinic';
  }

  if (amenity === 'pharmacy' || healthcare === 'pharmacy') {
    return 'pharmacy';
  }

  if (
    amenity === 'doctors' ||
    healthcare === 'doctor' ||
    healthcare === 'doctors'
  ) {
    return 'doctors';
  }

  if (amenity === 'dentist' || healthcare === 'dentist') {
    return 'dentist';
  }

  if (healthcare === 'laboratory') {
    return 'laboratory';
  }

  return 'healthcare';
}

function prettyType(type: FacilityType): string {
  return type.charAt(0).toUpperCase() + type.slice(1);
}

function resolveName(
  tags: Record<string, string>,
  type: FacilityType,
): {
  name: string;
  localName?: string;
} {
  const localName = tags.name || tags['name:local'] || undefined;

  const name =
    tags['name:en'] ||
    tags.name ||
    tags.official_name ||
    tags.operator ||
    tags.brand ||
    prettyType(type);

  return {
    name,
    localName: localName && localName !== name ? localName : undefined,
  };
}

function normalizeElement(
  element: RawOsmElement,
  originLat: number,
  originLon: number,
): NormalizedFacility | null {
  const lat =
    typeof element.lat === 'number'
      ? element.lat
      : element.center?.lat;

  const lon =
    typeof element.lon === 'number'
      ? element.lon
      : element.center?.lon;

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return null;
  }

  if (!element.type || element.id == null) {
    return null;
  }

  const facilityLat = lat as number;
  const facilityLon = lon as number;
  const tags = tagsToStringMap(element.tags);
  const type = mapFacilityType(tags);
  const { name, localName } = resolveName(tags, type);

  return {
    id: `${element.type}-${element.id}`,
    source: 'OpenStreetMap',
    osmType: element.type,
    osmId: element.id,
    name,
    localName,
    type,
    lat: facilityLat,
    lon: facilityLon,
    tags,
    operator: tags.operator || tags.brand || undefined,
    openingHours: tags.opening_hours || undefined,
    emergency: tags.emergency || undefined,
    speciality:
      tags['healthcare:speciality'] ||
      tags.speciality ||
      undefined,
    straightLineDistanceMeters: haversineMeters(
      originLat,
      originLon,
      facilityLat,
      facilityLon,
    ),
  };
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

function dedupeFacilities(
  facilities: NormalizedFacility[],
): {
  unique: NormalizedFacility[];
  possibleDuplicates: number;
} {
  const seenIds = new Set<string>();
  const uniqueById: NormalizedFacility[] = [];

  for (const facility of facilities) {
    const key = `${facility.osmType}-${facility.osmId}`;

    if (seenIds.has(key)) {
      continue;
    }

    seenIds.add(key);
    uniqueById.push(facility);
  }

  let possibleDuplicates = 0;
  const kept: NormalizedFacility[] = [];

  for (const facility of uniqueById) {
    const duplicate = kept.find((candidate) => {
      if (candidate.type !== facility.type) {
        return false;
      }

      if (
        normalizeName(candidate.name) !==
        normalizeName(facility.name)
      ) {
        return false;
      }

      return (
        haversineMeters(
          candidate.lat,
          candidate.lon,
          facility.lat,
          facility.lon,
        ) <= DEDUPE_TOLERANCE_METERS
      );
    });

    if (duplicate) {
      possibleDuplicates += 1;
      continue;
    }

    kept.push(facility);
  }

  return {
    unique: kept,
    possibleDuplicates,
  };
}

function safeMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message.slice(0, 240);
  }

  return 'Unknown provider error';
}

async function queryEndpoint(
  endpoint: string,
  query: string,
  timeoutMs: number,
): Promise<ProviderResult> {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let response: Response;

    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type':
            'application/x-www-form-urlencoded;charset=UTF-8',
          'User-Agent':
            process.env.OVERPASS_USER_AGENT ||
            'isoHealth/1.0 healthcare-accessibility-platform',
        },
        body: new URLSearchParams({
          data: query,
        }).toString(),
        signal: controller.signal,
      });
    } catch (error) {
      const timedOut =
        error instanceof Error && error.name === 'AbortError';

      const attempt: ProviderAttempt = {
        provider: endpoint,
        durationMs: Date.now() - startedAt,
        outcome: timedOut ? 'timeout' : 'network_error',
        message: timedOut
          ? `Timed out after ${timeoutMs} ms`
          : safeMessage(error),
      };

      throw Object.assign(
        new Error(attempt.message),
        { attempt },
      );
    }

    const text = await response.text();

    if (!response.ok) {
      const attempt: ProviderAttempt = {
        provider: endpoint,
        status: response.status,
        durationMs: Date.now() - startedAt,
        outcome: 'http_error',
        message: `HTTP ${response.status}`,
      };

      throw Object.assign(
        new Error(attempt.message),
        { attempt },
      );
    }

    let parsed: unknown;

    try {
      parsed = JSON.parse(text);
    } catch {
      const attempt: ProviderAttempt = {
        provider: endpoint,
        status: response.status,
        durationMs: Date.now() - startedAt,
        outcome: 'invalid_json',
        message: 'Provider returned invalid JSON.',
      };

      throw Object.assign(
        new Error(attempt.message),
        { attempt },
      );
    }

    if (!isRecord(parsed) || !Array.isArray(parsed.elements)) {
      const attempt: ProviderAttempt = {
        provider: endpoint,
        status: response.status,
        durationMs: Date.now() - startedAt,
        outcome: 'invalid_response',
        message:
          'Provider response did not contain an elements array.',
      };

      throw Object.assign(
        new Error(attempt.message),
        { attempt },
      );
    }

    if (
      typeof parsed.remark === 'string' &&
      parsed.remark.trim()
    ) {
      const attempt: ProviderAttempt = {
        provider: endpoint,
        status: response.status,
        durationMs: Date.now() - startedAt,
        outcome: 'invalid_response',
        message: parsed.remark.slice(0, 240),
      };

      throw Object.assign(
        new Error(attempt.message),
        { attempt },
      );
    }

    return {
      response: parsed as RawOverpassResponse,
      attempt: {
        provider: endpoint,
        status: response.status,
        durationMs: Date.now() - startedAt,
        outcome: 'success',
      },
    };
  } finally {
    clearTimeout(timer);
  }
}

function getAttempt(
  error: unknown,
  endpoint: string,
  startedAt: number,
): ProviderAttempt {
  if (isRecord(error) && isRecord(error.attempt)) {
    return error.attempt as unknown as ProviderAttempt;
  }

  return {
    provider: endpoint,
    durationMs: Date.now() - startedAt,
    outcome: 'network_error',
    message: safeMessage(error),
  };
}

function sendCors(response: ApiResponse): void {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader(
    'Access-Control-Allow-Methods',
    'POST, OPTIONS',
  );
  response.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type',
  );
  response.setHeader(
    'Content-Type',
    'application/json',
  );
}

const handler: Handler = async (req, res) => {
  sendCors(res);

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({
      success: false,
      code: 'METHOD_NOT_ALLOWED',
      error: 'Method not allowed.',
    });
  }

  let body: Record<string, unknown>;

  try {
    body = parseBody(req.body);
  } catch (error) {
    return res.status(400).json({
      success: false,
      code: 'INVALID_JSON',
      error: safeMessage(error),
    });
  }

  const lat = Number(body.lat);
  const lon = Number(body.lon);
  const radius = Number(body.radius);

  if (
    !Number.isFinite(lat) ||
    lat < -90 ||
    lat > 90
  ) {
    return res.status(400).json({
      success: false,
      code: 'INVALID_LATITUDE',
      error:
        'Latitude must be a finite number between -90 and 90.',
    });
  }

  if (
    !Number.isFinite(lon) ||
    lon < -180 ||
    lon > 180
  ) {
    return res.status(400).json({
      success: false,
      code: 'INVALID_LONGITUDE',
      error:
        'Longitude must be a finite number between -180 and 180.',
    });
  }

  if (
    !Number.isFinite(radius) ||
    radius < 1000 ||
    radius > 50_000
  ) {
    return res.status(400).json({
      success: false,
      code: 'INVALID_RADIUS',
      error:
        'Radius must be between 1000 and 50000 metres.',
    });
  }

  const requestId = createRequestId();
  const query = buildFacilityQuery(lat, lon, radius);
  const requestStartedAt = Date.now();
  const attempts: ProviderAttempt[] = [];

  let providerUsed = '';
  let rawResponse: RawOverpassResponse | null = null;

  for (const endpoint of OVERPASS_ENDPOINTS) {
    const elapsed = Date.now() - requestStartedAt;
    const remaining = TOTAL_TIMEOUT_MS - elapsed;

    if (remaining <= 1000) {
      break;
    }

    const endpointStartedAt = Date.now();
    const timeoutMs = Math.min(
      PROVIDER_TIMEOUT_MS,
      remaining,
    );

    try {
      const result = await queryEndpoint(
        endpoint,
        query,
        timeoutMs,
      );

      attempts.push(result.attempt);
      rawResponse = result.response;
      providerUsed = endpoint;
      break;
    } catch (error) {
      attempts.push(
        getAttempt(
          error,
          endpoint,
          endpointStartedAt,
        ),
      );
    }
  }

  if (!rawResponse) {
    const rateLimited = attempts.some(
      (attempt) => attempt.status === 429,
    );

    const status = rateLimited ? 429 : 503;

    const code = rateLimited
      ? 'OVERPASS_RATE_LIMITED'
      : 'OVERPASS_ALL_PROVIDERS_FAILED';

    console.error('OVERPASS_FACILITY_FAILURE', {
      requestId,
      lat,
      lon,
      radius,
      attempts,
    });

    return res.status(status).json({
      success: false,
      code,
      error: rateLimited
        ? 'The OpenStreetMap facility service is rate-limited. Please try again shortly.'
        : 'The OpenStreetMap facility service is temporarily unavailable.',
      requestId,
      attempts,
    });
  }

  const rawElements = rawResponse.elements ?? [];

  const normalized = rawElements
    .map((element) =>
      normalizeElement(
        element,
        lat,
        lon,
      ),
    )
    .filter(
      (
        facility,
      ): facility is NormalizedFacility =>
        facility !== null,
    )
    .sort(
      (a, b) =>
        a.straightLineDistanceMeters -
        b.straightLineDistanceMeters,
    );

  const {
    unique,
    possibleDuplicates,
  } = dedupeFacilities(normalized);

  const truncated =
    unique.length > MAX_FACILITIES;

  const facilities = truncated
    ? unique.slice(0, MAX_FACILITIES)
    : unique;

  console.info('OVERPASS_FACILITY_REQUEST', {
    requestId,
    lat,
    lon,
    radius,
    attempts,
    selectedProvider: providerUsed,
    rawElementCount: rawElements.length,
    normalizedFacilityCount: unique.length,
  });

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
      requestId,
      attempts,
    },
  });
};

export default handler;
