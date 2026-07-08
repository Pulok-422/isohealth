import { useCallback } from 'react';
import { useAppState } from '@/context/AppContext';
import { estimateTravelTime } from '@/lib/travelTime';
import { fetchFacilities, generateIsochrones } from '@/lib/api';
import {
  calculateCoverage,
  findUnderservedClusters,
  suggestFacilityLocations,
  haversine,
  generatePopulationGrid,
} from '@/lib/analysis';
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

        // Prioritize isochrones; fetch facilities in parallel but don't let
        // a facility failure block map rendering.
        const isoPromise = isochrones
          ? Promise.resolve(isochrones)
          : generateIsochrones(lat, lon, transportProfile, ranges, rangeType).then((i) => {
              setCache(isoKey, i);
              return i;
            });

        const facPromise = facilities
          ? Promise.resolve(facilities)
          : fetchFacilities(lat, lon, state.searchRadius).then((f) => {
              setCache(facKey, f);
              return f;
            });

        const [isoSettled, facSettled] = await Promise.allSettled([isoPromise, facPromise]);

        if (isoSettled.status === 'rejected') {
          throw isoSettled.reason instanceof Error
            ? isoSettled.reason
            : new Error(String(isoSettled.reason));
        }
        isochrones = isoSettled.value;

        if (facSettled.status === 'fulfilled') {
          facilities = facSettled.value;
        } else {
          facilities = [];
          console.warn('Facility fetch failed:', facSettled.reason);
          toast.warning('Facility data unavailable — showing isochrone only');
        }

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

        const popGrid = generatePopulationGrid(lat, lon);
        const coverage = calculateCoverage(popGrid, isochrones);
        const populationCovered = coverage.covered;
        const populationUnderserved = coverage.underserved;
        const totalPopulation = coverage.total;

        dispatch({ type: 'SET_POPULATION', payload: popGrid });

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
            nearestDuration: nearestDistance ? estimateTravelTime(nearestDistance * 1000, transportProfile) : null,
            populationCovered,
            populationUnderserved,
            totalPopulation,
            profileUsed: transportProfile,
            analysisTypeUsed: rangeType,
            rangesUsed: ranges,
          },
        });

        const underserved = findUnderservedClusters(popGrid, isochrones);
        const suggestions = suggestFacilityLocations(underserved);
        dispatch({ type: 'SET_OPTIMIZATION', payload: suggestions });

        toast.success(
          reachableFacilities.length > 0
            ? `Found ${reachableFacilities.length} healthcare facilities within reach`
            : 'No health facilities found nearby — try expanding the range'
        );
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        console.error('Analysis error:', error);
        toast.error(
          message.toLowerCase().includes('network') || message.toLowerCase().includes('fetch')
            ? 'Network error — please check your connection'
            : `Analysis failed: ${message}`
        );
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
