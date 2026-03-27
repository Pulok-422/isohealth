import { useCallback } from 'react';
import { useAppState } from '@/context/AppContext';
import { fetchFacilities, generateIsochrones } from '@/lib/api';
import {
  calculateCoverage,
  findUnderservedClusters,
  suggestFacilityLocations,
  haversine,
} from '@/lib/analysis';
import { getBBoxFromIsochrones, getPopulationEstimate } from '@/lib/population';
import type { PopulationSource } from '@/lib/population';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

const cache = new Map<string, { data: any; ts: number }>();
const CACHE_TTL = 5 * 60 * 1000;

function getCached(key: string) {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.ts < CACHE_TTL) return entry.data;
  return null;
}

function setCache(key: string, data: any) {
  cache.set(key, { data, ts: Date.now() });
}

function pointInRing(point: [number, number], ring: number[][]) {
  const [x, y] = point;
  let inside = false;

  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];

    const intersect =
      yi > y !== yj > y &&
      x < ((xj - xi) * (y - yi)) / ((yj - yi) || Number.EPSILON) + xi;

    if (intersect) inside = !inside;
  }

  return inside;
}

function pointInPolygonCoords(point: [number, number], polygonCoords: number[][][]) {
  if (!polygonCoords?.length) return false;

  const outerRing = polygonCoords[0];
  if (!pointInRing(point, outerRing)) return false;

  for (let i = 1; i < polygonCoords.length; i++) {
    if (pointInRing(point, polygonCoords[i])) return false;
  }

  return true;
}

function pointInGeometry(point: [number, number], geometry: any) {
  if (!geometry) return false;

  if (geometry.type === 'Polygon') {
    return pointInPolygonCoords(point, geometry.coordinates);
  }

  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates.some((polygonCoords: number[][][]) =>
      pointInPolygonCoords(point, polygonCoords)
    );
  }

  return false;
}

function getOutermostIsochroneGeometry(isochrones: any) {
  const features = isochrones?.features;
  if (!features?.length) return null;

  const validFeatures = features.filter(
    (f: any) => f?.geometry && f?.properties?.value != null
  );

  if (!validFeatures.length) return null;

  const outermost = validFeatures.reduce((maxFeature: any, current: any) => {
    const maxValue = Number(maxFeature?.properties?.value ?? -Infinity);
    const currentValue = Number(current?.properties?.value ?? -Infinity);
    return currentValue > maxValue ? current : maxFeature;
  });

  return outermost?.geometry ?? null;
}

export function useAnalysis() {
  const { state, dispatch } = useAppState();

  const runAnalysis = useCallback(
    async (lat: number, lon: number) => {
      dispatch({ type: 'SET_ANALYZING', payload: true });
      dispatch({ type: 'SET_ANALYSIS_POINT', payload: [lat, lon] });

      try {
        const analysisType = state.analysisType ?? 'time';
        const transportProfile = state.transportProfile ?? 'foot-walking';

        const ranges =
          analysisType === 'distance'
            ? state.distanceThresholds ?? []
            : state.timeThresholds ?? [];

        const rangeType = analysisType;

        const facKey = `fac-${lat.toFixed(3)}-${lon.toFixed(3)}-${state.searchRadius}`;
        const isoKey = `iso-${lat.toFixed(3)}-${lon.toFixed(3)}-${transportProfile}-${rangeType}-${ranges.join(',')}`;

        let facilities = getCached(facKey);
        let isochrones = getCached(isoKey);

        const promises: Promise<any>[] = [];

        if (!facilities) {
          promises.push(
            fetchFacilities(lat, lon, state.searchRadius).then((f) => {
              facilities = f;
              setCache(facKey, f);
            })
          );
        }

        if (!isochrones) {
          promises.push(
            generateIsochrones(lat, lon, transportProfile, ranges, rangeType).then((i) => {
              isochrones = i;
              setCache(isoKey, i);
            })
          );
        }

        if (promises.length) await Promise.all(promises);

        console.log('Analysis profile used:', transportProfile);
        console.log('Analysis type used:', rangeType);
        console.log('Ranges used:', ranges);

        if (isochrones?.features) {
          console.log('Isochrone feature count:', isochrones.features.length);
          console.log(
            'Isochrone values:',
            isochrones.features.map((f: any) => f.properties?.value)
          );
        }

        dispatch({ type: 'SET_FACILITIES', payload: facilities });

        const bbox = getBBoxFromIsochrones(isochrones);
        let popGrid;
        let usedSource: import('@/types/health').PopulationSource = 'worldpop';

        if (bbox) {
          popGrid = await getPopulationData(bbox, 'worldpop');
        } else {
          const { generatePopulationGrid } = await import('@/lib/analysis');
          popGrid = generatePopulationGrid(lat, lon);
          usedSource = 'simulated';
        }

        dispatch({ type: 'SET_POPULATION', payload: popGrid });

        const coverage = calculateCoverage(popGrid, isochrones);

        const allFacilities = [...(facilities || []), ...state.simulatedFacilities];
        const outerGeometry = getOutermostIsochroneGeometry(isochrones);

        const reachableFacilities = outerGeometry
          ? allFacilities.filter((facility) =>
              pointInGeometry([facility.lon, facility.lat], outerGeometry)
            )
          : allFacilities;

        let nearestFacility = null;
        let nearestDistance: number | null = null;

        if (reachableFacilities.length > 0) {
          let minDist = Infinity;

          for (const f of reachableFacilities) {
            const dist = haversine(lat, lon, f.lat, f.lon);
            if (dist < minDist) {
              minDist = dist;
              nearestFacility = f;
              nearestDistance = dist;
            }
          }
        }

        dispatch({
          type: 'SET_ANALYSIS_RESULT',
          payload: {
            facilities: reachableFacilities,
            reachableFacilityCount: reachableFacilities.length,
            totalFacilityCount: allFacilities.length,
            isochrones,
            nearestFacility,
            nearestDistance: nearestDistance ? nearestDistance * 1000 : null,
            nearestDuration: nearestDistance ? nearestDistance * 60 : null,
            populationCovered: coverage.covered,
            populationUnderserved: coverage.underserved,
            totalPopulation: coverage.total,
            profileUsed: transportProfile,
            analysisTypeUsed: rangeType,
            rangesUsed: ranges,
            populationSource: usedSource,
          },
        });

        const underserved = findUnderservedClusters(popGrid, isochrones);
        const suggestions = suggestFacilityLocations(underserved);
        dispatch({ type: 'SET_OPTIMIZATION', payload: suggestions });

        supabase.auth.getUser().then(({ data: { user } }) => {
          if (user) {
            supabase
              .from('isochrone_requests')
              .insert({
                user_id: user.id,
                latitude: lat,
                longitude: lon,
                profile: transportProfile,
                ranges: ranges as any,
                request_type: rangeType,
              })
              .then(() => {});
          }
        });

        toast.success(
          `Analysis complete: ${reachableFacilities.length} reachable facilities`
        );
      } catch (error: any) {
        console.error('Analysis error:', error);
        toast.error(`Analysis failed: ${error.message}`);
      } finally {
        dispatch({ type: 'SET_ANALYZING', payload: false });
      }
    },
    [
      state.searchRadius,
      state.transportProfile,
      state.analysisType,
      state.timeThresholds,
      state.distanceThresholds,
      state.simulatedFacilities,
      dispatch,
    ]
  );

  return { runAnalysis };
}
