import type { FeatureCollection } from 'geojson';
import type { Coordinate, MatrixResult, RoutingProfile, RoutingProvider } from './types';

async function postJson<T>(url: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });

  let payload: any = null;
  try {
    payload = await res.json();
  } catch {
    // non-JSON
  }

  if (!res.ok || !payload || payload.success !== true) {
    const msg = (payload && payload.error) || `Request failed (${res.status})`;
    const err = new Error(msg) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }

  return payload.data as T;
}

export class OpenRouteServiceProvider implements RoutingProvider {
  readonly id = 'openrouteservice' as const;

  async generateIsochrones(params: {
    origin: Coordinate;
    profile: RoutingProfile;
    rangeType: 'time' | 'distance';
    ranges: number[];
  }): Promise<FeatureCollection> {
    const data = await postJson<FeatureCollection>('/api/generate-isochrones', {
      lat: params.origin.lat,
      lon: params.origin.lon,
      profile: params.profile,
      ranges: params.ranges,
      range_type: params.rangeType,
    });

    if (!data || data.type !== 'FeatureCollection' || !Array.isArray(data.features)) {
      throw new Error('Isochrone service returned an unexpected response.');
    }

    return data;
  }

  async computeMatrix(params: {
    origins: Coordinate[];
    destinations: Coordinate[];
    profile: RoutingProfile;
  }): Promise<MatrixResult> {
    const data = await postJson<{ durations?: unknown; distances?: unknown }>(
      '/api/compute-matrix',
      {
        origins: params.origins,
        destinations: params.destinations,
        profile: params.profile,
      },
    );

    const durations = Array.isArray(data.durations) ? (data.durations as Array<Array<number | null>>) : [];
    const distances = Array.isArray(data.distances) ? (data.distances as Array<Array<number | null>>) : [];

    if (durations.length !== params.origins.length || distances.length !== params.origins.length) {
      throw new Error('Matrix response has unexpected dimensions.');
    }

    return { durations, distances };
  }
}
