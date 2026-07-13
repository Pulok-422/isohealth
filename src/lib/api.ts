import type { Facility } from '@/types/health';

type SuccessEnvelope<T> = { success: true; data: T };
type ErrorEnvelope = { success: false; error: string };
type Envelope<T> = SuccessEnvelope<T> | ErrorEnvelope;

export class ApiError extends Error {
  status?: number;
  code?: string;

  constructor(message: string, options?: { status?: number; code?: string }) {
    super(message);
    this.name = 'ApiError';
    this.status = options?.status;
    this.code = options?.code;
  }
}

export async function postJson<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') {
      throw new ApiError('Request cancelled.', { code: 'CANCELLED' });
    }
    throw new ApiError(`Network error while calling ${path}`, { code: 'NETWORK' });
  }

  let payload: Envelope<T> | null = null;
  try {
    payload = (await response.json()) as Envelope<T>;
  } catch {
    // non-JSON response
  }

  if (!response.ok || !payload || payload.success !== true) {
    const message =
      (payload && 'error' in payload && payload.error) ||
      `Request failed (${response.status})`;
    throw new ApiError(message, { status: response.status });
  }

  return payload.data;
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
}

export async function fetchFacilities(
  lat: number,
  lon: number,
  radius: number,
  signal?: AbortSignal,
): Promise<FacilityFetchResult> {
  const data = await postJson<Omit<FacilityFetchResult, 'facilities'> & { facilities: unknown }>(
    '/api/fetch-facilities',
    { lat, lon, radius },
    signal,
  );

  const rawFacilities = Array.isArray(data.facilities) ? (data.facilities as any[]) : [];
  const facilities: Facility[] = rawFacilities.map((f) => ({
    ...f,
    insideOutermostIsochrone: false,
    matrixEvaluated: false,
  }));

  return { ...data, facilities };
}
