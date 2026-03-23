import { useState, useMemo } from 'react';
import { useAppState } from '@/context/AppContext';
import { Search } from 'lucide-react';

const typeColors: Record<string, string> = {
  hospital: 'bg-destructive/20 text-destructive',
  clinic: 'bg-primary/20 text-primary',
  pharmacy: 'bg-chart-purple/20 text-chart-purple',
  doctors: 'bg-success/20 text-success',
  healthcare: 'bg-accent/20 text-accent',
};

export function FacilitiesTab() {
  const { state } = useAppState();
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<string | null>(null);

  const allFacilities = useMemo(
    () => [...state.facilities, ...state.simulatedFacilities],
    [state.facilities, state.simulatedFacilities]
  );

  const filtered = useMemo(() => {
    return allFacilities.filter((f) => {
      if (typeFilter && f.type !== typeFilter) return false;
      if (search && !f.name.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [allFacilities, search, typeFilter]);

  const types = useMemo(() => {
    const counts: Record<string, number> = {};
    allFacilities.forEach((f) => {
      counts[f.type] = (counts[f.type] || 0) + 1;
    });
    return counts;
  }, [allFacilities]);

  return (
    <div className="space-y-3">
      {/* Search */}
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
        <input
          type="text"
          placeholder="Filter facilities..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full h-8 pl-8 pr-3 bg-secondary/50 border border-border rounded-md text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
        />
      </div>

      {/* Type filters */}
      <div className="flex flex-wrap gap-1">
        <button
          onClick={() => setTypeFilter(null)}
          className={`px-2 py-1 rounded text-xs transition-colors ${
            !typeFilter ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          All ({allFacilities.length})
        </button>
        {Object.entries(types).map(([type, count]) => (
          <button
            key={type}
            onClick={() => setTypeFilter(typeFilter === type ? null : type)}
            className={`px-2 py-1 rounded text-xs capitalize transition-colors ${
              typeFilter === type ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {type} ({count})
          </button>
        ))}
      </div>

      {/* List */}
      <div className="space-y-1.5">
        {filtered.slice(0, 50).map((f) => (
          <div
            key={`${f.id}-${f.isSimulated}`}
            className="data-card p-3 hover:border-primary/20 transition-colors cursor-pointer"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-sm font-medium truncate">{f.name}</div>
                <div className="text-xs font-mono text-muted-foreground mt-0.5">
                  {f.lat.toFixed(4)}, {f.lon.toFixed(4)}
                </div>
              </div>
              <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium capitalize whitespace-nowrap ${typeColors[f.type] || 'bg-secondary text-secondary-foreground'}`}>
                {f.isSimulated ? '⚡ ' : ''}{f.type}
              </span>
            </div>
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="text-center text-xs text-muted-foreground py-8">
            No facilities found
          </div>
        )}
        {filtered.length > 50 && (
          <div className="text-center text-xs text-muted-foreground py-2">
            Showing 50 of {filtered.length} facilities
          </div>
        )}
      </div>
    </div>
  );
}
