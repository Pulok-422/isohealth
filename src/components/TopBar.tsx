import { Search, Car, Bike, Footprints, Play, Loader2, Layers, Plus, MapPin, LogOut, User, LayoutDashboard, Shield } from 'lucide-react';
import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppState } from '@/context/AppContext';
import { useAuth } from '@/contexts/AuthContext';
import { useAnalysis } from '@/hooks/useAnalysis';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import type { TransportProfile } from '@/types/health';
import { toast } from 'sonner';

const transportModes: { id: TransportProfile; icon: typeof Car; label: string }[] = [
  { id: 'driving-car', icon: Car, label: 'Drive' },
  { id: 'cycling-regular', icon: Bike, label: 'Cycle' },
  { id: 'foot-walking', icon: Footprints, label: 'Walk' },
];

export function TopBar() {
  const { state, dispatch } = useAppState();
  const { runAnalysis } = useAnalysis();
  const { user, signOut, isAdmin } = useAuth();
  const navigate = useNavigate();
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
      toast.error('Search failed');
    }
  }, [searchQuery, dispatch, runAnalysis]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSearch();
  };

  const handleUseMyLocation = () => {
    if (!navigator.geolocation) {
      toast.error('Geolocation not supported by your browser');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        dispatch({ type: 'SET_CENTER', payload: [latitude, longitude] });
        dispatch({ type: 'SET_ZOOM', payload: 14 });
        dispatch({ type: 'SET_ANALYSIS_POINT', payload: [latitude, longitude] });
        runAnalysis(latitude, longitude);
        toast.success('Using your current location');
      },
      () => toast.error('Could not get your location'),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const layers = [
    { key: 'showFacilities' as const, label: 'Facilities' },
    { key: 'showIsochrones' as const, label: 'Isochrones' },
    { key: 'showPopulation' as const, label: 'Population' },
    { key: 'showUnderserved' as const, label: 'Underserved' },
  ];

  return (
    <div className="h-14 bg-card border-b border-border flex items-center px-4 gap-3 z-50 shadow-sm">
      {/* Logo */}
      <div className="flex items-center gap-2 mr-2">
        <div className="w-7 h-7 rounded-md bg-primary/10 flex items-center justify-center">
          <Plus className="w-4 h-4 text-primary" />
        </div>
        <span className="text-sm font-semibold tracking-tight hidden sm:block text-foreground">HealthAccess</span>
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
          className="w-full h-9 pl-9 pr-3 bg-secondary border border-border rounded-md text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
      </div>

      {/* Use My Location */}
      <Button size="sm" variant="outline" onClick={handleUseMyLocation} className="gap-1.5 hidden sm:flex">
        <MapPin className="w-3.5 h-3.5" />
        <span className="hidden lg:inline">My Location</span>
      </Button>

      {/* Transport Mode */}
      <div className="flex items-center gap-1 bg-secondary rounded-md p-0.5">
        {transportModes.map(({ id, icon: Icon, label }) => (
          <button
            key={id}
            onClick={() => dispatch({ type: 'SET_TRANSPORT', payload: id })}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium transition-colors ${
              state.transportProfile === id
                ? 'bg-primary/10 text-primary'
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
        className="gap-1.5"
      >
        {state.isAnalyzing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
        <span className="hidden sm:inline">Analyze</span>
      </Button>

      {/* Simulation Toggle */}
      <button
        onClick={() => dispatch({ type: 'SET_SIMULATION_MODE', payload: !state.simulationMode })}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors border ${
          state.simulationMode
            ? 'border-accent/50 bg-accent/10 text-accent-foreground'
            : 'border-border text-muted-foreground hover:text-foreground'
        }`}
      >
        <Plus className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">Simulate</span>
      </button>

      {/* User Menu */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="outline" className="gap-1.5">
            <User className="w-3.5 h-3.5" />
            <span className="hidden md:inline max-w-[100px] truncate">{user?.email?.split('@')[0]}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => navigate('/dashboard')}>
            <LayoutDashboard className="w-4 h-4 mr-2" />
            Dashboard
          </DropdownMenuItem>
          {isAdmin && (
            <DropdownMenuItem onClick={() => navigate('/admin')}>
              <Shield className="w-4 h-4 mr-2" />
              Admin Panel
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={signOut}>
            <LogOut className="w-4 h-4 mr-2" />
            Sign Out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
