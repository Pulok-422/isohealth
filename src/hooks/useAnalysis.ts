import { useCallback } from 'react';
import { toast } from 'sonner';
import { useAppState } from '@/context/AppContext';
import { ApiError, fetchFacilities } from '@/lib/api';
import {
  getRoutingProvider,
  type RoutingProvider,
} from '@/services/routing';
import type {
  AnalysisResult,
  Facility,
  FacilityDataQuality,
  FacilityStatus,
  FacilityType,
  MatrixCoverage,
  ProviderAttempt,
  TransportProfile,
  TravelBand,
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

interface FacilityStageResult {
  facilityStatus: FacilityStatus;
  nearbyFacilities: Facility[];
  facilities: Facility[];
  nearestFacility: Facility | null;
  nearestByType: Partial<Record<FacilityType, Facility>>;
  facilityResultTruncated: boolean;
  facilityProvider?: string;
  facilityRequestId?: string;
  facilityAttempts: ProviderAttempt[];
  facilityErrorMessage?: string;
  matrixAvailable: boolean;
  matrixCoverage: MatrixCoverage;
  dataQuality: FacilityDataQuality;
  cumulativeCountsByBand: Record<string, number>;
  incrementalCountsByBand: Record<string, number>;
  warnings: string[];
}

interface MatrixChunkResult {
  batch: Facility[];
  durations?: Array<number | null>;
  distances?: Array<number | null>;
  error?: unknown;
}

function generateAnalysisId(): string {
  const identifier =
    typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : String(Date.now());

  return `an_${identifier}`;
}

function computeSearchRadiusMeters(
  originLat: number,
  originLon: number,
  geometry: GeoJSON.Geometry,
): number {
  const rawRadius =
    getMaximumGeometryRadiusMeters(
      originLat,
      originLon,
      geometry,
    ) + 1000;

  const roundedRadius =
    Math.ceil(rawRadius / 100) * 100;

  return Math.max(1000, roundedRadius);
}

function chunk<T>(
  items: T[],
  size: number,
): T[][] {
  const output: T[][] = [];

  for (
    let index = 0;
    index < items.length;
    index += size
  ) {
    output.push(
      items.slice(index, index + size),
    );
  }

  return output;
}

async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (
    item: T,
    index: number,
  ) => Promise<R>,
): Promise<R[]> {
  if (!items.length) {
    return [];
  }

  const results = new Array<R>(
    items.length,
  );

  let cursor = 0;

  const runners = new Array(
    Math.min(
      concurrency,
      items.length,
    ),
  )
    .fill(0)
    .map(async () => {
      while (true) {
        const index = cursor;
        cursor += 1;

        if (index >= items.length) {
          return;
        }

        results[index] = await worker(
          items[index],
          index,
        );
      }
    });

  await Promise.all(runners);

  return results;
}

function createEmptyDataQuality(
  possibleDuplicates = 0,
): FacilityDataQuality {
  return {
    total: 0,
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
    possibleDuplicates,
  };
}

function computeDataQuality(
  facilities: Facility[],
  possibleDuplicates: number,
): FacilityDataQuality {
  const quality =
    createEmptyDataQuality(
      possibleDuplicates,
    );

  quality.total = facilities.length;

  for (const facility of facilities) {
    const hasMappedName =
      Boolean(facility.tags?.name) ||
      Boolean(
        facility.tags?.['name:en'],
      );

    if (hasMappedName) {
      quality.withName += 1;
    } else {
      quality.withoutName += 1;
    }

    if (facility.operator) {
      quality.withOperator += 1;
    }

    if (facility.openingHours) {
      quality.withOpeningHours += 1;
    }

    if (facility.emergency) {
      quality.withEmergencyTag += 1;
    }

    if (facility.speciality) {
      quality.withSpeciality += 1;
    }

    if (
      facility.source === 'Uploaded'
    ) {
      quality.uploadedFacilities += 1;
    } else if (
      facility.osmType === 'node'
    ) {
      quality.osmNodes += 1;
    } else if (
      facility.osmType === 'way'
    ) {
      quality.osmWays += 1;
    } else if (
      facility.osmType === 'relation'
    ) {
      quality.osmRelations += 1;
    }
  }

  return quality;
}

function computeBandCounts(
  bands: Array<
    Pick<
      TravelBand,
      'index' | 'label'
    >
  >,
  facilities: Facility[],
) {
  const incremental: Record<
    string,
    number
  > = {};

  const cumulative: Record<
    string,
    number
  > = {};

  for (const band of bands) {
    incremental[band.label] = 0;
    cumulative[band.label] = 0;
  }

  for (const facility of facilities) {
    if (
      facility.minimumBandIndex == null
    ) {
      continue;
    }

    const ownBand =
      bands[
        facility.minimumBandIndex
      ];

    if (ownBand) {
      incremental[ownBand.label] =
        (incremental[
          ownBand.label
        ] || 0) + 1;
    }

    for (
      let index =
        facility.minimumBandIndex;
      index < bands.length;
      index += 1
    ) {
      const band = bands[index];

      cumulative[band.label] =
        (cumulative[
          band.label
        ] || 0) + 1;
    }
  }

  return {
    incremental,
    cumulative,
  };
}

function pickNearestByType(
  facilities: Facility[],
): Partial<
  Record<
    FacilityType,
    Facility
  >
> {
  const result: Partial<
    Record<
      FacilityType,
      Facility
    >
  > = {};

  const types: FacilityType[] = [
    'hospital',
    'clinic',
    'pharmacy',
    'doctors',
    'dentist',
    'laboratory',
    'healthcare',
  ];

  for (const type of types) {
    const candidates =
      facilities.filter(
        (facility) =>
          facility.type === type,
      );

    if (!candidates.length) {
      continue;
    }

    candidates.sort((a, b) => {
      const aDuration =
        a.matrixEvaluated &&
        a.travelDurationSeconds != null
          ? a.travelDurationSeconds
          : Number.POSITIVE_INFINITY;

      const bDuration =
        b.matrixEvaluated &&
        b.travelDurationSeconds != null
          ? b.travelDurationSeconds
          : Number.POSITIVE_INFINITY;

      if (
        aDuration !== bDuration
      ) {
        return (
          aDuration - bDuration
        );
      }

      return (
        a.straightLineDistanceMeters -
        b.straightLineDistanceMeters
      );
    });

    result[type] = candidates[0];
  }

  return result;
}

function pickOverallNearest(
  facilities: Facility[],
): Facility | null {
  const routed =
    facilities.filter(
      (facility) =>
        facility.matrixEvaluated &&
        facility.travelDurationSeconds !=
          null,
    );

  if (routed.length) {
    return routed.reduce(
      (nearest, facility) =>
        (facility.travelDurationSeconds ??
          Number.POSITIVE_INFINITY) <
        (nearest.travelDurationSeconds ??
          Number.POSITIVE_INFINITY)
          ? facility
          : nearest,
    );
  }

  if (!facilities.length) {
    return null;
  }

  return facilities.reduce(
    (nearest, facility) =>
      facility.straightLineDistanceMeters <
      nearest.straightLineDistanceMeters
        ? facility
        : nearest,
  );
}

function facilityUnavailableMessage(
  error: unknown,
): string {
  if (
    error instanceof ApiError &&
    error.status === 429
  ) {
    return 'The OpenStreetMap facility service is rate-limited. Please try again shortly.';
  }

  return 'The OpenStreetMap facility service is temporarily unavailable. The travel area was generated, but OSM facilities could not be loaded.';
}

async function enrichWithMatrix(
  provider: RoutingProvider,
  origin: {
    lat: number;
    lon: number;
  },
  profile: TransportProfile,
  reachableFacilities: Facility[],
): Promise<{
  facilities: Facility[];
  matrixAvailable: boolean;
  matrixCoverage: MatrixCoverage;
  warnings: string[];
}> {
  if (
    !reachableFacilities.length
  ) {
    return {
      facilities: [],
      matrixAvailable: false,
      matrixCoverage: {
        totalReachableFacilities: 0,
        evaluatedFacilities: 0,
        complete: true,
      },
      warnings: [],
    };
  }

  const matrixCandidates =
    reachableFacilities
      .slice()
      .sort(
        (a, b) =>
          a.straightLineDistanceMeters -
          b.straightLineDistanceMeters,
      )
      .slice(
        0,
        MAX_MATRIX_FACILITIES,
      );

  const groups = chunk(
    matrixCandidates,
    MATRIX_CHUNK_SIZE,
  );

  const chunkResults =
    await runWithConcurrency(
      groups,
      MATRIX_CONCURRENCY,
      async (
        batch,
      ): Promise<MatrixChunkResult> => {
        try {
          const response =
            await provider.computeMatrix(
              {
                origins: [origin],
                destinations:
                  batch.map(
                    (facility) => ({
                      lat: facility.lat,
                      lon: facility.lon,
                    }),
                  ),
                profile,
              },
            );

          return {
            batch,
            durations:
              response.durations[0] ||
              [],
            distances:
              response.distances[0] ||
              [],
          };
        } catch (error) {
          return {
            batch,
            error,
          };
        }
      },
    );

  const matrixMap = new Map<
    string,
    {
      durationSeconds:
        | number
        | null;
      distanceMeters:
        | number
        | null;
    }
  >();

  let successfulFacilities = 0;
  let failedChunks = 0;

  for (const result of chunkResults) {
    if (
      result.error ||
      !result.durations ||
      !result.distances
    ) {
      failedChunks += 1;
      continue;
    }

    result.batch.forEach(
      (facility, index) => {
        const duration =
          result.durations?.[index];

        const distance =
          result.distances?.[index];

        matrixMap.set(
          facility.id,
          {
            durationSeconds:
              typeof duration ===
                'number' &&
              Number.isFinite(
                duration,
              )
                ? duration
                : null,

            distanceMeters:
              typeof distance ===
                'number' &&
              Number.isFinite(
                distance,
              )
                ? distance
                : null,
          },
        );

        successfulFacilities += 1;
      },
    );
  }

  const matrixAvailable =
    successfulFacilities > 0;

  const warnings: string[] = [];

  if (!matrixAvailable) {
    warnings.push(
      'Facilities were loaded, but road-network travel times are temporarily unavailable.',
    );
  } else if (failedChunks > 0) {
    warnings.push(
      `Some road-network matrix requests failed. Metrics are available for ${successfulFacilities} of ${reachableFacilities.length} reachable facilities.`,
    );
  }

  if (
    matrixCandidates.length <
    reachableFacilities.length
  ) {
    warnings.push(
      `Road-network metrics were limited to the ${matrixCandidates.length} nearest facilities by straight-line distance.`,
    );
  }

  const enriched =
    reachableFacilities.map(
      (facility) => {
        const matrixValue =
          matrixMap.get(
            facility.id,
          );

        if (!matrixValue) {
          return {
            ...facility,
            matrixEvaluated: false,
          };
        }

        return {
          ...facility,
          matrixEvaluated: true,
          travelDurationSeconds:
            matrixValue.durationSeconds ??
            undefined,
          travelDistanceMeters:
            matrixValue.distanceMeters ??
            undefined,
        };
      },
    );

  return {
    facilities: enriched,
    matrixAvailable,
    matrixCoverage: {
      totalReachableFacilities:
        reachableFacilities.length,

      evaluatedFacilities:
        successfulFacilities,

      complete:
        successfulFacilities ===
          reachableFacilities.length &&
        failedChunks === 0,
    },
    warnings,
  };
}

async function runFacilityStage(
  params: {
    provider: RoutingProvider;
    lat: number;
    lon: number;
    radius: number;
    bands: TravelBand[];
    outerGeometry:
      GeoJSON.Geometry;
    profile: TransportProfile;
  },
): Promise<FacilityStageResult> {
  const {
    provider,
    lat,
    lon,
    radius,
    bands,
    outerGeometry,
    profile,
  } = params;

  let facilityResponse;

  try {
    facilityResponse =
      await fetchFacilities(
        lat,
        lon,
        radius,
      );
  } catch (error) {
    const message =
      facilityUnavailableMessage(
        error,
      );

    const apiError =
      error instanceof ApiError
        ? error
        : null;

    console.warn(
      'Facility retrieval failed',
      {
        message:
          error instanceof Error
            ? error.message
            : String(error),

        code: apiError?.code,

        requestId:
          apiError?.requestId,

        attempts:
          apiError?.attempts,
      },
    );

    return {
      facilityStatus:
        'unavailable',

      nearbyFacilities: [],

      facilities: [],

      nearestFacility: null,

      nearestByType: {},

      facilityResultTruncated:
        false,

      facilityRequestId:
        apiError?.requestId,

      facilityAttempts:
        apiError?.attempts || [],

      facilityErrorMessage:
        message,

      matrixAvailable: false,

      matrixCoverage: {
        totalReachableFacilities: 0,
        evaluatedFacilities: 0,
        complete: false,
      },

      dataQuality:
        createEmptyDataQuality(),

      cumulativeCountsByBand:
        Object.fromEntries(
          bands.map((band) => [
            band.label,
            0,
          ]),
        ),

      incrementalCountsByBand:
        Object.fromEntries(
          bands.map((band) => [
            band.label,
            0,
          ]),
        ),

      warnings: [message],
    };
  }

  const nearbyFacilities =
    facilityResponse.facilities.map(
      (facility) => {
        const classification =
          classifyFacilityIntoMinimumBand(
            facility,
            bands,
          );

        const insideOutermostIsochrone =
          pointInGeometry(
            [
              facility.lon,
              facility.lat,
            ],
            outerGeometry,
          );

        return {
          ...facility,
          ...classification,
          insideOutermostIsochrone,
          matrixEvaluated: false,
        };
      },
    );

  const reachableFacilities =
    nearbyFacilities.filter(
      (facility) =>
        facility.insideOutermostIsochrone,
    );

  const matrixResult =
    await enrichWithMatrix(
      provider,
      {
        lat,
        lon,
      },
      profile,
      reachableFacilities,
    );

  const nearestFacility =
    pickOverallNearest(
      matrixResult.facilities,
    );

  const nearestByType =
    pickNearestByType(
      matrixResult.facilities,
    );

  const {
    incremental,
    cumulative,
  } = computeBandCounts(
    bands,
    matrixResult.facilities,
  );

  const warnings = [
    ...matrixResult.warnings,
  ];

  if (
    facilityResponse.truncated
  ) {
    warnings.unshift(
      `Facility results were truncated to ${facilityResponse.facilities.length} nearest records.`,
    );
  }

  return {
    facilityStatus:
      nearbyFacilities.length
        ? 'success'
        : 'empty',

    nearbyFacilities,

    facilities:
      matrixResult.facilities,

    nearestFacility,

    nearestByType,

    facilityResultTruncated:
      facilityResponse.truncated,

    facilityProvider:
      facilityResponse.provider,

    facilityRequestId:
      facilityResponse.requestId,

    facilityAttempts:
      facilityResponse.attempts,

    matrixAvailable:
      matrixResult.matrixAvailable,

    matrixCoverage:
      matrixResult.matrixCoverage,

    dataQuality:
      computeDataQuality(
        nearbyFacilities,
        facilityResponse.possibleDuplicateCount,
      ),

    cumulativeCountsByBand:
      cumulative,

    incrementalCountsByBand:
      incremental,

    warnings,
  };
}

function showFacilityOutcome(
  result: FacilityStageResult,
): void {
  if (
    result.facilityStatus ===
    'unavailable'
  ) {
    toast.warning(
      'Facility service is temporarily unavailable — showing the travel area only.',
    );

    return;
  }

  if (
    result.facilityStatus ===
    'empty'
  ) {
    toast.warning(
      'No mapped healthcare facilities were found in OpenStreetMap within the facility-search extent.',
    );

    return;
  }

  if (
    !result.facilities.length
  ) {
    toast.warning(
      'Healthcare facilities were found near the selected location, but none fall inside the selected travel area.',
    );

    return;
  }

  toast.success(
    `Found ${result.facilities.length} healthcare facilities within the selected travel area.`,
  );

  if (
    !result.matrixAvailable
  ) {
    toast.warning(
      'Road-network travel times are temporarily unavailable.',
    );
  }
}

export function useAnalysis() {
  const {
    state,
    dispatch,
  } = useAppState();

  const runAnalysis =
    useCallback(
      async (
        lat: number,
        lon: number,
      ) => {
        if (
          !Number.isFinite(lat) ||
          lat < -90 ||
          lat > 90 ||
          !Number.isFinite(lon) ||
          lon < -180 ||
          lon > 180
        ) {
          toast.error(
            'Please choose a valid location before running the analysis.',
          );

          return;
        }

        const analysisType =
          state.analysisType;

        const profile:
          TransportProfile =
          state.transportProfile;

        const rawRanges =
          analysisType ===
          'distance'
            ? state.distanceThresholds
            : state.timeThresholds;

        const ranges =
          Array.from(
            new Set(
              rawRanges.filter(
                (value) =>
                  Number.isFinite(
                    value,
                  ) &&
                  value > 0,
              ),
            ),
          ).sort(
            (a, b) => a - b,
          );

        if (!ranges.length) {
          toast.error(
            'Select at least one travel range.',
          );

          return;
        }

        dispatch({
          type:
            'SET_ANALYSIS_POINT',
          payload: [lat, lon],
        });

        dispatch({
          type: 'SET_ANALYZING',
          payload: true,
        });

        dispatch({
          type:
            'SET_ANALYSIS_ERROR',
          payload: null,
        });

        dispatch({
          type:
            'SET_ANALYSIS_RESULT',
          payload: null,
        });

        dispatch({
          type: 'SET_FACILITIES',
          payload: [],
        });

        const provider =
          getRoutingProvider();

        try {
          const isochrones =
            await provider.generateIsochrones(
              {
                origin: {
                  lat,
                  lon,
                },

                profile,

                rangeType:
                  analysisType,

                ranges,
              },
            );

          const bands =
            sortIsochroneBands(
              isochrones,
              analysisType,
            );

          const outerFeature =
            getOutermostIsochroneFeature(
              isochrones,
            );

          if (
            !bands.length ||
            !outerFeature?.geometry
          ) {
            throw new ApiError(
              'The travel-area service returned no usable polygons.',
              {
                code:
                  'ISOCHRONE_UNAVAILABLE',
              },
            );
          }

          const radius =
            computeSearchRadiusMeters(
              lat,
              lon,
              outerFeature.geometry,
            );

          if (radius > 50_000) {
            throw new ApiError(
              'The selected travel range creates an area larger than the supported facility-search extent. Reduce the time or distance range.',
              {
                code:
                  'ANALYSIS_TOO_LARGE',
              },
            );
          }

          const facilityStage =
            await runFacilityStage(
              {
                provider,
                lat,
                lon,
                radius,
                bands,

                outerGeometry:
                  outerFeature.geometry,

                profile,
              },
            );

          const result:
            AnalysisResult = {
            analysisId:
              generateAnalysisId(),

            analysisDate:
              new Date().toISOString(),

            origin: {
              lat,
              lon,

              label:
                state.originLabel ||
                undefined,
            },

            isochrones,

            bands,

            facilities:
              facilityStage.facilities,

            nearbyFacilities:
              facilityStage.nearbyFacilities,

            nearestFacility:
              facilityStage.nearestFacility,

            nearestByType:
              facilityStage.nearestByType,

            profileUsed: profile,

            analysisTypeUsed:
              analysisType,

            rangesUsed: ranges,

            facilitySourceMode:
              'osm',

            facilityStatus:
              facilityStage.facilityStatus,

            facilityQueryRadiusMeters:
              radius,

            facilityResultTruncated:
              facilityStage.facilityResultTruncated,

            facilityProvider:
              facilityStage.facilityProvider,

            facilityRequestId:
              facilityStage.facilityRequestId,

            facilityAttempts:
              facilityStage.facilityAttempts,

            facilityErrorMessage:
              facilityStage.facilityErrorMessage,

            matrixAvailable:
              facilityStage.matrixAvailable,

            matrixCoverage:
              facilityStage.matrixCoverage,

            dataQuality:
              facilityStage.dataQuality,

            cumulativeCountsByBand:
              facilityStage.cumulativeCountsByBand,

            incrementalCountsByBand:
              facilityStage.incrementalCountsByBand,

            warnings:
              facilityStage.warnings,
          };

          dispatch({
            type: 'SET_FACILITIES',
            payload:
              facilityStage.facilities,
          });

          dispatch({
            type:
              'SET_ANALYSIS_RESULT',
            payload: result,
          });

          showFacilityOutcome(
            facilityStage,
          );
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : String(error);

          console.error(
            'Analysis error:',
            error,
          );

          dispatch({
            type:
              'SET_ANALYSIS_ERROR',
            payload: message,
          });

          dispatch({
            type:
              'SET_ANALYSIS_RESULT',
            payload: null,
          });

          dispatch({
            type: 'SET_FACILITIES',
            payload: [],
          });

          toast.error(
            `Analysis failed: ${message}`,
          );
        } finally {
          dispatch({
            type: 'SET_ANALYZING',
            payload: false,
          });
        }
      },
      [
        dispatch,
        state.analysisType,
        state.distanceThresholds,
        state.originLabel,
        state.timeThresholds,
        state.transportProfile,
      ],
    );

  const retryFacilities =
    useCallback(async () => {
      const current =
        state.analysisResult;

      if (!current) {
        toast.error(
          'Run an analysis before retrying facilities.',
        );

        return;
      }

      const outerFeature =
        getOutermostIsochroneFeature(
          current.isochrones,
        );

      if (
        !outerFeature?.geometry
      ) {
        toast.error(
          'The existing analysis has no usable outer travel polygon.',
        );

        return;
      }

      dispatch({
        type: 'SET_ANALYZING',
        payload: true,
      });

      dispatch({
        type:
          'SET_ANALYSIS_ERROR',
        payload: null,
      });

      try {
        const facilityStage =
          await runFacilityStage({
            provider:
              getRoutingProvider(),

            lat: current.origin.lat,

            lon: current.origin.lon,

            radius:
              current.facilityQueryRadiusMeters,

            bands: current.bands,

            outerGeometry:
              outerFeature.geometry,

            profile:
              current.profileUsed,
          });

        const updated:
          AnalysisResult = {
          ...current,

          analysisDate:
            new Date().toISOString(),

          facilities:
            facilityStage.facilities,

          nearbyFacilities:
            facilityStage.nearbyFacilities,

          nearestFacility:
            facilityStage.nearestFacility,

          nearestByType:
            facilityStage.nearestByType,

          facilityStatus:
            facilityStage.facilityStatus,

          facilityResultTruncated:
            facilityStage.facilityResultTruncated,

          facilityProvider:
            facilityStage.facilityProvider,

          facilityRequestId:
            facilityStage.facilityRequestId,

          facilityAttempts:
            facilityStage.facilityAttempts,

          facilityErrorMessage:
            facilityStage.facilityErrorMessage,

          matrixAvailable:
            facilityStage.matrixAvailable,

          matrixCoverage:
            facilityStage.matrixCoverage,

          dataQuality:
            facilityStage.dataQuality,

          cumulativeCountsByBand:
            facilityStage.cumulativeCountsByBand,

          incrementalCountsByBand:
            facilityStage.incrementalCountsByBand,

          warnings:
            facilityStage.warnings,
        };

        dispatch({
          type: 'SET_FACILITIES',
          payload:
            facilityStage.facilities,
        });

        dispatch({
          type:
            'SET_ANALYSIS_RESULT',
          payload: updated,
        });

        showFacilityOutcome(
          facilityStage,
        );
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : String(error);

        console.error(
          'Facility retry failed:',
          error,
        );

        dispatch({
          type:
            'SET_ANALYSIS_ERROR',
          payload: message,
        });

        toast.error(
          `Facility retry failed: ${message}`,
        );
      } finally {
        dispatch({
          type: 'SET_ANALYZING',
          payload: false,
        });
      }
    }, [
      dispatch,
      state.analysisResult,
    ]);

  return {
    runAnalysis,
    retryFacilities,
  };
}
