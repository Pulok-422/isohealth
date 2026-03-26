import {
  MapPin,
  LogIn,
  User,
  LayoutDashboard,
  Shield,
  LogOut,
  Search,
  RotateCcw,
  Loader2,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAppState } from '@/context/AppContext';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { useCallback, useMemo, useRef, useState, useEffect } from 'react';
import { toast } from 'sonner';

export function TopBar() {
  const { state, dispatch } = useAppState();
  const { user, signOut, isAdmin } = useAuth();
  const navigate = useNavigate();

  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [locating, setLocating] = useState(false);
  const searchWrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (!searchWrapRef.current) return;
      if (!searchWrapRef.current.contains(e.target as Node)) {
        setSearchOpen(false);
      }
    }

    if (searchOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [searchOpen]);

  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim()) return;

    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
          searchQuery
        )}&limit=1`
      );
      const data = await res.json();

      if (data.length > 0) {
        const { lat, lon, display_name } = data[0];
        const latNum = parseFloat(lat);
        const lonNum = parseFloat(lon);

        dispatch({ type: 'SET_CENTER', payload: [latNum, lonNum] });
        dispatch({ type: 'SET_ZOOM', payload: 13 });
        dispatch({ type: 'SET_ANALYSIS_POINT', payload: [latNum, lonNum] });

        toast.success('Location selected');
        setSearchOpen(false);
        setSearchQuery(display_name || searchQuery);
      } else {
        toast.error('No matching location found');
      }
    } catch {
      toast.error('Search failed');
    }
  }, [searchQuery, dispatch]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') handleSearch();
    if (e.key === 'Escape') setSearchOpen(false);
  };

  const handleUseMyLocation = () => {
    if (!navigator.geolocation) {
      toast.error('Geolocation not supported');
      return;
    }

    setLocating(true);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;

        dispatch({ type: 'SET_CENTER', payload: [latitude, longitude] });
        dispatch({ type: 'SET_ZOOM', payload: 14 });
        dispatch({ type: 'SET_ANALYSIS_POINT', payload: [latitude, longitude] });

        setLocating(false);
        toast.success('Current location set');
      },
      () => {
        setLocating(false);
        toast.error('Could not get your location');
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const handleReset = () => {
    dispatch({ type: 'RESET_ANALYSIS' });
    setSearchQuery('');
    toast.success('Analysis reset');
  };

  const contextText = useMemo(() => {
    const parts: string[] = [];

    if (state.analysisPoint) {
      parts.push(
        `${state.analysisPoint[0].toFixed(3)}, ${state.analysisPoint[1].toFixed(3)}`
      );
    } else {
      parts.push('No location selected');
    }

    const mode = state.transportProfile.replace('-', ' ');
    parts.push(mode.charAt(0).toUpperCase() + mode.slice(1));

    if (state.analysisType === 'time' && state.timeThresholds.length) {
      const maxBand = Math.max(...state.timeThresholds) / 60;
      parts.push(`${maxBand} min`);
    }

    if (state.analysisType === 'distance' && state.distanceThresholds.length) {
      const maxBand = Math.max(...state.distanceThresholds) / 1000;
      parts.push(`${maxBand} km`);
    }

    if (state.isAnalyzing) {
      parts.push('Analyzing...');
    }

    return parts.join(' • ');
  }, [
    state.analysisPoint,
    state.transportProfile,
    state.analysisType,
    state.timeThresholds,
    state.distanceThresholds,
    state.isAnalyzing,
  ]);

  return (
    <header className="bg-white border-b border-gray-200 shadow-[0_1px_2px_rgba(0,0,0,0.05)] z-50 relative">
      <div className="h-14 px-3 md:px-5 flex items-center gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-10 h-10 rounded-lg bg-white flex items-center justify-center overflow-hidden shrink-0">
            <img
              src="/iso (2).png"
              alt="iso-Health logo"
              className="w-full h-full object-contain scale-125"
            />
          </div>

          <div className="flex flex-col leading-none min-w-0">
            <span className="text-sm font-semibold text-gray-900 tracking-tight">
              iso-Health
            </span>
            <span className="text-[10px] text-gray-500 truncate max-w-[220px] sm:max-w-[320px] md:max-w-[420px]">
              {contextText}
            </span>
          </div>
        </div>

        <div className="ml-auto flex items-center gap-2 pl-3 border-l border-gray-200">
          <div className="relative" ref={searchWrapRef}>
            <Button
              size="sm"
              type="button"
              onClick={() => setSearchOpen((prev) => !prev)}
              className="h-9 w-9 p-0 rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 border border-gray-200 shadow-none"
              title="Search location"
            >
              <Search className="w-4 h-4" />
            </Button>

            {searchOpen && (
              <div className="absolute right-full top-1/2 mr-2 -translate-y-1/2 w-[280px] sm:w-[340px] bg-white border border-gray-200 rounded-xl shadow-lg p-2 z-50">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    autoFocus
                    type="text"
                    placeholder="Search location..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={handleKeyDown}
                    className="w-full h-10 pl-9 pr-16 rounded-lg border border-gray-200 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#1773cf]/20 focus:border-[#1773cf]"
                  />
                  <button
                    type="button"
                    onClick={handleSearch}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 h-7 px-2.5 rounded-md bg-[#1773cf] text-white text-xs font-medium hover:bg-[#1567b9] transition-colors"
                  >
                    Go
                  </button>
                </div>
              </div>
            )}
          </div>

          <Button
            size="sm"
            onClick={handleUseMyLocation}
            disabled={locating}
            className="h-9 px-3 rounded-lg bg-[#1773cf] text-white hover:bg-[#1567b9] border-0 shadow-none gap-1.5"
          >
            {locating ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <MapPin className="w-4 h-4" />
            )}
            <span className="hidden md:inline">
              {locating ? 'Locating...' : 'My Location'}
            </span>
          </Button>

          <Button
            size="sm"
            type="button"
            onClick={handleReset}
            className="h-9 w-9 p-0 rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 border border-gray-200 shadow-none"
            title="Reset analysis"
          >
            <RotateCcw className="w-4 h-4" />
          </Button>

          {user ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="sm"
                  className="h-9 px-3 rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 border border-gray-200 shadow-none gap-2"
                >
                  <User className="w-4 h-4" />
                  <span className="hidden md:inline max-w-[100px] truncate">
                    {user.email?.split('@')[0]}
                  </span>
                </Button>
              </DropdownMenuTrigger>

              <DropdownMenuContent align="end" className="w-48">
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
          ) : (
            <Button
              size="sm"
              onClick={() => navigate('/auth')}
              className="h-9 px-3 rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 border border-gray-200 shadow-none gap-1.5"
            >
              <LogIn className="w-4 h-4" />
              <span className="hidden md:inline">Sign In</span>
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}
