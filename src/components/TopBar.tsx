import { Search, Car, Bike, Footprints, Play, Loader2, Layers, Plus } from 'lucide-react';
import { useState, useCallback } from 'react';
import { useAppState } from '@/context/AppContext';
import { useAnalysis } from '@/hooks/useAnalysis';
import { Button } from '@/components/ui/button';
import type { TransportProfile } from '@/types/health';

const transportModes: { id: TransportProfile; icon: typeof Car; label: string }[] = [
  { id: 'driving-car', icon: Car, label: 'Drive' },
  { id: 'cycling-regular', icon: Bike, label: 'Cycle' },
  { id: 'foot-walking', icon: Footprints, label: 'Walk' },
];

export function TopBar() {
  const { state, dispatch } = useAppState();
  const { runAnalysis } = useAnalysis();
  const [searchQuery, setSearchQuery] = useState('');

  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim()) return;
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchQuery)}&limit=1`
      );
      const data = await res.json();
      if (data.length > 0) {
        const { lat, lon } = data[0];
        const latNum = parseFloat(lat);
        const lonNum = parseFloat(lon);
        dispatch({ type: 'SET_CENTER', payload: [latNum, lonNum] });
        dispatch({ type: 'SET_ZOOM', payload: 13 });
        runAnalysis(latNum, lonNum);
      }
    } catch {
      // silently fail
    }
  }, [searchQuery, dispatch, runAnalysis]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSearch();
  };

  const layers = [
    { key: 'showFacilities' as const, label: 'Facilities' },
    { key: 'showIsochrones' as const, label: 'Isochrones' },
    { key: 'showPopulation' as const, label: 'Population' },
    { key: 'showUnderserved' as const, label: 'Underserved' },
  ];

  return (
    <div className="h-14 bg-card/90 backdrop-blur-xl border-b border-border flex items-center px-4 gap-3 z-50">
      {/* Logo */}
      <div className="flex items-center gap-2 mr-4">
        <div className="w-7 h-7 rounded-md bg-primary/20 flex items-center justify-center">
          <Plus className="w-4 h-4 text-primary" />
        </div>
        <span className="text-sm font-semibold tracking-tight hidden sm:block">HealthAccess</span>
      </div>

      {/* Search */}
      <div className="flex-1 max-w-md relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input
          type="text"
          placeholder="Search location (e.g., Nairobi, Lagos)..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          className="w-full h-9 pl-9 pr-3 bg-secondary/50 border border-border rounded-md text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
        />
      </div>

      {/* Transport Mode */}
      <div className="flex items-center gap-1 bg-secondary/50 rounded-md p-0.5">
        {transportModes.map(({ id, icon: Icon, label }) => (
          <button
            key={id}
            onClick={() => dispatch({ type: 'SET_TRANSPORT', payload: id })}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium transition-colors ${
              state.transportProfile === id
                ? 'bg-primary/15 text-primary'
                : 'text-muted-foreground hover:text-foreground'
            }`}
            title={label}
          >
            <Icon className="w-3.5 h-3.5" />
            <span className="hidden md:inline">{label}</span>
          </button>
        ))}
      </div>

      {/* Layer Toggles */}
      <div className="hidden lg:flex items-center gap-1">
        <Layers className="w-3.5 h-3.5 text-muted-foreground mr-1" />
        {layers.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => dispatch({ type: 'TOGGLE_LAYER', payload: key })}
            className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
              state[key] ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Analyze */}
      <Button
        size="sm"
        onClick={() => {
          if (state.analysisPoint) {
            runAnalysis(state.analysisPoint[0], state.analysisPoint[1]);
          } else {
            runAnalysis(state.center[0], state.center[1]);
          }
        }}
        disabled={state.isAnalyzing}
        className="gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90"
      >
        {state.isAnalyzing ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <Play className="w-3.5 h-3.5" />
        )}
        <span className="hidden sm:inline">Analyze</span>
      </Button>

      {/* Simulation Toggle */}
      <button
        onClick={() => dispatch({ type: 'SET_SIMULATION_MODE', payload: !state.simulationMode })}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors border ${
          state.simulationMode
            ? 'border-accent/50 bg-accent/10 text-accent'
            : 'border-border text-muted-foreground hover:text-foreground'
        }`}
      >
        <Plus className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">Simulate</span>
      </button>
    </div>
  );
}
