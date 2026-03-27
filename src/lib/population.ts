import { supabase } from '@/integrations/supabase/client';
import type { PopulationPoint } from '@/types/health';

export type PopulationSource = 'worldpop' | 'simulated';

interface BBox {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

export interface PopulationEstimate {
  total_population_estimate: number;
  population_with_access: number;
  population_without_access: number;
  coverage_percent: number;
  source: string;
  method: string;
  country_iso: string;
  area_km2: number;
  grid_points: number;
  population_grid: PopulationPoint[];
}

const popCache = new Map<string, { data: PopulationEstimate; ts: number }>();
const CACHE_TTL = 10 * 60 * 1000;

function cacheKey(bbox: BBox, hasIsochrones: boolean): string {
  return `pop-${bbox.minLat.toFixed(3)}-${bbox.maxLat.toFixed(3)}-${bbox.minLon.toFixed(3)}-${bbox.maxLon.toFixed(3)}-${hasIsochrones}`;
}

export function getBBoxFromIsochrones(isochrones: any): BBox | null {
  if (!isochrones?.features?.length) return null;

  let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;

  for (const feature of isochrones.features) {
    const coords = feature?.geometry?.coordinates;
    if (!coords) continue;

    const flatten = (arr: any[]): void => {
      if (typeof arr[0] === 'number') {
        const [lon, lat] = arr;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
        if (lon < minLon) minLon = lon;
        if (lon > maxLon) maxLon = lon;
      } else {
        for (const sub of arr) flatten(sub);
      }
    };

    flatten(coords);
  }

  if (!isFinite(minLat)) return null;
  return { minLat, maxLat, minLon, maxLon };
}

/**
 * Fetch real population estimates from the backend edge function.
 * Uses WorldPop-calibrated country-level density data with spatial intersection.
 */
export async function getPopulationEstimate(
  bbox: BBox,
  isochrones?: any
): Promise<PopulationEstimate> {
  const key = cacheKey(bbox, !!isochrones?.features?.length);
  const cached = popCache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;

  const { data, error } = await supabase.functions.invoke('estimate-population', {
    body: { bbox, isochrones },
  });

  if (error) throw new Error(`Population estimation failed: ${error.message}`);

  const result = data as PopulationEstimate;
  popCache.set(key, { data: result, ts: Date.now() });
  return result;
}

/** Clear the population cache (useful on reset) */
export function clearPopulationCache() {
  popCache.clear();
}
