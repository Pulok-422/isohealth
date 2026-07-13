import type { Feature, FeatureCollection, Geometry, Polygon, MultiPolygon, Position } from 'geojson';
import type { Facility, TravelBand } from '@/types/health';

const EARTH_RADIUS_M = 6_371_000;

export function haversineMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function pointInRing(point: Position, ring: Position[]): boolean {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersect =
      yi > y !== yj > y &&
      x < ((xj - xi) * (y - yi)) / (yj - yi || Number.EPSILON) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function pointInPolygonCoords(point: Position, polygon: Position[][]): boolean {
  if (!polygon.length) return false;
  if (!pointInRing(point, polygon[0])) return false;
  for (let i = 1; i < polygon.length; i++) {
    if (pointInRing(point, polygon[i])) return false;
  }
  return true;
}

/** point = [lon, lat] */
export function pointInGeometry(point: [number, number], geometry: Geometry | null | undefined): boolean {
  if (!geometry) return false;
  if (geometry.type === 'Polygon') {
    return pointInPolygonCoords(point, (geometry as Polygon).coordinates);
  }
  if (geometry.type === 'MultiPolygon') {
    return (geometry as MultiPolygon).coordinates.some((poly) => pointInPolygonCoords(point, poly));
  }
  return false;
}

function bandLabel(value: number, prevValue: number | null, unit: 'seconds' | 'metres'): string {
  if (unit === 'seconds') {
    const prevMin = prevValue == null ? 0 : Math.round(prevValue / 60);
    const curMin = Math.round(value / 60);
    return `${prevMin}–${curMin} min`;
  }
  const prevKm = prevValue == null ? 0 : prevValue / 1000;
  const curKm = value / 1000;
  const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
  return `${fmt(prevKm)}–${fmt(curKm)} km`;
}

export function sortIsochroneBands(
  collection: FeatureCollection | null | undefined,
  analysisType: 'time' | 'distance',
): TravelBand[] {
  if (!collection?.features?.length) return [];
  const unit: 'seconds' | 'metres' = analysisType === 'time' ? 'seconds' : 'metres';

  const valid = collection.features.filter((f) => {
    const v = Number(f?.properties?.value);
    return f?.geometry && Number.isFinite(v) && v > 0 &&
      (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon');
  });

  const sorted = [...valid].sort(
    (a, b) => Number(a.properties?.value) - Number(b.properties?.value),
  );

  const bands: TravelBand[] = [];
  let prev: number | null = null;
  sorted.forEach((feature, index) => {
    const value = Number(feature.properties?.value);
    bands.push({
      index,
      value,
      unit,
      label: bandLabel(value, prev, unit),
      feature,
    });
    prev = value;
  });

  return bands;
}

export function getOutermostIsochroneFeature(
  collection: FeatureCollection | null | undefined,
): Feature | null {
  if (!collection?.features?.length) return null;
  let best: Feature | null = null;
  let bestValue = -Infinity;
  for (const f of collection.features) {
    const v = Number(f?.properties?.value);
    if (!Number.isFinite(v)) continue;
    if (!f.geometry) continue;
    if (f.geometry.type !== 'Polygon' && f.geometry.type !== 'MultiPolygon') continue;
    if (v > bestValue) {
      bestValue = v;
      best = f;
    }
  }
  return best;
}

function walkRings(geometry: Geometry, callback: (ring: Position[]) => void) {
  if (geometry.type === 'Polygon') {
    for (const ring of (geometry as Polygon).coordinates) callback(ring);
  } else if (geometry.type === 'MultiPolygon') {
    for (const poly of (geometry as MultiPolygon).coordinates) {
      for (const ring of poly) callback(ring);
    }
  }
}

export function getMaximumGeometryRadiusMeters(
  originLat: number,
  originLon: number,
  geometry: Geometry | null | undefined,
): number {
  if (!geometry) return 0;
  let maxD = 0;
  walkRings(geometry, (ring) => {
    for (const [lon, lat] of ring) {
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      const d = haversineMeters(originLat, originLon, lat, lon);
      if (d > maxD) maxD = d;
    }
  });
  return maxD;
}

export function classifyFacilityIntoMinimumBand(
  facility: Pick<Facility, 'lat' | 'lon'>,
  bands: TravelBand[],
): {
  minimumBandValue?: number;
  minimumBandLabel?: string;
  minimumBandIndex?: number;
} {
  const pt: [number, number] = [facility.lon, facility.lat];
  for (const band of bands) {
    if (pointInGeometry(pt, band.feature.geometry)) {
      return {
        minimumBandValue: band.value,
        minimumBandLabel: band.label,
        minimumBandIndex: band.index,
      };
    }
  }
  return {};
}