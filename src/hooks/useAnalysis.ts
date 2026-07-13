import { useCallback } from 'react';
import { toast } from 'sonner';
import { useAppState } from '@/context/AppContext';
import { fetchFacilities, ApiError } from '@/lib/api';
import { getRoutingProvider } from '@/services/routing';
import type {
  AnalysisResult,
  Facility,
  FacilityDataQuality,
  FacilityType,
  MatrixCoverage,
  TransportProfile,
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

function generateAnalysisId(): string {
  const c = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : String(Date.now());
  return `an_${c}`;
}

function computeSearchRadiusMeters(originLat: number, originLon: number, geometry: GeoJSON.Geometry): number {
  const raw = getMaximumGeometryRadiusMeters(originLat, originLon, geometry) + 1000;
  const rounded = Math.ceil(raw / 100) * 100;
  return Math.max(1000, rounded);
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const runners = new Array(Math.min(concurrency, items.length)).fill(0).map(async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  });
  await Promise.all(runners);
  return results;
}

function computeDataQuality(facilities: Facility[]): FacilityDataQuality {
  const q: FacilityDataQuality = {
    total: facilities.length,
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
    possibleDuplicates: 0,
  };
  for (const f of facilities) {
    const hasRealName = !!f.tags?.name || !!f.tags?.['name:en'];
    if (hasRealName) q.withName++;
    else q.withoutName++;
    if (f.operator) q.withOperator++;
    if (f.openingHours) q.withOpeningHours++;
    if (f.emergency) q.withEmergencyTag++;
    if (f.speciality) q.withSpeciality++;
    if (f.source === 'Uploaded') q.uploadedFacilities++;
    else if (f.osmType === 'node') q.osmNodes++;
    else if (f.osmType === 'way') q.osmWays++;
    else if (f.osmType === 'relation') q.osmRelations++;
  }
  return q;
}

function computeBandCounts(bands: { index: number; label: string }[], facilities: Facility[]) {
  const incremental: Record<string, number> = {};
  const cumulative: Record<string, number> = {};
  for (const b of bands) {
    incremental[b.label] = 0;
    cumulative[b.label] = 0;
  }
  for (const f of facilities) {
    if (f.minimumBandIndex == null) continue;
    const own = bands[f.minimumBandIndex];
    if (own) incremental[own.label] = (incremental[own.label] || 0) + 1;
    for (let i = f.minimumBandIndex; i < bands.length; i++) {
      cumulative[bands[i].label] = (cumulative[bands[i].label] || 0) + 1;
    }
  }
  return { incremental, cumulative };
}

function pickNearestByType(facilities: Facility[]): Partial<Record<FacilityType, Facility>> {
  const out: Partial<Record<FacilityType, Facility>> = {};
  const types: FacilityType[] = ['hospital', 'clinic', 'pharmacy', 'doctors', 'dentist', 'laboratory', 'healthcare'];
  const scoreOf = (f: Facility) =>
    f.matrixEvaluated && f.travelDurationSeconds != null ? f.travelDurationSeconds : Number.POSITIVE_INFINITY;
  const fallback = (f: Facility) => f.straightLineDistanceMeters;

  for (const t of types) {
    const ofType = facilities.filter((f) => f.type === t);
    if (!ofType.length) continue;
    ofType.sort((a, b) => {
      const sa = scoreOf(a);
      const sb = scoreOf(b);
      if (sa !== sb) return sa - sb;
      return fallback(a) - fallback(b);
    });
    out[t] = ofType[0];
  }
  return out;
}

function pickOverallNearest(facilities: Facility[]): Facility | null {
  const evaluated = facilities.filter((f) => f.matrixEvaluated && f.travelDurationSeconds != null);
  if (evaluated.length) {
    return evaluated.reduce((min, f) =>
      (f.travelDurationSeconds ?? Infinity) < (min.travelDurationSeconds ?? Infinity) ? f : min,
    );
  }
  if (!facilities.length) return null;
  return facilities.reduce((min, f) => (f.straightLineDistanceMeters < min.straightLineDistanceMeters ? f : min));
}

export function useAnalysis() {
  const { state, dispatch } = useAppState();

  const runAnalysis = useCallback(
    async (lat: number, lon: number) => {
      if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lon) || lon < -180 || lon > 180) {
        toast.error('Please choose a valid location before running the analysis.');
        return;
      }

      const analysisType = state.analysisType;
      const profile: TransportProfile = state.transportProfile;
      const rangesRaw = analysisType === 'distance' ? state.distanceThresholds : state.timeThresholds;
      const ranges = Array.from(new Set(rangesRaw.filter((n) => Number.isFinite(n) && n > 0))).sort((a, b) => a - b);
      if (!ranges.length) {
        toast.error('Select at least one travel range.');
        return;
      }

      dispatch({ type: 'SET_ANALYSIS_POINT', payload: [lat, lon] });
      dispatch({ type: 'SET_ANALYZING', payload: true });
      dispatch({ type: 'SET_ANALYSIS_ERROR', payload: null });

      const warnings: string[] = [];
      const provider = getRoutingProvider();

      try {
        // Step 1: isochrones (must succeed to continue)
        const isochrones = await provider.generateIsochrones({
          origin: { lat, lon },
          profile,
          rangeType: analysisType,
          ranges,
        });

        const bands = sortIsochroneBands(isochrones, analysisType);
        const outerFeature = getOutermostIsochroneFeature(isochrones);
        if (!bands.length || !outerFeature || !outerFeature.geometry) {
          throw new ApiError('The travel-area service returned no usable polygons.', { code: 'ISOCHRONE_UNAVAILABLE' });
        }

        // Step 2: facility search radius from outer geometry
        const radius = computeSearchRadiusMeters(lat, lon, outerFeature.geometry);
        if (radius > 50_000) {
          throw new ApiError(
            'The selected travel range creates an area larger than the supported facility-search extent. Reduce the time or distance range.',
            { code: 'ANALYSIS_TOO_LARGE' },
          );
        }

        // Step 3: fetch OSM facilities
        let nearbyFacilities: Facility[] = [];
        let facilityResultTruncated = false;
        let overpassAvailable = true;
        try {
          const result = await fetchFacilities(lat, lon, radius);
          nearbyFacilities = result.facilities;
          facilityResultTruncated = result.truncated;
          if (facilityResultTruncated) {
            warnings.push(`Facility results were truncated to ${result.facilities.length} nearest records.`);
          }
        } catch (err) {
          overpassAvailable = false;
          console.warn('Facility retrieval failed:', err);
          warnings.push('The OpenStreetMap facility service is temporarily unavailable. The travel area was generated, but OSM facilities could not be loaded.');
          toast.warning('Facility service is temporarily unavailable — showing the travel area only.');
        }

        // Step 4: classify facilities into minimum band + inside outer polygon
        nearbyFacilities = nearbyFacilities.map((f) => {
          const classification = classifyFacilityIntoMinimumBand(f, bands);
          const inside = pointInGeometry([f.lon, f.lat], outerFeature.geometry);
          return {
            ...f,
            ...classification,
            insideOutermostIsochrone: inside,
            matrixEvaluated: false,
          };
        });

        const reachable = nearbyFacilities.filter((f) => f.insideOutermostIsochrone);

        // Step 5: matrix enrichment
        const evaluatedInputs = reachable
          .slice()
          .sort((a, b) => a.straightLineDistanceMeters - b.straightLineDistanceMeters)
          .slice(0, MAX_MATRIX_FACILITIES);
        const matrixComplete = evaluatedInputs.length === reachable.length;

        let matrixAvailable = false;
        const matrixMap = new Map<string, { durationSeconds: number | null; distanceMeters: number | null }>();

        if (evaluatedInputs.length) {
          const groups = chunk(evaluatedInputs, MATRIX_CHUNK_SIZE);
          try {
            const chunkResults = await runWithConcurrency(groups, MATRIX_CONCURRENCY, async (batch) => {
              const res = await provider.computeMatrix({
                origins: [{ lat, lon }],
                destinations: batch.map((f) => ({ lat: f.lat, lon: f.lon })),
                profile,
              });
              return { batch, res };
            });
            matrixAvailable = true;
            for (const { batch, res } of chunkResults) {
              const durRow = res.durations?.[0] || [];
              const distRow = res.distances?.[0] || [];
              batch.forEach((facility, i) => {
                matrixMap.set(facility.id, {
                  durationSeconds: typeof durRow[i] === 'number' ? durRow[i]! : null,
                  distanceMeters: typeof distRow[i] === 'number' ? distRow[i]! : null,
                });
              });
            }
          } catch (err) {
            console.warn('Matrix computation failed:', err);
            warnings.push('Facilities were loaded, but road-network travel times are temporarily unavailable.');
            toast.warning('Road-network travel times are temporarily unavailable.');
          }
        }

        if (!matrixComplete && matrixAvailable) {
          warnings.push(
            `Road-network metrics were calculated for ${evaluatedInputs.length} of ${reachable.length} reachable facilities because the analysis exceeded the supported matrix limit.`,
          );
        }

        const enrichedReachable: Facility[] = reachable.map((f) => {
          const m = matrixMap.get(f.id);
          if (!m) return { ...f, matrixEvaluated: false };
          return {
            ...f,
            matrixEvaluated: true,
            travelDurationSeconds: m.durationSeconds ?? undefined,
            travelDistanceMeters: m.distanceMeters ?? undefined,
          };
        });

        // Step 6: derived indicators
        const nearestFacility = pickOverallNearest(enrichedReachable);
        const nearestByType = pickNearestByType(enrichedReachable);
        const { incremental, cumulative } = computeBandCounts(bands, enrichedReachable);
        const dataQuality = computeDataQuality([...enrichedReachable, ...nearbyFacilities.filter((f) => !f.insideOutermostIsochrone)]);

        const matrixCoverage: MatrixCoverage = {
          totalReachableFacilities: reachable.length,
          evaluatedFacilities: matrixAvailable ? evaluatedInputs.length : 0,
          complete: matrixAvailable && matrixComplete,
        };

        const result: AnalysisResult = {
          analysisId: generateAnalysisId(),
          analysisDate: new Date().toISOString(),
          origin: { lat, lon, label: state.originLabel || undefined },
          isochrones,
          bands,
          facilities: enrichedReachable,
          nearbyFacilities,
          nearestFacility,
          nearestByType,
          profileUsed: profile,
          analysisTypeUsed: analysisType,
          rangesUsed: ranges,
          facilitySourceMode: 'osm',
          facilityQueryRadiusMeters: overpassAvailable ? radius : null,
          facilityResultTruncated,
          matrixAvailable,
          matrixCoverage,
          dataQuality,
          cumulativeCountsByBand: cumulative,
          incrementalCountsByBand: incremental,
          warnings,
        };

        dispatch({ type: 'SET_FACILITIES', payload: enrichedReachable });
        dispatch({ type: 'SET_ANALYSIS_RESULT', payload: result });

        if (!overpassAvailable) {
          // already warned
        } else if (!nearbyFacilities.length) {
          toast.warning('No mapped healthcare facilities were found in OpenStreetMap within the selected travel area.');
        } else if (!enrichedReachable.length) {
          toast.warning('Healthcare facilities were found near the selected location, but none fall inside the selected travel area.');
        } else {
          toast.success(`Found ${enrichedReachable.length} healthcare facilities within the selected travel area.`);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('Analysis error:', err);
        dispatch({ type: 'SET_ANALYSIS_ERROR', payload: message });
        dispatch({ type: 'SET_ANALYSIS_RESULT', payload: null });
        dispatch({ type: 'SET_FACILITIES', payload: [] });
        toast.error(`Analysis failed: ${message}`);
      } finally {
        dispatch({ type: 'SET_ANALYZING', payload: false });
      }
    },
    [
      state.analysisType,
      state.transportProfile,
      state.timeThresholds,
      state.distanceThresholds,
      state.originLabel,
      dispatch,
    ],
  );

  return { runAnalysis };
}