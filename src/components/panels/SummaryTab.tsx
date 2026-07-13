import {
  AlertTriangle,
  Building2,
  Clock,
  Info,
  MapPin,
  RefreshCw,
} from 'lucide-react';
import {
  useMemo,
  useState,
} from 'react';
import { Button } from '@/components/ui/button';
import { useAppState } from '@/context/AppContext';
import { useAnalysis } from '@/hooks/useAnalysis';
import { ROUTING_PROVIDER_LABEL } from '@/services/routing';
import type {
  Facility,
  FacilityType,
  TransportProfile,
} from '@/types/health';

function formatMeters(
  value?: number | null,
) {
  if (
    value == null ||
    !Number.isFinite(value)
  ) {
    return null;
  }

  return value < 1000
    ? `${Math.round(value)} m`
    : `${(value / 1000).toFixed(1)} km`;
}

function formatSeconds(
  value?: number | null,
) {
  if (
    value == null ||
    !Number.isFinite(value)
  ) {
    return null;
  }

  const minutes =
    Math.round(value / 60);

  if (minutes < 60) {
    return `${minutes} min`;
  }

  const hours =
    Math.floor(minutes / 60);

  const remainder =
    minutes % 60;

  return remainder
    ? `${hours}h ${remainder}m`
    : `${hours}h`;
}

const MODE_LABEL: Record<
  TransportProfile,
  string
> = {
  'foot-walking': 'walking',
  'cycling-regular': 'cycling',
  'driving-car': 'driving',
};

const TYPE_LABEL: Record<
  FacilityType,
  string
> = {
  hospital: 'Hospital',
  clinic: 'Clinic',
  pharmacy: 'Pharmacy',
  doctors: 'Doctor',
  dentist: 'Dentist',
  laboratory: 'Laboratory',
  healthcare: 'Healthcare',
};

function KPI({
  label,
  value,
  subtitle,
  icon: Icon,
}: {
  label: string;
  value: string | number;
  subtitle?: string;
  icon: typeof Building2;
}) {
  return (
    <div className="data-card">
      <div className="flex items-center gap-2">
        <Icon className="w-4 h-4 text-primary" />

        <span className="kpi-label">
          {label}
        </span>
      </div>

      <div className="kpi-value text-primary">
        {value}
      </div>

      {subtitle && (
        <div className="text-[10px] text-muted-foreground mt-0.5">
          {subtitle}
        </div>
      )}
    </div>
  );
}

function NearestRow({
  facility,
  label,
}: {
  facility: Facility;
  label: string;
}) {
  const roadTime =
    formatSeconds(
      facility.travelDurationSeconds,
    );

  const roadDistance =
    formatMeters(
      facility.travelDistanceMeters,
    );

  const straightDistance =
    formatMeters(
      facility.straightLineDistanceMeters,
    );

  return (
    <div className="flex items-start justify-between gap-2 py-1.5 border-b border-border/50 last:border-0">
      <div className="min-w-0">
        <div className="text-xs font-medium text-muted-foreground">
          {label}
        </div>

        <div className="text-sm font-medium truncate">
          {facility.name}
        </div>
      </div>

      <div className="text-right shrink-0 text-[11px]">
        {roadTime ? (
          <div className="font-medium">
            {roadTime}
          </div>
        ) : (
          <div className="text-muted-foreground">
            Road time unavailable
          </div>
        )}

        {roadDistance && (
          <div className="text-muted-foreground">
            {roadDistance} road
          </div>
        )}

        {straightDistance && (
          <div className="text-muted-foreground">
            {straightDistance} straight
          </div>
        )}
      </div>
    </div>
  );
}

export function SummaryTab() {
  const {
    state,
  } = useAppState();

  const {
    retryFacilities,
  } = useAnalysis();

  const result =
    state.analysisResult;

  const [
    showMethod,
    setShowMethod,
  ] = useState(false);

  const facilityTypeCounts =
    useMemo(() => {
      if (!result) {
        return {} as Record<
          string,
          number
        >;
      }

      return result.facilities.reduce<
        Record<string, number>
      >(
        (
          counts,
          facility,
        ) => {
          counts[facility.type] =
            (counts[
              facility.type
            ] || 0) + 1;

          return counts;
        },
        {},
      );
    }, [result]);

  if (!result) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center space-y-4 p-6">
        <MapPin className="w-12 h-12 text-muted-foreground/30" />

        <div>
          <h3 className="text-sm font-medium text-foreground">
            No analysis yet
          </h3>

          <p className="text-xs text-muted-foreground mt-1">
            Select a location on
            the map or search for a
            place, then click{' '}
            <strong>
              Analyze
            </strong>{' '}
            to see reachable
            healthcare facilities.
          </p>
        </div>
      </div>
    );
  }

  const modeLabel =
    MODE_LABEL[
      result.profileUsed
    ];

  const maxRange =
    Math.max(
      ...result.rangesUsed,
    );

  const rangeText =
    result.analysisTypeUsed ===
    'time'
      ? `${Math.round(maxRange / 60)}-minute ${modeLabel} area`
      : `${(maxRange / 1000).toFixed(1)} km ${modeLabel} area`;

  let headline: string;

  if (
    result.facilityStatus ===
    'unavailable'
  ) {
    headline =
      'The travel area was generated, but OpenStreetMap facility data is currently unavailable.';
  } else if (
    result.facilityStatus ===
    'empty'
  ) {
    headline =
      'No mapped healthcare facilities were returned from OpenStreetMap for the facility-search extent.';
  } else if (
    !result.facilities.length
  ) {
    headline =
      'Healthcare facilities were found nearby, but none fall inside the selected travel area.';
  } else {
    headline =
      `${result.facilities.length} healthcare facilit${
        result.facilities.length === 1
          ? 'y falls'
          : 'ies fall'
      } within the selected ${rangeText}.`;
  }

  const distinctTypes =
    Object.keys(
      facilityTypeCounts,
    ).length;

  const nearestSeconds =
    result.nearestFacility
      ?.travelDurationSeconds;

  const facilityUnavailable =
    result.facilityStatus ===
    'unavailable';

  return (
    <div className="space-y-3 p-3">
      <div
        className={`p-3 rounded-lg border ${
          facilityUnavailable
            ? 'bg-amber-500/5 border-amber-500/30'
            : 'bg-primary/5 border-primary/10'
        }`}
      >
        <p className="text-xs font-medium text-foreground leading-relaxed">
          {headline}
        </p>

        {facilityUnavailable && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="mt-2 h-7 gap-1.5 text-xs"
            disabled={
              state.isAnalyzing
            }
            onClick={() =>
              void retryFacilities()
            }
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${
                state.isAnalyzing
                  ? 'animate-spin'
                  : ''
              }`}
            />

            Retry facilities
          </Button>
        )}

        {!facilityUnavailable &&
          result.facilities.length >
            0 &&
          !result.matrixAvailable && (
            <p className="text-[11px] text-muted-foreground mt-1">
              Road-network travel
              time and distance are
              temporarily
              unavailable.
            </p>
          )}

        {result.matrixAvailable &&
          !result.matrixCoverage
            .complete && (
            <p className="text-[11px] text-muted-foreground mt-1">
              Road-network metrics
              were evaluated for{' '}
              {
                result
                  .matrixCoverage
                  .evaluatedFacilities
              }{' '}
              of{' '}
              {
                result
                  .matrixCoverage
                  .totalReachableFacilities
              }{' '}
              reachable facilities.
            </p>
          )}
      </div>

      {result.warnings.length >
        0 && (
        <div className="p-2.5 rounded-lg border border-amber-500/30 bg-amber-500/5 space-y-1">
          {result.warnings.map(
            (
              warning,
              index,
            ) => (
              <div
                key={`${warning}-${index}`}
                className="flex items-start gap-2 text-[11px] text-foreground/80"
              >
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-500" />

                <span>
                  {warning}
                </span>
              </div>
            ),
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <KPI
          icon={Building2}
          label="Reachable facilities"
          value={
            facilityUnavailable
              ? 'Unavailable'
              : result.facilities
                  .length
          }
          subtitle={
            facilityUnavailable
              ? 'Provider request failed'
              : `in ${rangeText}`
          }
        />

        <KPI
          icon={MapPin}
          label="Nearby queried"
          value={
            facilityUnavailable
              ? 'Unavailable'
              : result
                  .nearbyFacilities
                  .length
          }
          subtitle={`Search radius: ${
            formatMeters(
              result.facilityQueryRadiusMeters,
            ) || '—'
          }`}
        />

        <KPI
          icon={Info}
          label="Distinct types"
          value={
            facilityUnavailable
              ? 'Unavailable'
              : distinctTypes
          }
        />

        <KPI
          icon={Clock}
          label="Nearest road time"
          value={
            facilityUnavailable
              ? 'Unavailable'
              : formatSeconds(
                    nearestSeconds,
                  ) || '—'
          }
          subtitle={
            facilityUnavailable
              ? 'Facility data unavailable'
              : result.facilities
                    .length >
                    0 &&
                  !result.matrixAvailable
                ? 'Matrix unavailable'
                : undefined
          }
        />
      </div>

      {!facilityUnavailable && (
        <div className="data-card">
          <span className="kpi-label">
            Travel bands
          </span>

          <div className="mt-2 space-y-1">
            <div className="grid grid-cols-3 gap-2 text-[10px] font-semibold text-muted-foreground uppercase">
              <span>
                Band
              </span>

              <span className="text-right">
                In band
              </span>

              <span className="text-right">
                Cumulative
              </span>
            </div>

            {result.bands.map(
              (band) => (
                <div
                  key={band.index}
                  className="grid grid-cols-3 gap-2 text-xs"
                >
                  <span>
                    {band.label}
                  </span>

                  <span className="text-right font-medium">
                    {
                      result
                        .incrementalCountsByBand[
                        band.label
                      ] ?? 0
                    }
                  </span>

                  <span className="text-right text-muted-foreground">
                    {
                      result
                        .cumulativeCountsByBand[
                        band.label
                      ] ?? 0
                    }
                  </span>
                </div>
              ),
            )}
          </div>
        </div>
      )}

      {result.nearestFacility && (
        <div className="data-card space-y-1">
          <span className="kpi-label">
            Nearest facility
          </span>

          <NearestRow
            facility={
              result.nearestFacility
            }
            label={
              result.nearestFacility
                .travelDurationSeconds !=
              null
                ? result.matrixCoverage
                    .complete
                  ? 'Overall nearest by road time'
                  : 'Nearest by road time among evaluated facilities'
                : 'Nearest by straight-line distance'
            }
          />
        </div>
      )}

      {Object.keys(
        result.nearestByType,
      ).length > 0 && (
        <div className="data-card space-y-1">
          <span className="kpi-label">
            Nearest by type
          </span>

          {(
            Object.entries(
              result.nearestByType,
            ) as [
              FacilityType,
              Facility,
            ][]
          ).map(
            ([
              type,
              facility,
            ]) => (
              <NearestRow
                key={type}
                facility={
                  facility
                }
                label={
                  TYPE_LABEL[
                    type
                  ] || type
                }
              />
            ),
          )}
        </div>
      )}

      {!facilityUnavailable && (
        <div className="data-card">
          <span className="kpi-label">
            Data quality
          </span>

          <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            <div>
              Total:{' '}
              <span className="text-foreground">
                {
                  result
                    .dataQuality
                    .total
                }
              </span>
            </div>

            <div>
              Named:{' '}
              <span className="text-foreground">
                {
                  result
                    .dataQuality
                    .withName
                }
              </span>
            </div>

            <div>
              Unnamed:{' '}
              <span className="text-foreground">
                {
                  result
                    .dataQuality
                    .withoutName
                }
              </span>
            </div>

            <div>
              With operator:{' '}
              <span className="text-foreground">
                {
                  result
                    .dataQuality
                    .withOperator
                }
              </span>
            </div>

            <div>
              With hours:{' '}
              <span className="text-foreground">
                {
                  result
                    .dataQuality
                    .withOpeningHours
                }
              </span>
            </div>

            <div>
              Emergency tag:{' '}
              <span className="text-foreground">
                {
                  result
                    .dataQuality
                    .withEmergencyTag
                }
              </span>
            </div>

            <div>
              OSM nodes:{' '}
              <span className="text-foreground">
                {
                  result
                    .dataQuality
                    .osmNodes
                }
              </span>
            </div>

            <div>
              OSM ways:{' '}
              <span className="text-foreground">
                {
                  result
                    .dataQuality
                    .osmWays
                }
              </span>
            </div>

            <div>
              OSM relations:{' '}
              <span className="text-foreground">
                {
                  result
                    .dataQuality
                    .osmRelations
                }
              </span>
            </div>

            <div>
              Possible duplicates:{' '}
              <span className="text-foreground">
                {
                  result
                    .dataQuality
                    .possibleDuplicates
                }
              </span>
            </div>
          </div>
        </div>
      )}

      <div className="data-card">
        <button
          type="button"
          onClick={() =>
            setShowMethod(
              (visible) =>
                !visible,
            )
          }
          className="w-full flex items-center justify-between text-left"
          aria-expanded={
            showMethod
          }
        >
          <span className="kpi-label">
            Methodology and
            diagnostics
          </span>

          <span className="text-xs text-muted-foreground">
            {showMethod
              ? 'Hide'
              : 'Show'}
          </span>
        </button>

        {showMethod && (
          <div className="mt-2 space-y-1 text-[11px] text-muted-foreground break-words">
            <div>
              Analysis date:{' '}
              {new Date(
                result.analysisDate,
              ).toLocaleString()}
            </div>

            <div>
              Origin:{' '}
              {result.origin.lat.toFixed(
                5,
              )}
              ,{' '}
              {result.origin.lon.toFixed(
                5,
              )}
              {result.origin.label
                ? ` (${result.origin.label})`
                : ''}
            </div>

            <div>
              Routing provider:{' '}
              {
                ROUTING_PROVIDER_LABEL
              }
            </div>

            <div>
              Transport profile:{' '}
              {result.profileUsed}
            </div>

            <div>
              Analysis type:{' '}
              {
                result.analysisTypeUsed
              }
            </div>

            <div>
              Ranges:{' '}
              {result.rangesUsed.join(
                ', ',
              )}{' '}
              {result.analysisTypeUsed ===
              'time'
                ? 's'
                : 'm'}
            </div>

            <div>
              Facility status:{' '}
              {
                result.facilityStatus
              }
            </div>

            <div>
              Facility provider:{' '}
              {result.facilityProvider ||
                'Unavailable'}
            </div>

            <div>
              Facility request ID:{' '}
              {result.facilityRequestId ||
                'Unavailable'}
            </div>

            <div>
              Facility query
              radius:{' '}
              {formatMeters(
                result.facilityQueryRadiusMeters,
              ) || '—'}
            </div>

            <div>
              Matrix evaluated:{' '}
              {
                result
                  .matrixCoverage
                  .evaluatedFacilities
              }{' '}
              of{' '}
              {
                result
                  .matrixCoverage
                  .totalReachableFacilities
              }
            </div>

            {result.facilityAttempts
              .length > 0 && (
              <div className="pt-1">
                <div className="font-medium text-foreground">
                  Provider attempts
                </div>

                {result.facilityAttempts.map(
                  (
                    attempt,
                    index,
                  ) => (
                    <div
                      key={`${attempt.provider}-${index}`}
                    >
                      {
                        attempt.provider
                      }
                      :{' '}
                      {
                        attempt.outcome
                      }
                      {attempt.status
                        ? ` (HTTP ${attempt.status})`
                        : ''}
                      ,{' '}
                      {
                        attempt.durationMs
                      }{' '}
                      ms
                      {attempt.message
                        ? `, ${attempt.message}`
                        : ''}
                    </div>
                  ),
                )}
              </div>
            )}

            <p className="pt-1">
              Facilities were
              assigned to the
              smallest travel-area
              polygon containing
              their coordinates.
              Road travel times and
              distances were
              calculated using{' '}
              {
                ROUTING_PROVIDER_LABEL
              }{' '}
              where matrix results
              were available.
              Straight-line
              distance was
              calculated
              geometrically and was
              not used as a
              substitute for road
              travel time.
            </p>
          </div>
        )}
      </div>

      <div className="text-[10px] text-muted-foreground space-y-0.5 pt-2 border-t border-border">
        <p>
          Facility data:
          OpenStreetMap
          contributors via
          Overpass API.
        </p>

        <p>
          Travel areas and
          road-network metrics:{' '}
          {
            ROUTING_PROVIDER_LABEL
          }
          .
        </p>

        <p>
          Results depend on the
          completeness of the
          source facility and
          road-network data.
        </p>
      </div>
    </div>
  );
}
