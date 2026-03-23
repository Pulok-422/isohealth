import { useCallback } from 'react';
import { useAppState } from '@/context/AppContext';
import { fetchFacilities, generateIsochrones } from '@/lib/api';
import { generatePopulationGrid, calculateCoverage, findUnderservedClusters, suggestFacilityLocations, haversine } from '@/lib/analysis';
import { toast } from 'sonner';

export function useAnalysis() {
  const { state, dispatch } = useAppState();

  const runAnalysis = useCallback(async (lat: number, lon: number) => {
    dispatch({ type: 'SET_ANALYZING', payload: true });
    dispatch({ type: 'SET_ANALYSIS_POINT', payload: [lat, lon] });

    try {
      // Fetch facilities and isochrones in parallel
      const [facilities, isochrones] = await Promise.all([
        fetchFacilities(lat, lon, state.searchRadius),
        generateIsochrones(lat, lon, state.transportProfile, state.timeThresholds),
      ]);

      dispatch({ type: 'SET_FACILITIES', payload: facilities });

      // Generate population grid
      const popGrid = generatePopulationGrid(lat, lon);
      dispatch({ type: 'SET_POPULATION', payload: popGrid });

      // Calculate coverage
      const coverage = calculateCoverage(popGrid, isochrones);

      // Find nearest facility
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
          nearestDuration: nearestDistance ? nearestDistance * 60 : null, // rough estimate
          populationCovered: coverage.covered,
          populationUnderserved: coverage.underserved,
          totalPopulation: coverage.total,
        },
      });

      // Run optimization
      const underserved = findUnderservedClusters(popGrid, isochrones);
      const suggestions = suggestFacilityLocations(underserved);
      dispatch({ type: 'SET_OPTIMIZATION', payload: suggestions });

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
