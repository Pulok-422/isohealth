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
    // non-JSON response
  }

  if (!response.ok || !payload || payload.success !== true) {
    const message =
      (payload && 'error' in payload && payload.error) ||
      `Request failed (${response.status})`;
    throw new Error(message);
  }

  return payload.data;
}

export async function fetchFacilities(
  lat: number,
  lon: number,
  radius: number = 10000
): Promise<Facility[]> {
  const data = await postJson<{ facilities: Facility[]; radiusUsed?: number; source?: string }>(
    '/api/fetch-facilities',
    { lat, lon, radius }
  );

  const facilities = data.facilities ?? [];
  console.log('Fetched facilities:', facilities.length, facilities, { radiusUsed: data.radiusUsed });
  return facilities;
}

export async function generateIsochrones(
  lat: number,
  lon: number,
  profile: TransportProfile = 'foot-walking',
  ranges: number[] = [300, 600, 900, 1800],
  range_type: 'time' | 'distance' = 'time'
) {
  return postJson<any>('/api/generate-isochrones', { lat, lon, profile, ranges, range_type });
}

export async function calculateRoute(
  start: { lat: number; lon: number },
  end: { lat: number; lon: number },
  profile: TransportProfile = 'driving-car'
) {
  return postJson<any>('/api/calculate-route', { start, end, profile });
}

export async function computeMatrix(
  origins: { lat: number; lon: number }[],
  destinations: { lat: number; lon: number }[],
  profile: TransportProfile = 'driving-car'
) {
  return postJson<any>('/api/compute-matrix', { origins, destinations, profile });
}
