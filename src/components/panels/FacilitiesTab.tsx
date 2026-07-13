import {
  useMemo,
  useState,
} from 'react';
import {
  AlertTriangle,
  MapPin,
  RefreshCw,
  Search,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAppState } from '@/context/AppContext';
import { useAnalysis } from '@/hooks/useAnalysis';
import type {
  Facility,
  FacilityType,
} from '@/types/health';

const typeColors: Record<
  string,
  string
> = {
  hospital:
    'bg-destructive/20 text-destructive',

  clinic:
    'bg-primary/20 text-primary',

  pharmacy:
    'bg-chart-purple/20 text-chart-purple',

  doctors:
    'bg-success/20 text-success',

  dentist:
    'bg-accent/20 text-accent',

  laboratory:
    'bg-secondary text-secondary-foreground',

  healthcare:
    'bg-secondary text-secondary-foreground',
};

type SortKey =
  | 'roadTime'
  | 'roadDistance'
  | 'straightLine'
  | 'name'
  | 'type'
  | 'band';

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

function compareOptionalNumbers(
  a?: number,
  b?: number,
) {
  return (
    (a ??
      Number.POSITIVE_INFINITY) -
    (b ??
      Number.POSITIVE_INFINITY)
  );
}

export function FacilitiesTab() {
  const {
    state,
  } = useAppState();

  const {
    retryFacilities,
  } = useAnalysis();

  const [
    search,
    setSearch,
  ] = useState('');

  const [
    typeFilter,
    setTypeFilter,
  ] =
    useState<FacilityType | null>(
      null,
    );

  const [
    sortKey,
    setSortKey,
  ] =
    useState<SortKey>(
      'roadTime',
    );

  const result =
    state.analysisResult;

  const facilities =
    state.facilities;

  const filtered = useMemo(() => {
    const query =
      search
        .trim()
        .toLowerCase();

    const list =
      facilities.filter(
        (facility) => {
          if (
            typeFilter &&
            facility.type !==
              typeFilter
          ) {
            return false;
          }

          if (
            query &&
            !facility.name
              .toLowerCase()
              .includes(query)
          ) {
            return false;
          }

          return true;
        },
      );

    list.sort((a, b) => {
      switch (sortKey) {
        case 'roadTime':
          return compareOptionalNumbers(
            a.travelDurationSeconds,
            b.travelDurationSeconds,
          );

        case 'roadDistance':
          return compareOptionalNumbers(
            a.travelDistanceMeters,
            b.travelDistanceMeters,
          );

        case 'straightLine':
          return (
            a.straightLineDistanceMeters -
            b.straightLineDistanceMeters
          );

        case 'name':
          return a.name.localeCompare(
            b.name,
          );

        case 'type':
          return a.type.localeCompare(
            b.type,
          );

        case 'band':
          return compareOptionalNumbers(
            a.minimumBandIndex,
            b.minimumBandIndex,
          );

        default:
          return 0;
      }
    });

    return list;
  }, [
    facilities,
    search,
    sortKey,
    typeFilter,
  ]);

  const typeCounts =
    useMemo(() => {
      const counts: Partial<
        Record<
          FacilityType,
          number
        >
      > = {};

      for (
        const facility of facilities
      ) {
        counts[facility.type] =
          (counts[
            facility.type
          ] || 0) + 1;
      }

      return counts;
    }, [facilities]);

  if (!result) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center space-y-4 p-6">
        <MapPin className="w-12 h-12 text-muted-foreground/30" />

        <div>
          <h3 className="text-sm font-medium text-foreground">
            No health
            facilities yet
          </h3>

          <p className="text-xs text-muted-foreground mt-1">
            Select a location and
            run an analysis to see
            reachable healthcare
            facilities.
          </p>
        </div>
      </div>
    );
  }

  if (
    result.facilityStatus ===
    'unavailable'
  ) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center space-y-3 p-6">
        <AlertTriangle className="w-10 h-10 text-amber-500" />

        <div>
          <h3 className="text-sm font-medium text-foreground">
            Facility service
            unavailable
          </h3>

          <p className="text-xs text-muted-foreground mt-1">
            The travel area was
            generated, but
            OpenStreetMap
            facilities could not
            be loaded. This is not
            a zero-facility
            result.
          </p>

          {result.facilityRequestId && (
            <p className="text-[10px] text-muted-foreground mt-1 font-mono break-all">
              Request ID:{' '}
              {
                result.facilityRequestId
              }
            </p>
          )}
        </div>

        <Button
          type="button"
          size="sm"
          variant="outline"
          className="gap-1.5"
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
      </div>
    );
  }

  if (
    result.facilityStatus ===
    'empty'
  ) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center space-y-4 p-6">
        <MapPin className="w-12 h-12 text-muted-foreground/30" />

        <div>
          <h3 className="text-sm font-medium text-foreground">
            No mapped
            facilities returned
          </h3>

          <p className="text-xs text-muted-foreground mt-1">
            The OpenStreetMap
            query completed
            successfully, but
            returned no healthcare
            facilities within the
            facility-search
            extent.
          </p>
        </div>
      </div>
    );
  }

  if (
    facilities.length === 0
  ) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center space-y-4 p-6">
        <MapPin className="w-12 h-12 text-muted-foreground/30" />

        <div>
          <h3 className="text-sm font-medium text-foreground">
            No facilities inside
            the travel area
          </h3>

          <p className="text-xs text-muted-foreground mt-1">
            Facilities were found
            near the origin, but
            none fall inside the
            selected isochrone.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3 p-3">
      {!result.matrixAvailable && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-2.5 text-[11px]">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-500" />

          <span>
            Facilities are
            available, but
            road-network time and
            distance could not be
            calculated.
            Straight-line
            distance is shown
            separately.
          </span>
        </div>
      )}

      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />

        <input
          type="text"
          placeholder="Filter facilities..."
          value={search}
          onChange={(event) =>
            setSearch(
              event.target.value,
            )
          }
          aria-label="Filter facilities"
          className="w-full h-8 pl-8 pr-3 bg-secondary/50 border border-border rounded-md text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
        />
      </div>

      <div className="flex flex-wrap gap-1">
        <button
          type="button"
          onClick={() =>
            setTypeFilter(null)
          }
          className={`px-2 py-1 rounded text-xs transition-colors ${
            !typeFilter
              ? 'bg-primary/15 text-primary'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          All (
          {facilities.length})
        </button>

        {(
          Object.entries(
            typeCounts,
          ) as [
            FacilityType,
            number,
          ][]
        ).map(
          ([
            type,
            count,
          ]) => (
            <button
              key={type}
              type="button"
              onClick={() =>
                setTypeFilter(
                  typeFilter === type
                    ? null
                    : type,
                )
              }
              className={`px-2 py-1 rounded text-xs capitalize transition-colors ${
                typeFilter === type
                  ? 'bg-primary/15 text-primary'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {type} ({count})
            </button>
          ),
        )}
      </div>

      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <label htmlFor="facility-sort">
          Sort by
        </label>

        <select
          id="facility-sort"
          value={sortKey}
          onChange={(event) =>
            setSortKey(
              event.target
                .value as SortKey,
            )
          }
          className="h-7 bg-secondary/50 border border-border rounded px-2 text-xs"
        >
          <option value="roadTime">
            Road travel time
          </option>

          <option value="roadDistance">
            Road distance
          </option>

          <option value="straightLine">
            Straight-line
            distance
          </option>

          <option value="name">
            Name
          </option>

          <option value="type">
            Type
          </option>

          <option value="band">
            Travel band
          </option>
        </select>
      </div>

      <div className="space-y-1.5">
        {filtered
          .slice(0, 100)
          .map(
            (
              facility: Facility,
            ) => {
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
                <div
                  key={
                    facility.id
                  }
                  className="data-card p-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">
                        {
                          facility.name
                        }
                      </div>

                      <div className="text-[11px] text-muted-foreground mt-0.5 truncate">
                        {
                          facility.source
                        }

                        {facility.osmType
                          ? ` · ${facility.osmType}/${facility.osmId}`
                          : ''}

                        {facility.minimumBandLabel
                          ? ` · ${facility.minimumBandLabel}`
                          : ''}
                      </div>

                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px]">
                        {roadTime && (
                          <span className="text-foreground">
                            {
                              roadTime
                            }{' '}
                            road
                          </span>
                        )}

                        {roadDistance && (
                          <span className="text-muted-foreground">
                            {
                              roadDistance
                            }{' '}
                            road
                          </span>
                        )}

                        {straightDistance && (
                          <span className="text-muted-foreground">
                            {
                              straightDistance
                            }{' '}
                            straight
                          </span>
                        )}

                        {!facility.matrixEvaluated && (
                          <span className="text-amber-600">
                            Matrix not
                            evaluated
                          </span>
                        )}
                      </div>

                      <div className="text-[10px] font-mono text-muted-foreground mt-0.5">
                        {facility.lat.toFixed(
                          4,
                        )}
                        ,{' '}
                        {facility.lon.toFixed(
                          4,
                        )}
                      </div>
                    </div>

                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] font-medium capitalize whitespace-nowrap ${
                        typeColors[
                          facility
                            .type
                        ] ||
                        'bg-secondary text-secondary-foreground'
                      }`}
                    >
                      {
                        facility.type
                      }
                    </span>
                  </div>
                </div>
              );
            },
          )}

        {filtered.length ===
          0 && (
          <div className="text-center text-xs text-muted-foreground py-8">
            No facilities match
            the current filter.
          </div>
        )}

        {filtered.length >
          100 && (
          <div className="text-center text-xs text-muted-foreground py-2">
            Showing 100 of{' '}
            {filtered.length}{' '}
            facilities
          </div>
        )}
      </div>
    </div>
  );
}
