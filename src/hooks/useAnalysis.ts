import { useCallback, useRef } from 'react';
import { useAppState } from '@/context/AppContext';
import { fetchFacilities, generateIsochrones } from '@/lib/api';
import { generatePopulationGrid, calculateCoverage, findUnderservedClusters, suggestFacilityLocations, haversine } from '@/lib/analysis';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

// Simple in-memory cache
const cache = new Map<string, { data: any; ts: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 min

function getCached(key: string) {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.ts < CACHE_TTL) return entry.data;
  return null;
}
function setCache(key: string, data: any) {
  cache.set(key, { data, ts: Date.now() });
}

export function useAnalysis() {
  const { state, dispatch } = useAppState();

  const runAnalysis = useCallback(async (lat: number, lon: number) => {
    dispatch({ type: 'SET_ANALYZING', payload: true });
    dispatch({ type: 'SET_ANALYSIS_POINT', payload: [lat, lon] });

    try {
      // Cache keys
      const facKey = `fac-${lat.toFixed(3)}-${lon.toFixed(3)}-${state.searchRadius}`;
      const isoKey = `iso-${lat.toFixed(3)}-${lon.toFixed(3)}-${state.transportProfile}-${state.timeThresholds.join(',')}`;

      // Fetch with cache
      let facilities = getCached(facKey);
      let isochrones = getCached(isoKey);

      const promises: Promise<any>[] = [];
      if (!facilities) promises.push(fetchFacilities(lat, lon, state.searchRadius).then(f => { facilities = f; setCache(facKey, f); }));
      if (!isochrones) promises.push(generateIsochrones(lat, lon, state.transportProfile, state.timeThresholds).then(i => { isochrones = i; setCache(isoKey, i); }));
      if (promises.length) await Promise.all(promises);

      dispatch({ type: 'SET_FACILITIES', payload: facilities });

      const popGrid = generatePopulationGrid(lat, lon);
      dispatch({ type: 'SET_POPULATION', payload: popGrid });

      const coverage = calculateCoverage(popGrid, isochrones);

      let nearestFacility = null;
      let nearestDistance = null;
      if (facilities.length > 0) {
        let minDist = Infinity;
        for (const f of facilities) {
          const dist = haversine(lat, lon, f.lat, f.lon);
          if (dist < minDist) {
            minDist = dist;
            nearestFacility = f;
            nearestDistance = dist;
          }
        }
      }

      const allFacilities = [...facilities, ...state.simulatedFacilities];

      dispatch({
        type: 'SET_ANALYSIS_RESULT',
        payload: {
          facilities: allFacilities,
          isochrones,
          nearestFacility,
          nearestDistance: nearestDistance ? nearestDistance * 1000 : null,
          nearestDuration: nearestDistance ? nearestDistance * 60 : null,
          populationCovered: coverage.covered,
          populationUnderserved: coverage.underserved,
          totalPopulation: coverage.total,
        },
      });

      const underserved = findUnderservedClusters(popGrid, isochrones);
      const suggestions = suggestFacilityLocations(underserved);
      dispatch({ type: 'SET_OPTIMIZATION', payload: suggestions });

      // Log to database (best-effort for logged-in users, session tracking for guests)
      supabase.auth.getUser().then(({ data: { user } }) => {
        if (user) {
          supabase.from('isochrone_requests').insert({
            user_id: user.id,
            latitude: lat,
            longitude: lon,
            profile: state.transportProfile,
            ranges: state.timeThresholds,
            request_type: 'analysis',
          }).then(() => {});
        }
      });

      toast.success(`Analysis complete: ${facilities.length} facilities found`);
    } catch (error: any) {
      console.error('Analysis error:', error);
      toast.error(`Analysis failed: ${error.message}`);
    } finally {
      dispatch({ type: 'SET_ANALYZING', payload: false });
    }
  }, [state.searchRadius, state.transportProfile, state.timeThresholds, state.simulatedFacilities, dispatch]);

  return { runAnalysis };
}
