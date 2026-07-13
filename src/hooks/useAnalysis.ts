===== api/fetch-facilities.ts =====
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
    if (!isRecord(parsed)) throw new Error('Request body must be a JSON object.');
    return parsed;
  }
  if (isRecord(body)) return body;
  return {};
}

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
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

function buildFacilityQuery(lat: number, lon: number, radius: number): string {
  return `
[out:json][timeout:15];
(
  nwr["amenity"~"^(hospital|clinic|pharmacy|doctors|dentist)$"](around:${radius},${lat},${lon});
  nwr["healthcare"~"^(hospital|clinic|pharmacy|doctor|doctors|centre|health_centre|dentist|laboratory)$"](around:${radius},${lat},${lon});
);
out center tags qt;
`;
}

function tagsToStringMap(raw: Record<string, unknown> | undefined): Record<string, string> {
  const output: Record<string, string> = {};
  if (!raw) return output;

  for (const [key, value] of Object.entries(raw)) {
    if (value == null) continue;
    output[key] = String(value);
  }

  return output;
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
  if (amenity === 'doctors' || healthcare === 'doctor' || healthcare === 'doctors') {
    return 'doctors';
  }
  if (amenity === 'dentist' || healthcare === 'dentist') return 'dentist';
  if (healthcare === 'laboratory') return 'laboratory';
  return 'healthcare';
}

function prettyType(type: FacilityType): string {
  return type.charAt(0).toUpperCase() + type.slice(1);
}

function resolveName(
  tags: Record<string, string>,
  type: FacilityType,
): { name: string; localName?: string } {
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
  const lat = typeof element.lat === 'number' ? element.lat : element.center?.lat;
  const lon = typeof element.lon === 'number' ? element.lon : element.center?.lon;

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (!element.type || element.id == null) return null;

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
    speciality: tags['healthcare:speciality'] || tags.speciality || undefined,
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
): { unique: NormalizedFacility[]; possibleDuplicates: number } {
  const seenIds = new Set<string>();
  const uniqueById: NormalizedFacility[] = [];

  for (const facility of facilities) {
    const key = `${facility.osmType}-${facility.osmId}`;
    if (seenIds.has(key)) continue;
    seenIds.add(key);
    uniqueById.push(facility);
  }

  let possibleDuplicates = 0;
  const kept: NormalizedFacility[] = [];

  for (const facility of uniqueById) {
    const duplicate = kept.find((candidate) => {
      if (candidate.type !== facility.type) return false;
      if (normalizeName(candidate.name) !== normalizeName(facility.name)) return false;
      return (
        haversineMeters(candidate.lat, candidate.lon, facility.lat, facility.lon) <=
        DEDUPE_TOLERANCE_METERS
      );
    });

    if (duplicate) {
      possibleDuplicates += 1;
      continue;
    }

    kept.push(facility);
  }

  return { unique: kept, possibleDuplicates };
}

function safeMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message.slice(0, 240);
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
          'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
          'User-Agent':
            process.env.OVERPASS_USER_AGENT ||
            'isoHealth/1.0 healthcare-accessibility-platform',
        },
        body: new URLSearchParams({ data: query }).toString(),
        signal: controller.signal,
      });
    } catch (error) {
      const timedOut = error instanceof Error && error.name === 'AbortError';
      const attempt: ProviderAttempt = {
        provider: endpoint,
        durationMs: Date.now() - startedAt,
        outcome: timedOut ? 'timeout' : 'network_error',
        message: timedOut ? `Timed out after ${timeoutMs} ms` : safeMessage(error),
      };
      throw Object.assign(new Error(attempt.message), { attempt });
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
      throw Object.assign(new Error(attempt.message), { attempt });
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
      throw Object.assign(new Error(attempt.message), { attempt });
    }

    if (!isRecord(parsed) || !Array.isArray(parsed.elements)) {
      const attempt: ProviderAttempt = {
        provider: endpoint,
        status: response.status,
        durationMs: Date.now() - startedAt,
        outcome: 'invalid_response',
        message: 'Provider response did not contain an elements array.',
      };
      throw Object.assign(new Error(attempt.message), { attempt });
    }

    if (typeof parsed.remark === 'string' && parsed.remark.trim()) {
      const attempt: ProviderAttempt = {
        provider: endpoint,
        status: response.status,
        durationMs: Date.now() - startedAt,
        outcome: 'invalid_response',
        message: parsed.remark.slice(0, 240),
      };
      throw Object.assign(new Error(attempt.message), { attempt });
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

function getAttempt(error: unknown, endpoint: string, startedAt: number): ProviderAttempt {
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
  response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  response.setHeader('Content-Type', 'application/json');
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

  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    return res.status(400).json({
      success: false,
      code: 'INVALID_LATITUDE',
      error: 'Latitude must be a finite number between -90 and 90.',
    });
  }

  if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
    return res.status(400).json({
      success: false,
      code: 'INVALID_LONGITUDE',
      error: 'Longitude must be a finite number between -180 and 180.',
    });
  }

  if (!Number.isFinite(radius) || radius < 1000 || radius > 50_000) {
    return res.status(400).json({
      success: false,
      code: 'INVALID_RADIUS',
      error: 'Radius must be between 1000 and 50000 metres.',
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
    if (remaining <= 1000) break;

    const endpointStartedAt = Date.now();
    const timeoutMs = Math.min(PROVIDER_TIMEOUT_MS, remaining);

    try {
      const result = await queryEndpoint(endpoint, query, timeoutMs);
      attempts.push(result.attempt);
      rawResponse = result.response;
      providerUsed = endpoint;
      break;
    } catch (error) {
      attempts.push(getAttempt(error, endpoint, endpointStartedAt));
    }
  }

  if (!rawResponse) {
    const rateLimited = attempts.some((attempt) => attempt.status === 429);
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
    .map((element) => normalizeElement(element, lat, lon))
    .filter((facility): facility is NormalizedFacility => facility !== null)
    .sort(
      (a, b) =>
        a.straightLineDistanceMeters - b.straightLineDistanceMeters,
    );

  const { unique, possibleDuplicates } = dedupeFacilities(normalized);
  const truncated = unique.length > MAX_FACILITIES;
  const facilities = truncated ? unique.slice(0, MAX_FACILITIES) : unique;

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


===== api/overpass-health.ts =====
interface ApiRequest {
  method?: string;
}

interface ApiResponse {
  setHeader(name: string, value: string): void;
  status(code: number): ApiResponse;
  json(payload: unknown): ApiResponse;
  end(): void;
}

export const config = {
  maxDuration: 30,
};

const OVERPASS_ENDPOINTS = [
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
] as const;

const HEALTH_QUERY = `
[out:json][timeout:5];
node(1);
out ids;
`;

async function checkProvider(endpoint: string) {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        'User-Agent':
          process.env.OVERPASS_USER_AGENT ||
          'isoHealth/1.0 healthcare-accessibility-platform',
      },
      body: new URLSearchParams({ data: HEALTH_QUERY }).toString(),
      signal: controller.signal,
    });

    const text = await response.text();
    let validJson = false;

    try {
      const parsed: unknown = JSON.parse(text);
      validJson =
        typeof parsed === 'object' &&
        parsed !== null &&
        Array.isArray((parsed as { elements?: unknown }).elements);
    } catch {
      validJson = false;
    }

    return {
      provider: endpoint,
      healthy: response.ok && validJson,
      status: response.status,
      durationMs: Date.now() - startedAt,
      message: response.ok && validJson ? undefined : 'Invalid or unsuccessful response',
    };
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'AbortError';
    return {
      provider: endpoint,
      healthy: false,
      durationMs: Date.now() - startedAt,
      message: timedOut ? 'Timeout' : error instanceof Error ? error.message : 'Network error',
    };
  } finally {
    clearTimeout(timer);
  }
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET') {
    return res.status(405).json({
      success: false,
      error: 'Method not allowed.',
    });
  }

  const providers = [];
  for (const endpoint of OVERPASS_ENDPOINTS) {
    providers.push(await checkProvider(endpoint));
  }

  const success = providers.some((provider) => provider.healthy);
  return res.status(success ? 200 : 503).json({ success, providers });
}


===== vercel.json =====
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "functions": {
    "api/fetch-facilities.ts": {
      "maxDuration": 60
    },
    "api/overpass-health.ts": {
      "maxDuration": 30
    },
    "api/generate-isochrones.ts": {
      "maxDuration": 30
    },
    "api/compute-matrix.ts": {
      "maxDuration": 30
    }
  },
  "rewrites": [
    {
      "source": "/((?!api/).*)",
      "destination": "/index.html"
    }
  ]
}


===== src/types/health.ts =====
import type { Feature, FeatureCollection } from 'geojson';

export type TransportProfile = 'driving-car' | 'cycling-regular' | 'foot-walking';
export type AnalysisType = 'time' | 'distance';

export type FacilityType =
  | 'hospital'
  | 'clinic'
  | 'pharmacy'
  | 'doctors'
  | 'dentist'
  | 'laboratory'
  | 'healthcare';

export type FacilitySource = 'OpenStreetMap' | 'Uploaded';
export type OsmObjectType = 'node' | 'way' | 'relation';
export type FacilityStatus = 'success' | 'empty' | 'unavailable';

export type ProviderOutcome =
  | 'success'
  | 'timeout'
  | 'network_error'
  | 'http_error'
  | 'invalid_json'
  | 'invalid_response';

export interface ProviderAttempt {
  provider: string;
  status?: number;
  durationMs: number;
  outcome: ProviderOutcome;
  message?: string;
}

export interface Facility {
  id: string;

  source: FacilitySource;
  sourceDataset?: string;

  osmType?: OsmObjectType;
  osmId?: number | string;

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

  travelDistanceMeters?: number;
  travelDurationSeconds?: number;

  minimumBandValue?: number;
  minimumBandLabel?: string;
  minimumBandIndex?: number;

  insideOutermostIsochrone: boolean;
  matrixEvaluated: boolean;
}

export interface TravelBand {
  index: number;
  value: number;
  unit: 'seconds' | 'metres';
  label: string;
  feature: Feature;
}

export interface FacilityDataQuality {
  total: number;
  withName: number;
  withoutName: number;
  withOperator: number;
  withOpeningHours: number;
  withEmergencyTag: number;
  withSpeciality: number;
  osmNodes: number;
  osmWays: number;
  osmRelations: number;
  uploadedFacilities: number;
  possibleDuplicates: number;
}

export interface MatrixCoverage {
  totalReachableFacilities: number;
  evaluatedFacilities: number;
  complete: boolean;
}

export interface AnalysisResult {
  analysisId: string;
  analysisDate: string;

  origin: {
    lat: number;
    lon: number;
    label?: string;
  };

  isochrones: FeatureCollection;
  bands: TravelBand[];

  facilities: Facility[];
  nearbyFacilities: Facility[];

  nearestFacility: Facility | null;
  nearestByType: Partial<Record<FacilityType, Facility>>;

  profileUsed: TransportProfile;
  analysisTypeUsed: AnalysisType;
  rangesUsed: number[];

  facilitySourceMode: 'osm' | 'uploaded' | 'combined';
  facilityStatus: FacilityStatus;
  facilityQueryRadiusMeters: number;
  facilityResultTruncated: boolean;
  facilityProvider?: string;
  facilityRequestId?: string;
  facilityAttempts: ProviderAttempt[];
  facilityErrorMessage?: string;

  matrixAvailable: boolean;
  matrixCoverage: MatrixCoverage;

  dataQuality: FacilityDataQuality;

  cumulativeCountsByBand: Record<string, number>;
  incrementalCountsByBand: Record<string, number>;

  warnings: string[];
}

export type AnalysisErrorCode =
  | 'INVALID_INPUT'
  | 'ISOCHRONE_UNAVAILABLE'
  | 'FACILITY_PROVIDER_UNAVAILABLE'
  | 'NO_FACILITIES_FOUND'
  | 'NO_FACILITIES_REACHABLE'
  | 'MATRIX_UNAVAILABLE'
  | 'PARTIAL_MATRIX_COVERAGE'
  | 'ANALYSIS_TOO_LARGE'
  | 'RATE_LIMITED'
  | 'CANCELLED'
  | 'UNKNOWN';

export interface AppState {
  center: [number, number];
  zoom: number;
  transportProfile: TransportProfile;
  analysisPoint: [number, number] | null;
  originLabel: string;
  analysisType: AnalysisType;
  timeThresholds: number[];
  distanceThresholds: number[];
  activeTab: string;
  isAnalyzing: boolean;
  analysisError: string | null;
  showFacilities: boolean;
  showIsochrones: boolean;
}


===== src/lib/api.ts =====
import type { Facility, ProviderAttempt } from '@/types/health';

type SuccessEnvelope<T> = {
  success: true;
  data: T;
};

type ErrorEnvelope = {
  success: false;
  error: string;
  code?: string;
  requestId?: string;
  attempts?: ProviderAttempt[];
};

type Envelope<T> = SuccessEnvelope<T> | ErrorEnvelope;

export class ApiError extends Error {
  status?: number;
  code?: string;
  requestId?: string;
  attempts?: ProviderAttempt[];

  constructor(
    message: string,
    options?: {
      status?: number;
      code?: string;
      requestId?: string;
      attempts?: ProviderAttempt[];
    },
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = options?.status;
    this.code = options?.code;
    this.requestId = options?.requestId;
    this.attempts = options?.attempts;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isProviderAttempt(value: unknown): value is ProviderAttempt {
  if (!isRecord(value)) return false;
  return (
    typeof value.provider === 'string' &&
    typeof value.durationMs === 'number' &&
    typeof value.outcome === 'string'
  );
}

function parseErrorEnvelope(value: unknown): ErrorEnvelope | null {
  if (!isRecord(value) || value.success !== false || typeof value.error !== 'string') {
    return null;
  }

  const attempts = Array.isArray(value.attempts)
    ? value.attempts.filter(isProviderAttempt)
    : undefined;

  return {
    success: false,
    error: value.error,
    code: typeof value.code === 'string' ? value.code : undefined,
    requestId: typeof value.requestId === 'string' ? value.requestId : undefined,
    attempts,
  };
}

export async function postJson<T>(
  path: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<T> {
  let response: Response;

  try {
    response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new ApiError('Request cancelled.', { code: 'CANCELLED' });
    }

    throw new ApiError(`Network error while calling ${path}`, {
      code: 'NETWORK',
    });
  }

  const rawText = await response.text();
  let payload: unknown = null;

  if (rawText) {
    try {
      payload = JSON.parse(rawText);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const errorPayload = parseErrorEnvelope(payload);
    throw new ApiError(
      errorPayload?.error || `Request failed (${response.status})`,
      {
        status: response.status,
        code: errorPayload?.code,
        requestId: errorPayload?.requestId,
        attempts: errorPayload?.attempts,
      },
    );
  }

  if (!isRecord(payload) || payload.success !== true || !('data' in payload)) {
    const errorPayload = parseErrorEnvelope(payload);
    throw new ApiError(
      errorPayload?.error || 'The server returned an unexpected response.',
      {
        status: response.status,
        code: errorPayload?.code || 'INVALID_RESPONSE',
        requestId: errorPayload?.requestId,
        attempts: errorPayload?.attempts,
      },
    );
  }

  return payload.data as T;
}

export interface FacilityFetchResult {
  facilities: Facility[];
  radiusUsed: number;
  source: 'OpenStreetMap Overpass';
  provider: string;
  truncated: boolean;
  rawElementCount: number;
  normalizedCount: number;
  possibleDuplicateCount: number;
  requestId: string;
  attempts: ProviderAttempt[];
}

type FacilityApiRecord = Omit<
  Facility,
  'insideOutermostIsochrone' | 'matrixEvaluated'
>;

function isFacilityApiRecord(value: unknown): value is FacilityApiRecord {
  if (!isRecord(value)) return false;

  return (
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.type === 'string' &&
    typeof value.lat === 'number' &&
    Number.isFinite(value.lat) &&
    typeof value.lon === 'number' &&
    Number.isFinite(value.lon) &&
    typeof value.straightLineDistanceMeters === 'number' &&
    Number.isFinite(value.straightLineDistanceMeters) &&
    isRecord(value.tags)
  );
}

interface RawFacilityFetchResult {
  facilities: unknown;
  radiusUsed: number;
  source: 'OpenStreetMap Overpass';
  provider: string;
  truncated: boolean;
  rawElementCount: number;
  normalizedCount: number;
  possibleDuplicateCount: number;
  requestId: string;
  attempts: ProviderAttempt[];
}

export async function fetchFacilities(
  lat: number,
  lon: number,
  radius: number,
  signal?: AbortSignal,
): Promise<FacilityFetchResult> {
  const data = await postJson<RawFacilityFetchResult>(
    '/api/fetch-facilities',
    { lat, lon, radius },
    signal,
  );

  if (!Array.isArray(data.facilities)) {
    throw new ApiError('Facility service returned an invalid facilities list.', {
      code: 'INVALID_RESPONSE',
    });
  }

  const facilities = data.facilities
    .filter(isFacilityApiRecord)
    .map<Facility>((facility) => ({
      ...facility,
      insideOutermostIsochrone: false,
      matrixEvaluated: false,
    }));

  if (facilities.length !== data.facilities.length) {
    console.warn(
      `Discarded ${data.facilities.length - facilities.length} invalid facility records.`,
    );
  }

  return {
    ...data,
    facilities,
    attempts: Array.isArray(data.attempts)
      ? data.attempts.filter(isProviderAttempt)
      : [],
  };
}


===== src/context/AppContext.tsx =====
import { createContext, useContext, useReducer, type ReactNode } from 'react';
import type {
  AppState,
  Facility,
  AnalysisResult,
  TransportProfile,
  AnalysisType,
} from '@/types/health';

interface State extends AppState {
  facilities: Facility[];
  analysisResult: AnalysisResult | null;
}

type Action =
  | { type: 'SET_CENTER'; payload: [number, number] }
  | { type: 'SET_ZOOM'; payload: number }
  | { type: 'SET_TRANSPORT'; payload: TransportProfile }
  | { type: 'SET_ANALYSIS_POINT'; payload: [number, number] | null }
  | { type: 'SET_ORIGIN_LABEL'; payload: string }
  | { type: 'SET_ANALYSIS_TYPE'; payload: AnalysisType }
  | { type: 'SET_THRESHOLDS'; payload: number[] }
  | { type: 'SET_DISTANCE_THRESHOLDS'; payload: number[] }
  | { type: 'SET_FACILITIES'; payload: Facility[] }
  | { type: 'SET_ANALYSIS_RESULT'; payload: AnalysisResult | null }
  | { type: 'SET_ANALYZING'; payload: boolean }
  | { type: 'SET_ANALYSIS_ERROR'; payload: string | null }
  | { type: 'SET_ACTIVE_TAB'; payload: string }
  | {
      type: 'TOGGLE_LAYER';
      payload: keyof Pick<AppState, 'showFacilities' | 'showIsochrones'>;
    }
  | { type: 'RESET_ANALYSIS' };

const initialState: State = {
  center: [23.8103, 90.4125],
  zoom: 12,
  transportProfile: 'foot-walking',
  analysisPoint: null,
  originLabel: '',
  analysisType: 'time',
  timeThresholds: [600, 1200, 1800, 2400, 3000, 3600],
  distanceThresholds: [1000, 2000, 3000, 4000, 5000, 6000],
  activeTab: 'settings',
  isAnalyzing: false,
  analysisError: null,
  showFacilities: true,
  showIsochrones: true,
  facilities: [],
  analysisResult: null,
};

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'SET_CENTER':
      return { ...state, center: action.payload };

    case 'SET_ZOOM':
      return { ...state, zoom: action.payload };

    case 'SET_TRANSPORT':
      return { ...state, transportProfile: action.payload };

    case 'SET_ANALYSIS_POINT':
      return { ...state, analysisPoint: action.payload };

    case 'SET_ORIGIN_LABEL':
      return { ...state, originLabel: action.payload };

    case 'SET_ANALYSIS_TYPE':
      return { ...state, analysisType: action.payload };

    case 'SET_THRESHOLDS':
      return { ...state, timeThresholds: action.payload };

    case 'SET_DISTANCE_THRESHOLDS':
      return { ...state, distanceThresholds: action.payload };

    case 'SET_FACILITIES':
      return { ...state, facilities: action.payload };

    case 'SET_ANALYSIS_RESULT':
      return { ...state, analysisResult: action.payload };

    case 'SET_ANALYZING':
      return { ...state, isAnalyzing: action.payload };

    case 'SET_ANALYSIS_ERROR':
      return { ...state, analysisError: action.payload };

    case 'SET_ACTIVE_TAB':
      return { ...state, activeTab: action.payload };

    case 'TOGGLE_LAYER':
      return { ...state, [action.payload]: !state[action.payload] };

    case 'RESET_ANALYSIS':
      return {
        ...state,
        analysisPoint: null,
        originLabel: '',
        analysisResult: null,
        facilities: [],
        analysisError: null,
      };

    default:
      return state;
  }
}

const AppContext = createContext<{
  state: State;
  dispatch: React.Dispatch<Action>;
} | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  return <AppContext.Provider value={{ state, dispatch }}>{children}</AppContext.Provider>;
}

export function useAppState() {
  const context = useContext(AppContext);
  if (!context) throw new Error('useAppState must be used within AppProvider');
  return context;
}


===== src/components/AnalysisSettings.tsx =====
import { useAppState } from '@/context/AppContext';
import { useAnalysis } from '@/hooks/useAnalysis';
import { Footprints, Car, Bike, Play, Loader2, Clock, Ruler } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { TransportProfile, AnalysisType } from '@/types/health';

const transportModes: Array<{
  id: TransportProfile;
  icon: typeof Car;
  label: string;
}> = [
  { id: 'foot-walking', icon: Footprints, label: 'Walking' },
  { id: 'cycling-regular', icon: Bike, label: 'Cycling' },
  { id: 'driving-car', icon: Car, label: 'Driving' },
];

const TIME_OPTIONS = [10, 20, 30, 40, 50, 60];
const DISTANCE_OPTIONS = [1, 2, 3, 4, 5, 6];

export function AnalysisSettings() {
  const { state, dispatch } = useAppState();

  return (
    <div className="space-y-4 p-3">
      <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
        Analysis Settings
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-medium text-foreground">Transport Mode</label>
        <div className="flex gap-1 bg-secondary rounded-lg p-1">
          {transportModes.map(({ id, icon: Icon, label }) => (
            <button
              key={id}
              type="button"
              onClick={() => dispatch({ type: 'SET_TRANSPORT', payload: id })}
              className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-2 rounded-md text-xs font-medium transition-colors ${
                state.transportProfile === id
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-medium text-foreground">Analysis Type</label>
        <div className="flex gap-1 bg-secondary rounded-lg p-1">
          {([
            { id: 'time' as AnalysisType, icon: Clock, label: 'Time' },
            { id: 'distance' as AnalysisType, icon: Ruler, label: 'Distance' },
          ]).map(({ id, icon: Icon, label }) => (
            <button
              key={id}
              type="button"
              onClick={() => dispatch({ type: 'SET_ANALYSIS_TYPE', payload: id })}
              className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-2 rounded-md text-xs font-medium transition-colors ${
                state.analysisType === id
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-medium text-foreground">
          Range Bands ({state.analysisType === 'time' ? 'minutes' : 'km'})
        </label>
        <div className="flex flex-wrap gap-1.5">
          {(state.analysisType === 'time' ? TIME_OPTIONS : DISTANCE_OPTIONS).map((value) => {
            const targetValue =
              state.analysisType === 'time' ? value * 60 : value * 1000;
            const thresholds =
              state.analysisType === 'time'
                ? state.timeThresholds
                : state.distanceThresholds;
            const isActive = thresholds.includes(targetValue);

            return (
              <button
                key={value}
                type="button"
                onClick={() => {
                  const actionType =
                    state.analysisType === 'time'
                      ? 'SET_THRESHOLDS'
                      : 'SET_DISTANCE_THRESHOLDS';

                  if (isActive) {
                    const next = thresholds.filter((threshold) => threshold !== targetValue);
                    if (next.length > 0) {
                      dispatch({ type: actionType, payload: next });
                    }
                    return;
                  }

                  dispatch({
                    type: actionType,
                    payload: [...thresholds, targetValue].sort((a, b) => a - b),
                  });
                }}
                className={`px-2.5 py-1.5 rounded-md text-xs font-medium border transition-colors ${
                  isActive
                    ? 'bg-primary/10 text-primary border-primary/30'
                    : 'bg-secondary text-muted-foreground border-border hover:text-foreground'
                }`}
              >
                {value} {state.analysisType === 'time' ? 'min' : 'km'}
              </button>
            );
          })}
        </div>
      </div>

      {state.analysisPoint ? (
        <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-primary/5 border border-primary/15">
          <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
          <span className="text-[11px] font-medium text-primary">Selected location</span>
        </div>
      ) : (
        <p className="text-[10px] text-muted-foreground text-center">
          Click the map or search for a place to begin.
        </p>
      )}
    </div>
  );
}

export function StickyAnalyzeButton() {
  const { state } = useAppState();
  const { runAnalysis } = useAnalysis();

  const handleAnalyze = () => {
    const point = state.analysisPoint ?? state.center;
    void runAnalysis(point[0], point[1]);
  };

  return (
    <div className="sticky bottom-0 p-3 bg-card/95 backdrop-blur-sm border-t border-border">
      <Button
        onClick={handleAnalyze}
        disabled={state.isAnalyzing}
        className="w-full gap-2"
        size="sm"
      >
        {state.isAnalyzing ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <Play className="w-4 h-4" />
        )}
        {state.isAnalyzing ? 'Analyzing accessibility…' : 'Analyze Accessibility'}
      </Button>
    </div>
  );
}


===== src/hooks/useAnalysis.ts =====
import { useCallback } from 'react';
import { toast } from 'sonner';
import { useAppState } from '@/context/AppContext';
import { ApiError, fetchFacilities } from '@/lib/api';
import { getRoutingProvider, type RoutingProvider } from '@/services/routing';
import type {
  AnalysisResult,
  Facility,
  FacilityDataQuality,
  FacilityStatus,
  FacilityType,
  MatrixCoverage,
  ProviderAttempt,
  TransportProfile,
  TravelBand,
} from '@/types/health';
import {
  classifyFacilityIntoMinimumBand,
  getMaximumGeometryRadiusMeters,
  getOutermostIsochroneFeature,
  pointInGeometry,
  sortIsochroneBands,
} from '@/lib/geo';

const MAX_MATRIX_FACILITIES = 250;
const MATRIX_CHUNK_SIZE = 25;
const MATRIX_CONCURRENCY = 2;

interface FacilityStageResult {
  facilityStatus: FacilityStatus;
  nearbyFacilities: Facility[];
  facilities: Facility[];
  nearestFacility: Facility | null;
  nearestByType: Partial<Record<FacilityType, Facility>>;
  facilityResultTruncated: boolean;
  facilityProvider?: string;
  facilityRequestId?: string;
  facilityAttempts: ProviderAttempt[];
  facilityErrorMessage?: string;
  matrixAvailable: boolean;
  matrixCoverage: MatrixCoverage;
  dataQuality: FacilityDataQuality;
  cumulativeCountsByBand: Record<string, number>;
  incrementalCountsByBand: Record<string, number>;
  warnings: string[];
}

interface MatrixChunkResult {
  batch: Facility[];
  durations?: Array<number | null>;
  distances?: Array<number | null>;
  error?: unknown;
}

function generateAnalysisId(): string {
  const identifier =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : String(Date.now());
  return `an_${identifier}`;
}

function computeSearchRadiusMeters(
  originLat: number,
  originLon: number,
  geometry: GeoJSON.Geometry,
): number {
  const rawRadius =
    getMaximumGeometryRadiusMeters(originLat, originLon, geometry) + 1000;
  const roundedRadius = Math.ceil(rawRadius / 100) * 100;
  return Math.max(1000, roundedRadius);
}

function chunk<T>(items: T[], size: number): T[][] {
  const output: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    output.push(items.slice(index, index + size));
  }
  return output;
}

async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (!items.length) return [];

  const results = new Array<R>(items.length);
  let cursor = 0;

  const runners = new Array(Math.min(concurrency, items.length))
    .fill(0)
    .map(async () => {
      while (true) {
        const index = cursor;
        cursor += 1;
        if (index >= items.length) return;
        results[index] = await worker(items[index], index);
      }
    });

  await Promise.all(runners);
  return results;
}

function createEmptyDataQuality(
  possibleDuplicates = 0,
): FacilityDataQuality {
  return {
    total: 0,
    withName: 0,
    withoutName: 0,
    withOperator: 0,
    withOpeningHours: 0,
    withEmergencyTag: 0,
    withSpeciality: 0,
    osmNodes: 0,
    osmWays: 0,
    osmRelations: 0,
    uploadedFacilities: 0,
    possibleDuplicates,
  };
}

function computeDataQuality(
  facilities: Facility[],
  possibleDuplicates: number,
): FacilityDataQuality {
  const quality = createEmptyDataQuality(possibleDuplicates);
  quality.total = facilities.length;

  for (const facility of facilities) {
    const hasMappedName =
      Boolean(facility.tags?.name) || Boolean(facility.tags?.['name:en']);

    if (hasMappedName) quality.withName += 1;
    else quality.withoutName += 1;

    if (facility.operator) quality.withOperator += 1;
    if (facility.openingHours) quality.withOpeningHours += 1;
    if (facility.emergency) quality.withEmergencyTag += 1;
    if (facility.speciality) quality.withSpeciality += 1;

    if (facility.source === 'Uploaded') {
      quality.uploadedFacilities += 1;
    } else if (facility.osmType === 'node') {
      quality.osmNodes += 1;
    } else if (facility.osmType === 'way') {
      quality.osmWays += 1;
    } else if (facility.osmType === 'relation') {
      quality.osmRelations += 1;
    }
  }

  return quality;
}

function computeBandCounts(
  bands: Array<Pick<TravelBand, 'index' | 'label'>>,
  facilities: Facility[],
) {
  const incremental: Record<string, number> = {};
  const cumulative: Record<string, number> = {};

  for (const band of bands) {
    incremental[band.label] = 0;
    cumulative[band.label] = 0;
  }

  for (const facility of facilities) {
    if (facility.minimumBandIndex == null) continue;

    const ownBand = bands[facility.minimumBandIndex];
    if (ownBand) {
      incremental[ownBand.label] = (incremental[ownBand.label] || 0) + 1;
    }

    for (
      let index = facility.minimumBandIndex;
      index < bands.length;
      index += 1
    ) {
      const band = bands[index];
      cumulative[band.label] = (cumulative[band.label] || 0) + 1;
    }
  }

  return { incremental, cumulative };
}

function pickNearestByType(
  facilities: Facility[],
): Partial<Record<FacilityType, Facility>> {
  const result: Partial<Record<FacilityType, Facility>> = {};
  const types: FacilityType[] = [
    'hospital',
    'clinic',
    'pharmacy',
    'doctors',
    'dentist',
    'laboratory',
    'healthcare',
  ];

  for (const type of types) {
    const candidates = facilities.filter((facility) => facility.type === type);
    if (!candidates.length) continue;

    candidates.sort((a, b) => {
      const aDuration =
        a.matrixEvaluated && a.travelDurationSeconds != null
          ? a.travelDurationSeconds
          : Number.POSITIVE_INFINITY;
      const bDuration =
        b.matrixEvaluated && b.travelDurationSeconds != null
          ? b.travelDurationSeconds
          : Number.POSITIVE_INFINITY;

      if (aDuration !== bDuration) return aDuration - bDuration;
      return a.straightLineDistanceMeters - b.straightLineDistanceMeters;
    });

    result[type] = candidates[0];
  }

  return result;
}

function pickOverallNearest(facilities: Facility[]): Facility | null {
  const routed = facilities.filter(
    (facility) =>
      facility.matrixEvaluated && facility.travelDurationSeconds != null,
  );

  if (routed.length) {
    return routed.reduce((nearest, facility) =>
      (facility.travelDurationSeconds ?? Number.POSITIVE_INFINITY) <
      (nearest.travelDurationSeconds ?? Number.POSITIVE_INFINITY)
        ? facility
        : nearest,
    );
  }

  if (!facilities.length) return null;

  return facilities.reduce((nearest, facility) =>
    facility.straightLineDistanceMeters < nearest.straightLineDistanceMeters
      ? facility
      : nearest,
  );
}

function facilityUnavailableMessage(error: unknown): string {
  if (error instanceof ApiError && error.status === 429) {
    return 'The OpenStreetMap facility service is rate-limited. Please try again shortly.';
  }
  return 'The OpenStreetMap facility service is temporarily unavailable. The travel area was generated, but OSM facilities could not be loaded.';
}

async function enrichWithMatrix(
  provider: RoutingProvider,
  origin: { lat: number; lon: number },
  profile: TransportProfile,
  reachableFacilities: Facility[],
): Promise<{
  facilities: Facility[];
  matrixAvailable: boolean;
  matrixCoverage: MatrixCoverage;
  warnings: string[];
}> {
  if (!reachableFacilities.length) {
    return {
      facilities: [],
      matrixAvailable: false,
      matrixCoverage: {
        totalReachableFacilities: 0,
        evaluatedFacilities: 0,
        complete: true,
      },
      warnings: [],
    };
  }

  const matrixCandidates = reachableFacilities
    .slice()
    .sort(
      (a, b) =>
        a.straightLineDistanceMeters - b.straightLineDistanceMeters,
    )
    .slice(0, MAX_MATRIX_FACILITIES);

  const groups = chunk(matrixCandidates, MATRIX_CHUNK_SIZE);
  const chunkResults = await runWithConcurrency(
    groups,
    MATRIX_CONCURRENCY,
    async (batch): Promise<MatrixChunkResult> => {
      try {
        const response = await provider.computeMatrix({
          origins: [origin],
          destinations: batch.map((facility) => ({
            lat: facility.lat,
            lon: facility.lon,
          })),
          profile,
        });

        return {
          batch,
          durations: response.durations[0] || [],
          distances: response.distances[0] || [],
        };
      } catch (error) {
        return { batch, error };
      }
    },
  );

  const matrixMap = new Map<
    string,
    { durationSeconds: number | null; distanceMeters: number | null }
  >();

  let successfulFacilities = 0;
  let failedChunks = 0;

  for (const result of chunkResults) {
    if (result.error || !result.durations || !result.distances) {
      failedChunks += 1;
      continue;
    }

    result.batch.forEach((facility, index) => {
      const duration = result.durations?.[index];
      const distance = result.distances?.[index];

      matrixMap.set(facility.id, {
        durationSeconds:
          typeof duration === 'number' && Number.isFinite(duration)
            ? duration
            : null,
        distanceMeters:
          typeof distance === 'number' && Number.isFinite(distance)
            ? distance
            : null,
      });
      successfulFacilities += 1;
    });
  }

  const matrixAvailable = successfulFacilities > 0;
  const warnings: string[] = [];

  if (!matrixAvailable) {
    warnings.push(
      'Facilities were loaded, but road-network travel times are temporarily unavailable.',
    );
  } else if (failedChunks > 0) {
    warnings.push(
      `Some road-network matrix requests failed. Metrics are available for ${successfulFacilities} of ${reachableFacilities.length} reachable facilities.`,
    );
  }

  if (matrixCandidates.length < reachableFacilities.length) {
    warnings.push(
      `Road-network metrics were limited to the ${matrixCandidates.length} nearest facilities by straight-line distance.`,
    );
  }

  const enriched = reachableFacilities.map((facility) => {
    const matrixValue = matrixMap.get(facility.id);
    if (!matrixValue) {
      return { ...facility, matrixEvaluated: false };
    }

    return {
      ...facility,
      matrixEvaluated: true,
      travelDurationSeconds: matrixValue.durationSeconds ?? undefined,
      travelDistanceMeters: matrixValue.distanceMeters ?? undefined,
    };
  });

  return {
    facilities: enriched,
    matrixAvailable,
    matrixCoverage: {
      totalReachableFacilities: reachableFacilities.length,
      evaluatedFacilities: successfulFacilities,
      complete:
        successfulFacilities === reachableFacilities.length && failedChunks === 0,
    },
    warnings,
  };
}

async function runFacilityStage(params: {
  provider: RoutingProvider;
  lat: number;
  lon: number;
  radius: number;
  bands: TravelBand[];
  outerGeometry: GeoJSON.Geometry;
  profile: TransportProfile;
}): Promise<FacilityStageResult> {
  const {
    provider,
    lat,
    lon,
    radius,
    bands,
    outerGeometry,
    profile,
  } = params;

  let facilityResponse;

  try {
    facilityResponse = await fetchFacilities(lat, lon, radius);
  } catch (error) {
    const message = facilityUnavailableMessage(error);
    const apiError = error instanceof ApiError ? error : null;

    console.warn('Facility retrieval failed', {
      message: error instanceof Error ? error.message : String(error),
      code: apiError?.code,
      requestId: apiError?.requestId,
      attempts: apiError?.attempts,
    });

    return {
      facilityStatus: 'unavailable',
      nearbyFacilities: [],
      facilities: [],
      nearestFacility: null,
      nearestByType: {},
      facilityResultTruncated: false,
      facilityRequestId: apiError?.requestId,
      facilityAttempts: apiError?.attempts || [],
      facilityErrorMessage: message,
      matrixAvailable: false,
      matrixCoverage: {
        totalReachableFacilities: 0,
        evaluatedFacilities: 0,
        complete: false,
      },
      dataQuality: createEmptyDataQuality(),
      cumulativeCountsByBand: Object.fromEntries(
        bands.map((band) => [band.label, 0]),
      ),
      incrementalCountsByBand: Object.fromEntries(
        bands.map((band) => [band.label, 0]),
      ),
      warnings: [message],
    };
  }

  const nearbyFacilities = facilityResponse.facilities.map((facility) => {
    const classification = classifyFacilityIntoMinimumBand(facility, bands);
    const insideOutermostIsochrone = pointInGeometry(
      [facility.lon, facility.lat],
      outerGeometry,
    );

    return {
      ...facility,
      ...classification,
      insideOutermostIsochrone,
      matrixEvaluated: false,
    };
  });

  const reachableFacilities = nearbyFacilities.filter(
    (facility) => facility.insideOutermostIsochrone,
  );

  const matrixResult = await enrichWithMatrix(
    provider,
    { lat, lon },
    profile,
    reachableFacilities,
  );

  const nearestFacility = pickOverallNearest(matrixResult.facilities);
  const nearestByType = pickNearestByType(matrixResult.facilities);
  const { incremental, cumulative } = computeBandCounts(
    bands,
    matrixResult.facilities,
  );

  const warnings = [...matrixResult.warnings];
  if (facilityResponse.truncated) {
    warnings.unshift(
      `Facility results were truncated to ${facilityResponse.facilities.length} nearest records.`,
    );
  }

  return {
    facilityStatus: nearbyFacilities.length ? 'success' : 'empty',
    nearbyFacilities,
    facilities: matrixResult.facilities,
    nearestFacility,
    nearestByType,
    facilityResultTruncated: facilityResponse.truncated,
    facilityProvider: facilityResponse.provider,
    facilityRequestId: facilityResponse.requestId,
    facilityAttempts: facilityResponse.attempts,
    matrixAvailable: matrixResult.matrixAvailable,
    matrixCoverage: matrixResult.matrixCoverage,
    dataQuality: computeDataQuality(
      nearbyFacilities,
      facilityResponse.possibleDuplicateCount,
    ),
    cumulativeCountsByBand: cumulative,
    incrementalCountsByBand: incremental,
    warnings,
  };
}

function showFacilityOutcome(result: FacilityStageResult): void {
  if (result.facilityStatus === 'unavailable') {
    toast.warning(
      'Facility service is temporarily unavailable — showing the travel area only.',
    );
    return;
  }

  if (result.facilityStatus === 'empty') {
    toast.warning(
      'No mapped healthcare facilities were found in OpenStreetMap within the facility-search extent.',
    );
    return;
  }

  if (!result.facilities.length) {
    toast.warning(
      'Healthcare facilities were found near the selected location, but none fall inside the selected travel area.',
    );
    return;
  }

  toast.success(
    `Found ${result.facilities.length} healthcare facilities within the selected travel area.`,
  );

  if (!result.matrixAvailable) {
    toast.warning('Road-network travel times are temporarily unavailable.');
  }
}

export function useAnalysis() {
  const { state, dispatch } = useAppState();

  const runAnalysis = useCallback(
    async (lat: number, lon: number) => {
      if (
        !Number.isFinite(lat) ||
        lat < -90 ||
        lat > 90 ||
        !Number.isFinite(lon) ||
        lon < -180 ||
        lon > 180
      ) {
        toast.error('Please choose a valid location before running the analysis.');
        return;
      }

      const analysisType = state.analysisType;
      const profile: TransportProfile = state.transportProfile;
      const rawRanges =
        analysisType === 'distance'
          ? state.distanceThresholds
          : state.timeThresholds;
      const ranges = Array.from(
        new Set(rawRanges.filter((value) => Number.isFinite(value) && value > 0)),
      ).sort((a, b) => a - b);

      if (!ranges.length) {
        toast.error('Select at least one travel range.');
        return;
      }

      dispatch({ type: 'SET_ANALYSIS_POINT', payload: [lat, lon] });
      dispatch({ type: 'SET_ANALYZING', payload: true });
      dispatch({ type: 'SET_ANALYSIS_ERROR', payload: null });
      dispatch({ type: 'SET_ANALYSIS_RESULT', payload: null });
      dispatch({ type: 'SET_FACILITIES', payload: [] });

      const provider = getRoutingProvider();

      try {
        const isochrones = await provider.generateIsochrones({
          origin: { lat, lon },
          profile,
          rangeType: analysisType,
          ranges,
        });

        const bands = sortIsochroneBands(isochrones, analysisType);
        const outerFeature = getOutermostIsochroneFeature(isochrones);

        if (!bands.length || !outerFeature?.geometry) {
          throw new ApiError(
            'The travel-area service returned no usable polygons.',
            { code: 'ISOCHRONE_UNAVAILABLE' },
          );
        }

        const radius = computeSearchRadiusMeters(
          lat,
          lon,
          outerFeature.geometry,
        );

        if (radius > 50_000) {
          throw new ApiError(
            'The selected travel range creates an area larger than the supported facility-search extent. Reduce the time or distance range.',
            { code: 'ANALYSIS_TOO_LARGE' },
          );
        }

        const facilityStage = await runFacilityStage({
          provider,
          lat,
          lon,
          radius,
          bands,
          outerGeometry: outerFeature.geometry,
          profile,
        });

        const result: AnalysisResult = {
          analysisId: generateAnalysisId(),
          analysisDate: new Date().toISOString(),
          origin: {
            lat,
            lon,
            label: state.originLabel || undefined,
          },
          isochrones,
          bands,
          facilities: facilityStage.facilities,
          nearbyFacilities: facilityStage.nearbyFacilities,
          nearestFacility: facilityStage.nearestFacility,
          nearestByType: facilityStage.nearestByType,
          profileUsed: profile,
          analysisTypeUsed: analysisType,
          rangesUsed: ranges,
          facilitySourceMode: 'osm',
          facilityStatus: facilityStage.facilityStatus,
          facilityQueryRadiusMeters: radius,
          facilityResultTruncated: facilityStage.facilityResultTruncated,
          facilityProvider: facilityStage.facilityProvider,
          facilityRequestId: facilityStage.facilityRequestId,
          facilityAttempts: facilityStage.facilityAttempts,
          facilityErrorMessage: facilityStage.facilityErrorMessage,
          matrixAvailable: facilityStage.matrixAvailable,
          matrixCoverage: facilityStage.matrixCoverage,
          dataQuality: facilityStage.dataQuality,
          cumulativeCountsByBand: facilityStage.cumulativeCountsByBand,
          incrementalCountsByBand: facilityStage.incrementalCountsByBand,
          warnings: facilityStage.warnings,
        };

        dispatch({ type: 'SET_FACILITIES', payload: facilityStage.facilities });
        dispatch({ type: 'SET_ANALYSIS_RESULT', payload: result });
        showFacilityOutcome(facilityStage);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error('Analysis error:', error);
        dispatch({ type: 'SET_ANALYSIS_ERROR', payload: message });
        dispatch({ type: 'SET_ANALYSIS_RESULT', payload: null });
        dispatch({ type: 'SET_FACILITIES', payload: [] });
        toast.error(`Analysis failed: ${message}`);
      } finally {
        dispatch({ type: 'SET_ANALYZING', payload: false });
      }
    },
    [
      dispatch,
      state.analysisType,
      state.distanceThresholds,
      state.originLabel,
      state.timeThresholds,
      state.transportProfile,
    ],
  );

  const retryFacilities = useCallback(async () => {
    const current = state.analysisResult;
    if (!current) {
      toast.error('Run an analysis before retrying facilities.');
      return;
    }

    const outerFeature = getOutermostIsochroneFeature(current.isochrones);
    if (!outerFeature?.geometry) {
      toast.error('The existing analysis has no usable outer travel polygon.');
      return;
    }

    dispatch({ type: 'SET_ANALYZING', payload: true });
    dispatch({ type: 'SET_ANALYSIS_ERROR', payload: null });

    try {
      const facilityStage = await runFacilityStage({
        provider: getRoutingProvider(),
        lat: current.origin.lat,
        lon: current.origin.lon,
        radius: current.facilityQueryRadiusMeters,
        bands: current.bands,
        outerGeometry: outerFeature.geometry,
        profile: current.profileUsed,
      });

      const updated: AnalysisResult = {
        ...current,
        analysisDate: new Date().toISOString(),
        facilities: facilityStage.facilities,
        nearbyFacilities: facilityStage.nearbyFacilities,
        nearestFacility: facilityStage.nearestFacility,
        nearestByType: facilityStage.nearestByType,
        facilityStatus: facilityStage.facilityStatus,
        facilityResultTruncated: facilityStage.facilityResultTruncated,
        facilityProvider: facilityStage.facilityProvider,
        facilityRequestId: facilityStage.facilityRequestId,
        facilityAttempts: facilityStage.facilityAttempts,
        facilityErrorMessage: facilityStage.facilityErrorMessage,
        matrixAvailable: facilityStage.matrixAvailable,
        matrixCoverage: facilityStage.matrixCoverage,
        dataQuality: facilityStage.dataQuality,
        cumulativeCountsByBand: facilityStage.cumulativeCountsByBand,
        incrementalCountsByBand: facilityStage.incrementalCountsByBand,
        warnings: facilityStage.warnings,
      };

      dispatch({ type: 'SET_FACILITIES', payload: facilityStage.facilities });
      dispatch({ type: 'SET_ANALYSIS_RESULT', payload: updated });
      showFacilityOutcome(facilityStage);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('Facility retry failed:', error);
      dispatch({ type: 'SET_ANALYSIS_ERROR', payload: message });
      toast.error(`Facility retry failed: ${message}`);
    } finally {
      dispatch({ type: 'SET_ANALYZING', payload: false });
    }
  }, [dispatch, state.analysisResult]);

  return { runAnalysis, retryFacilities };
}


===== src/components/panels/SummaryTab.tsx =====
import {
  AlertTriangle,
  Building2,
  Clock,
  Info,
  MapPin,
  RefreshCw,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useAppState } from '@/context/AppContext';
import { useAnalysis } from '@/hooks/useAnalysis';
import { ROUTING_PROVIDER_LABEL } from '@/services/routing';
import type { Facility, FacilityType, TransportProfile } from '@/types/health';

function formatMeters(value?: number | null) {
  if (value == null || !Number.isFinite(value)) return null;
  return value < 1000
    ? `${Math.round(value)} m`
    : `${(value / 1000).toFixed(1)} km`;
}

function formatSeconds(value?: number | null) {
  if (value == null || !Number.isFinite(value)) return null;
  const minutes = Math.round(value / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}

const MODE_LABEL: Record<TransportProfile, string> = {
  'foot-walking': 'walking',
  'cycling-regular': 'cycling',
  'driving-car': 'driving',
};

const TYPE_LABEL: Record<FacilityType, string> = {
  hospital: 'Hospital',
  clinic: 'Clinic',
  pharmacy: 'Pharmacy',
  doctors: 'Doctor',
  dentist: 'Dentist',
  laboratory: 'Laboratory',
  healthcare: 'Healthcare',
};

function KPI({
  label,
  value,
  subtitle,
  icon: Icon,
}: {
  label: string;
  value: string | number;
  subtitle?: string;
  icon: typeof Building2;
}) {
  return (
    <div className="data-card">
      <div className="flex items-center gap-2">
        <Icon className="w-4 h-4 text-primary" />
        <span className="kpi-label">{label}</span>
      </div>
      <div className="kpi-value text-primary">{value}</div>
      {subtitle && (
        <div className="text-[10px] text-muted-foreground mt-0.5">
          {subtitle}
        </div>
      )}
    </div>
  );
}

function NearestRow({ facility, label }: { facility: Facility; label: string }) {
  const roadTime = formatSeconds(facility.travelDurationSeconds);
  const roadDistance = formatMeters(facility.travelDistanceMeters);
  const straightDistance = formatMeters(facility.straightLineDistanceMeters);

  return (
    <div className="flex items-start justify-between gap-2 py-1.5 border-b border-border/50 last:border-0">
      <div className="min-w-0">
        <div className="text-xs font-medium text-muted-foreground">{label}</div>
        <div className="text-sm font-medium truncate">{facility.name}</div>
      </div>
      <div className="text-right shrink-0 text-[11px]">
        {roadTime ? (
          <div className="font-medium">{roadTime}</div>
        ) : (
          <div className="text-muted-foreground">Road time unavailable</div>
        )}
        {roadDistance && (
          <div className="text-muted-foreground">{roadDistance} road</div>
        )}
        {straightDistance && (
          <div className="text-muted-foreground">
            {straightDistance} straight
          </div>
        )}
      </div>
    </div>
  );
}

export function SummaryTab() {
  const { state } = useAppState();
  const { retryFacilities } = useAnalysis();
  const result = state.analysisResult;
  const [showMethod, setShowMethod] = useState(false);

  const facilityTypeCounts = useMemo(() => {
    if (!result) return {} as Record<string, number>;
    return result.facilities.reduce<Record<string, number>>((counts, facility) => {
      counts[facility.type] = (counts[facility.type] || 0) + 1;
      return counts;
    }, {});
  }, [result]);

  if (!result) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center space-y-4 p-6">
        <MapPin className="w-12 h-12 text-muted-foreground/30" />
        <div>
          <h3 className="text-sm font-medium text-foreground">No analysis yet</h3>
          <p className="text-xs text-muted-foreground mt-1">
            Select a location on the map or search for a place, then click{' '}
            <strong>Analyze</strong> to see reachable healthcare facilities.
          </p>
        </div>
      </div>
    );
  }

  const modeLabel = MODE_LABEL[result.profileUsed];
  const maxRange = Math.max(...result.rangesUsed);
  const rangeText =
    result.analysisTypeUsed === 'time'
      ? `${Math.round(maxRange / 60)}-minute ${modeLabel} area`
      : `${(maxRange / 1000).toFixed(1)} km ${modeLabel} area`;

  let headline: string;
  if (result.facilityStatus === 'unavailable') {
    headline =
      'The travel area was generated, but OpenStreetMap facility data is currently unavailable.';
  } else if (result.facilityStatus === 'empty') {
    headline =
      'No mapped healthcare facilities were returned from OpenStreetMap for the facility-search extent.';
  } else if (!result.facilities.length) {
    headline =
      'Healthcare facilities were found nearby, but none fall inside the selected travel area.';
  } else {
    headline = `${result.facilities.length} healthcare facilit${
      result.facilities.length === 1 ? 'y falls' : 'ies fall'
    } within the selected ${rangeText}.`;
  }

  const distinctTypes = Object.keys(facilityTypeCounts).length;
  const nearestSeconds = result.nearestFacility?.travelDurationSeconds;
  const facilityUnavailable = result.facilityStatus === 'unavailable';

  return (
    <div className="space-y-3 p-3">
      <div
        className={`p-3 rounded-lg border ${
          facilityUnavailable
            ? 'bg-amber-500/5 border-amber-500/30'
            : 'bg-primary/5 border-primary/10'
        }`}
      >
        <p className="text-xs font-medium text-foreground leading-relaxed">
          {headline}
        </p>

        {facilityUnavailable && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="mt-2 h-7 gap-1.5 text-xs"
            disabled={state.isAnalyzing}
            onClick={() => void retryFacilities()}
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${state.isAnalyzing ? 'animate-spin' : ''}`}
            />
            Retry facilities
          </Button>
        )}

        {!facilityUnavailable &&
          result.facilities.length > 0 &&
          !result.matrixAvailable && (
            <p className="text-[11px] text-muted-foreground mt-1">
              Road-network travel time and distance are temporarily unavailable.
            </p>
          )}

        {result.matrixAvailable && !result.matrixCoverage.complete && (
          <p className="text-[11px] text-muted-foreground mt-1">
            Road-network metrics were evaluated for{' '}
            {result.matrixCoverage.evaluatedFacilities} of{' '}
            {result.matrixCoverage.totalReachableFacilities} reachable facilities.
          </p>
        )}
      </div>

      {result.warnings.length > 0 && (
        <div className="p-2.5 rounded-lg border border-amber-500/30 bg-amber-500/5 space-y-1">
          {result.warnings.map((warning, index) => (
            <div
              key={`${warning}-${index}`}
              className="flex items-start gap-2 text-[11px] text-foreground/80"
            >
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-500" />
              <span>{warning}</span>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <KPI
          icon={Building2}
          label="Reachable facilities"
          value={facilityUnavailable ? 'Unavailable' : result.facilities.length}
          subtitle={facilityUnavailable ? 'Provider request failed' : `in ${rangeText}`}
        />
        <KPI
          icon={MapPin}
          label="Nearby queried"
          value={facilityUnavailable ? 'Unavailable' : result.nearbyFacilities.length}
          subtitle={`Search radius: ${
            formatMeters(result.facilityQueryRadiusMeters) || '—'
          }`}
        />
        <KPI
          icon={Info}
          label="Distinct types"
          value={facilityUnavailable ? 'Unavailable' : distinctTypes}
        />
        <KPI
          icon={Clock}
          label="Nearest road time"
          value={facilityUnavailable ? 'Unavailable' : formatSeconds(nearestSeconds) || '—'}
          subtitle={
            facilityUnavailable
              ? 'Facility data unavailable'
              : result.facilities.length > 0 && !result.matrixAvailable
                ? 'Matrix unavailable'
                : undefined
          }
        />
      </div>

      {!facilityUnavailable && (
        <div className="data-card">
          <span className="kpi-label">Travel bands</span>
          <div className="mt-2 space-y-1">
            <div className="grid grid-cols-3 gap-2 text-[10px] font-semibold text-muted-foreground uppercase">
              <span>Band</span>
              <span className="text-right">In band</span>
              <span className="text-right">Cumulative</span>
            </div>
            {result.bands.map((band) => (
              <div key={band.index} className="grid grid-cols-3 gap-2 text-xs">
                <span>{band.label}</span>
                <span className="text-right font-medium">
                  {result.incrementalCountsByBand[band.label] ?? 0}
                </span>
                <span className="text-right text-muted-foreground">
                  {result.cumulativeCountsByBand[band.label] ?? 0}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {result.nearestFacility && (
        <div className="data-card space-y-1">
          <span className="kpi-label">Nearest facility</span>
          <NearestRow
            facility={result.nearestFacility}
            label={
              result.nearestFacility.travelDurationSeconds != null
                ? result.matrixCoverage.complete
                  ? 'Overall nearest by road time'
                  : 'Nearest by road time among evaluated facilities'
                : 'Nearest by straight-line distance'
            }
          />
        </div>
      )}

      {Object.keys(result.nearestByType).length > 0 && (
        <div className="data-card space-y-1">
          <span className="kpi-label">Nearest by type</span>
          {(Object.entries(result.nearestByType) as [FacilityType, Facility][]).map(
            ([type, facility]) => (
              <NearestRow
                key={type}
                facility={facility}
                label={TYPE_LABEL[type] || type}
              />
            ),
          )}
        </div>
      )}

      {!facilityUnavailable && (
        <div className="data-card">
          <span className="kpi-label">Data quality</span>
          <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            <div>
              Total: <span className="text-foreground">{result.dataQuality.total}</span>
            </div>
            <div>
              Named: <span className="text-foreground">{result.dataQuality.withName}</span>
            </div>
            <div>
              Unnamed:{' '}
              <span className="text-foreground">{result.dataQuality.withoutName}</span>
            </div>
            <div>
              With operator:{' '}
              <span className="text-foreground">{result.dataQuality.withOperator}</span>
            </div>
            <div>
              With hours:{' '}
              <span className="text-foreground">
                {result.dataQuality.withOpeningHours}
              </span>
            </div>
            <div>
              Emergency tag:{' '}
              <span className="text-foreground">
                {result.dataQuality.withEmergencyTag}
              </span>
            </div>
            <div>
              OSM nodes:{' '}
              <span className="text-foreground">{result.dataQuality.osmNodes}</span>
            </div>
            <div>
              OSM ways:{' '}
              <span className="text-foreground">{result.dataQuality.osmWays}</span>
            </div>
            <div>
              OSM relations:{' '}
              <span className="text-foreground">
                {result.dataQuality.osmRelations}
              </span>
            </div>
            <div>
              Possible duplicates:{' '}
              <span className="text-foreground">
                {result.dataQuality.possibleDuplicates}
              </span>
            </div>
          </div>
        </div>
      )}

      <div className="data-card">
        <button
          type="button"
          onClick={() => setShowMethod((visible) => !visible)}
          className="w-full flex items-center justify-between text-left"
          aria-expanded={showMethod}
        >
          <span className="kpi-label">Methodology and diagnostics</span>
          <span className="text-xs text-muted-foreground">
            {showMethod ? 'Hide' : 'Show'}
          </span>
        </button>

        {showMethod && (
          <div className="mt-2 space-y-1 text-[11px] text-muted-foreground break-words">
            <div>Analysis date: {new Date(result.analysisDate).toLocaleString()}</div>
            <div>
              Origin: {result.origin.lat.toFixed(5)}, {result.origin.lon.toFixed(5)}
              {result.origin.label ? ` (${result.origin.label})` : ''}
            </div>
            <div>Routing provider: {ROUTING_PROVIDER_LABEL}</div>
            <div>Transport profile: {result.profileUsed}</div>
            <div>Analysis type: {result.analysisTypeUsed}</div>
            <div>
              Ranges: {result.rangesUsed.join(', ')}{' '}
              {result.analysisTypeUsed === 'time' ? 's' : 'm'}
            </div>
            <div>Facility status: {result.facilityStatus}</div>
            <div>Facility provider: {result.facilityProvider || 'Unavailable'}</div>
            <div>Facility request ID: {result.facilityRequestId || 'Unavailable'}</div>
            <div>
              Facility query radius:{' '}
              {formatMeters(result.facilityQueryRadiusMeters) || '—'}
            </div>
            <div>
              Matrix evaluated: {result.matrixCoverage.evaluatedFacilities} of{' '}
              {result.matrixCoverage.totalReachableFacilities}
            </div>

            {result.facilityAttempts.length > 0 && (
              <div className="pt-1">
                <div className="font-medium text-foreground">Provider attempts</div>
                {result.facilityAttempts.map((attempt, index) => (
                  <div key={`${attempt.provider}-${index}`}>
                    {attempt.provider}: {attempt.outcome}
                    {attempt.status ? ` (HTTP ${attempt.status})` : ''},{' '}
                    {attempt.durationMs} ms
                    {attempt.message ? `, ${attempt.message}` : ''}
                  </div>
                ))}
              </div>
            )}

            <p className="pt-1">
              Facilities were assigned to the smallest travel-area polygon containing
              their coordinates. Road travel times and distances were calculated using{' '}
              {ROUTING_PROVIDER_LABEL} where matrix results were available. Straight-line
              distance was calculated geometrically and was not used as a substitute for
              road travel time.
            </p>
          </div>
        )}
      </div>

      <div className="text-[10px] text-muted-foreground space-y-0.5 pt-2 border-t border-border">
        <p>Facility data: OpenStreetMap contributors via Overpass API.</p>
        <p>Travel areas and road-network metrics: {ROUTING_PROVIDER_LABEL}.</p>
        <p>
          Results depend on the completeness of the source facility and road-network
          data.
        </p>
      </div>
    </div>
  );
}


===== src/components/panels/FacilitiesTab.tsx =====
import { useMemo, useState } from 'react';
import { AlertTriangle, MapPin, RefreshCw, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAppState } from '@/context/AppContext';
import { useAnalysis } from '@/hooks/useAnalysis';
import type { Facility, FacilityType } from '@/types/health';

const typeColors: Record<string, string> = {
  hospital: 'bg-destructive/20 text-destructive',
  clinic: 'bg-primary/20 text-primary',
  pharmacy: 'bg-chart-purple/20 text-chart-purple',
  doctors: 'bg-success/20 text-success',
  dentist: 'bg-accent/20 text-accent',
  laboratory: 'bg-secondary text-secondary-foreground',
  healthcare: 'bg-secondary text-secondary-foreground',
};

type SortKey =
  | 'roadTime'
  | 'roadDistance'
  | 'straightLine'
  | 'name'
  | 'type'
  | 'band';

function formatMeters(value?: number | null) {
  if (value == null || !Number.isFinite(value)) return null;
  return value < 1000
    ? `${Math.round(value)} m`
    : `${(value / 1000).toFixed(1)} km`;
}

function formatSeconds(value?: number | null) {
  if (value == null || !Number.isFinite(value)) return null;
  const minutes = Math.round(value / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}

function compareOptionalNumbers(a?: number, b?: number) {
  return (
    (a ?? Number.POSITIVE_INFINITY) -
    (b ?? Number.POSITIVE_INFINITY)
  );
}

export function FacilitiesTab() {
  const { state } = useAppState();
  const { retryFacilities } = useAnalysis();
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<FacilityType | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('roadTime');

  const result = state.analysisResult;
  const facilities = state.facilities;

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    const list = facilities.filter((facility) => {
      if (typeFilter && facility.type !== typeFilter) return false;
      if (query && !facility.name.toLowerCase().includes(query)) return false;
      return true;
    });

    list.sort((a, b) => {
      switch (sortKey) {
        case 'roadTime':
          return compareOptionalNumbers(
            a.travelDurationSeconds,
            b.travelDurationSeconds,
          );
        case 'roadDistance':
          return compareOptionalNumbers(
            a.travelDistanceMeters,
            b.travelDistanceMeters,
          );
        case 'straightLine':
          return a.straightLineDistanceMeters - b.straightLineDistanceMeters;
        case 'name':
          return a.name.localeCompare(b.name);
        case 'type':
          return a.type.localeCompare(b.type);
        case 'band':
          return compareOptionalNumbers(a.minimumBandIndex, b.minimumBandIndex);
        default:
          return 0;
      }
    });

    return list;
  }, [facilities, search, sortKey, typeFilter]);

  const typeCounts = useMemo(() => {
    const counts: Partial<Record<FacilityType, number>> = {};
    for (const facility of facilities) {
      counts[facility.type] = (counts[facility.type] || 0) + 1;
    }
    return counts;
  }, [facilities]);

  if (!result) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center space-y-4 p-6">
        <MapPin className="w-12 h-12 text-muted-foreground/30" />
        <div>
          <h3 className="text-sm font-medium text-foreground">
            No health facilities yet
          </h3>
          <p className="text-xs text-muted-foreground mt-1">
            Select a location and run an analysis to see reachable healthcare
            facilities.
          </p>
        </div>
      </div>
    );
  }

  if (result.facilityStatus === 'unavailable') {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center space-y-3 p-6">
        <AlertTriangle className="w-10 h-10 text-amber-500" />
        <div>
          <h3 className="text-sm font-medium text-foreground">
            Facility service unavailable
          </h3>
          <p className="text-xs text-muted-foreground mt-1">
            The travel area was generated, but OpenStreetMap facilities could not be
            loaded. This is not a zero-facility result.
          </p>
          {result.facilityRequestId && (
            <p className="text-[10px] text-muted-foreground mt-1 font-mono break-all">
              Request ID: {result.facilityRequestId}
            </p>
          )}
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="gap-1.5"
          disabled={state.isAnalyzing}
          onClick={() => void retryFacilities()}
        >
          <RefreshCw
            className={`w-3.5 h-3.5 ${state.isAnalyzing ? 'animate-spin' : ''}`}
          />
          Retry facilities
        </Button>
      </div>
    );
  }

  if (result.facilityStatus === 'empty') {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center space-y-4 p-6">
        <MapPin className="w-12 h-12 text-muted-foreground/30" />
        <div>
          <h3 className="text-sm font-medium text-foreground">
            No mapped facilities returned
          </h3>
          <p className="text-xs text-muted-foreground mt-1">
            The OpenStreetMap query completed successfully, but returned no healthcare
            facilities within the facility-search extent.
          </p>
        </div>
      </div>
    );
  }

  if (facilities.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center space-y-4 p-6">
        <MapPin className="w-12 h-12 text-muted-foreground/30" />
        <div>
          <h3 className="text-sm font-medium text-foreground">
            No facilities inside the travel area
          </h3>
          <p className="text-xs text-muted-foreground mt-1">
            Facilities were found near the origin, but none fall inside the selected
            isochrone.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3 p-3">
      {!result.matrixAvailable && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-2.5 text-[11px]">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-500" />
          <span>
            Facilities are available, but road-network time and distance could not be
            calculated. Straight-line distance is shown separately.
          </span>
        </div>
      )}

      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
        <input
          type="text"
          placeholder="Filter facilities..."
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          aria-label="Filter facilities"
          className="w-full h-8 pl-8 pr-3 bg-secondary/50 border border-border rounded-md text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
        />
      </div>

      <div className="flex flex-wrap gap-1">
        <button
          type="button"
          onClick={() => setTypeFilter(null)}
          className={`px-2 py-1 rounded text-xs transition-colors ${
            !typeFilter
              ? 'bg-primary/15 text-primary'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          All ({facilities.length})
        </button>

        {(Object.entries(typeCounts) as [FacilityType, number][]).map(
          ([type, count]) => (
            <button
              key={type}
              type="button"
              onClick={() => setTypeFilter(typeFilter === type ? null : type)}
              className={`px-2 py-1 rounded text-xs capitalize transition-colors ${
                typeFilter === type
                  ? 'bg-primary/15 text-primary'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {type} ({count})
            </button>
          ),
        )}
      </div>

      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <label htmlFor="facility-sort">Sort by</label>
        <select
          id="facility-sort"
          value={sortKey}
          onChange={(event) => setSortKey(event.target.value as SortKey)}
          className="h-7 bg-secondary/50 border border-border rounded px-2 text-xs"
        >
          <option value="roadTime">Road travel time</option>
          <option value="roadDistance">Road distance</option>
          <option value="straightLine">Straight-line distance</option>
          <option value="name">Name</option>
          <option value="type">Type</option>
          <option value="band">Travel band</option>
        </select>
      </div>

      <div className="space-y-1.5">
        {filtered.slice(0, 100).map((facility: Facility) => {
          const roadTime = formatSeconds(facility.travelDurationSeconds);
          const roadDistance = formatMeters(facility.travelDistanceMeters);
          const straightDistance = formatMeters(
            facility.straightLineDistanceMeters,
          );

          return (
            <div key={facility.id} className="data-card p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">
                    {facility.name}
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-0.5 truncate">
                    {facility.source}
                    {facility.osmType
                      ? ` · ${facility.osmType}/${facility.osmId}`
                      : ''}
                    {facility.minimumBandLabel
                      ? ` · ${facility.minimumBandLabel}`
                      : ''}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px]">
                    {roadTime && (
                      <span className="text-foreground">{roadTime} road</span>
                    )}
                    {roadDistance && (
                      <span className="text-muted-foreground">
                        {roadDistance} road
                      </span>
                    )}
                    {straightDistance && (
                      <span className="text-muted-foreground">
                        {straightDistance} straight
                      </span>
                    )}
                    {!facility.matrixEvaluated && (
                      <span className="text-amber-600">Matrix not evaluated</span>
                    )}
                  </div>
                  <div className="text-[10px] font-mono text-muted-foreground mt-0.5">
                    {facility.lat.toFixed(4)}, {facility.lon.toFixed(4)}
                  </div>
                </div>
                <span
                  className={`px-1.5 py-0.5 rounded text-[10px] font-medium capitalize whitespace-nowrap ${
                    typeColors[facility.type] ||
                    'bg-secondary text-secondary-foreground'
                  }`}
                >
                  {facility.type}
                </span>
              </div>
            </div>
          );
        })}

        {filtered.length === 0 && (
          <div className="text-center text-xs text-muted-foreground py-8">
            No facilities match the current filter.
          </div>
        )}

        {filtered.length > 100 && (
          <div className="text-center text-xs text-muted-foreground py-2">
            Showing 100 of {filtered.length} facilities
          </div>
        )}
      </div>
    </div>
  );
}


===== .gitignore =====
# Logs
logs
*.log
npm-debug.log*
yarn-debug.log*
yarn-error.log*
pnpm-debug.log*
lerna-debug.log*

# Dependencies and build output
node_modules
dist
dist-ssr
*.local

# Environment files
.env
.env.*
!.env.example

# Editor directories and files
.vscode/*
!.vscode/extensions.json
.idea
.DS_Store
*.suo
*.ntvs*
*.njsproj
*.sln
*.sw?


===== .env.example =====
# OpenRouteService API key. Server-side only.
# Configure this in Vercel Project Settings -> Environment Variables.
ORS_API_KEY=your_openrouteservice_api_key_here

# Optional identification header sent by the server to public Overpass providers.
# Replace with your deployed domain or a project contact identifier.
OVERPASS_USER_AGENT=isoHealth/1.0 your-project-domain-or-contact

