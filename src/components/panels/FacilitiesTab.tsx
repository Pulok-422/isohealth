import { useMemo, useState } from 'react';
import { useAppState } from '@/context/AppContext';
import { Search, MapPin } from 'lucide-react';
import type { Facility, FacilityType } from '@/types/health';

const typeColors: Record<string, string> = {
  hospital: 'bg-destructive/20 text-destructive',
  clinic: 'bg-primary/20 text-primary',
  pharmacy: 'bg-chart-purple/20 text-chart-purple',
  doctors: 'bg-success/20 text-success',
  dentist: 'bg-accent/20 text-accent',
  laboratory: 'bg-secondary text-secondary-foreground',
  healthcare: 'bg-secondary text-secondary-foreground',
};

type SortKey = 'roadTime' | 'roadDistance' | 'straightLine' | 'name' | 'type' | 'band';

function formatMeters(m?: number | null) {
  if (m == null || !Number.isFinite(m)) return null;
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
}
function formatSeconds(s?: number | null) {
  if (s == null || !Number.isFinite(s)) return null;
  const mins = Math.round(s / 60);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const r = mins % 60;
  return r ? `${h}h ${r}m` : `${h}h`;
}

export function FacilitiesTab() {
  const { state } = useAppState();
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<FacilityType | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('roadTime');

  const facilities = state.facilities;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = facilities.filter((f) => {
      if (typeFilter && f.type !== typeFilter) return false;
      if (q && !f.name.toLowerCase().includes(q)) return false;
      return true;
    });
    const cmpMaybe = (a?: number, b?: number) =>
      (a ?? Number.POSITIVE_INFINITY) - (b ?? Number.POSITIVE_INFINITY);
    list.sort((a, b) => {
      switch (sortKey) {
        case 'roadTime': return cmpMaybe(a.travelDurationSeconds, b.travelDurationSeconds);
        case 'roadDistance': return cmpMaybe(a.travelDistanceMeters, b.travelDistanceMeters);
        case 'straightLine': return a.straightLineDistanceMeters - b.straightLineDistanceMeters;
        case 'name': return a.name.localeCompare(b.name);
        case 'type': return a.type.localeCompare(b.type);
        case 'band': return cmpMaybe(a.minimumBandIndex, b.minimumBandIndex);
        default: return 0;
      }
    });
    return list;
  }, [facilities, search, typeFilter, sortKey]);

  const typeCounts = useMemo(() => {
    const c: Partial<Record<FacilityType, number>> = {};
    for (const f of facilities) c[f.type] = (c[f.type] || 0) + 1;
    return c;
  }, [facilities]);

  if (!state.analysisResult && facilities.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center space-y-4 p-6">
        <MapPin className="w-12 h-12 text-muted-foreground/30" />
        <div>
          <h3 className="text-sm font-medium text-foreground">No health facilities yet</h3>
          <p className="text-xs text-muted-foreground mt-1">
            Select a location and run an analysis to see reachable healthcare facilities.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3 p-3">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
        <input
          type="text"
          placeholder="Filter facilities..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Filter facilities"
          className="w-full h-8 pl-8 pr-3 bg-secondary/50 border border-border rounded-md text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
        />
      </div>

      <div className="flex flex-wrap gap-1">
        <button
          onClick={() => setTypeFilter(null)}
          className={`px-2 py-1 rounded text-xs transition-colors ${!typeFilter ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground'}`}
        >
          All ({facilities.length})
        </button>
        {(Object.entries(typeCounts) as [FacilityType, number][]).map(([t, c]) => (
          <button
            key={t}
            onClick={() => setTypeFilter(typeFilter === t ? null : t)}
            className={`px-2 py-1 rounded text-xs capitalize transition-colors ${typeFilter === t ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground'}`}
          >
            {t} ({c})
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <label htmlFor="sort">Sort by</label>
        <select
          id="sort"
          value={sortKey}
          onChange={(e) => setSortKey(e.target.value as SortKey)}
          className="h-7 bg-secondary/50 border border-border rounded px-2 text-xs"
        >
          <option value="roadTime">Road travel time</option>
          <option value="roadDistance">Road distance</option>
          <option value="straightLine">Straight-line distance</option>
          <option value="name">Name</option>
          <option value="type">Type</option>
          <option value="band">Travel band</option>
        </select>
      </div>

      <div className="space-y-1.5">
        {filtered.slice(0, 100).map((f: Facility) => (
          <div key={f.id} className="data-card p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-sm font-medium truncate">{f.name}</div>
                <div className="text-[11px] text-muted-foreground mt-0.5 truncate">
                  {f.source}{f.osmType ? ` · ${f.osmType}/${f.osmId}` : ''}{f.minimumBandLabel ? ` · ${f.minimumBandLabel}` : ''}
                </div>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px]">
                  {formatSeconds(f.travelDurationSeconds) && <span className="text-foreground">{formatSeconds(f.travelDurationSeconds)} road</span>}
                  {formatMeters(f.travelDistanceMeters) && <span className="text-muted-foreground">{formatMeters(f.travelDistanceMeters)} road</span>}
                  <span className="text-muted-foreground">{formatMeters(f.straightLineDistanceMeters)} straight</span>
                </div>
                <div className="text-[10px] font-mono text-muted-foreground mt-0.5">
                  {f.lat.toFixed(4)}, {f.lon.toFixed(4)}
                </div>
              </div>
              <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium capitalize whitespace-nowrap ${typeColors[f.type] || 'bg-secondary text-secondary-foreground'}`}>
                {f.type}
              </span>
            </div>
          </div>
        ))}
        {filtered.length === 0 && facilities.length > 0 && (
          <div className="text-center text-xs text-muted-foreground py-8">No facilities match your filter</div>
        )}
        {facilities.length === 0 && state.analysisResult && (
          <div className="text-center text-xs text-muted-foreground py-8">
            No facilities fall inside the selected travel area.
          </div>
        )}
        {filtered.length > 100 && (
          <div className="text-center text-xs text-muted-foreground py-2">Showing 100 of {filtered.length} facilities</div>
        )}
      </div>
    </div>
  );
}