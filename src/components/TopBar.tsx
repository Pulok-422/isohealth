import {
  Search,
  MapPin,
  LogIn,
  User,
  LayoutDashboard,
  Shield,
  LogOut,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { useState, useCallback } from 'react';
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
import { toast } from 'sonner';

export function TopBar() {
  const { dispatch } = useAppState();
  const { user, signOut, isAdmin } = useAuth();
  const navigate = useNavigate();

  const [searchQuery, setSearchQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);

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
        dispatch({ type: 'SET_ANALYSIS_POINT', payload: [latNum, lonNum] });

        toast.success('Location selected. Configure settings and click Analyze.');
        setSearchOpen(false);
      } else {
        toast.error('No matching location found');
      }
    } catch {
      toast.error('Search failed');
    }
  }, [searchQuery, dispatch]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') handleSearch();
  };

  const handleUseMyLocation = () => {
    if (!navigator.geolocation) {
      toast.error('Geolocation not supported');
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;

        dispatch({ type: 'SET_CENTER', payload: [latitude, longitude] });
        dispatch({ type: 'SET_ZOOM', payload: 14 });
        dispatch({ type: 'SET_ANALYSIS_POINT', payload: [latitude, longitude] });

        toast.success('Location set. Click Analyze to run.');
      },
      () => toast.error('Could not get your location'),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  return (
    <header className="bg-[#1773cf] border-b border-[#1567b9] shadow-sm z-50 relative">
      <div className="h-16 px-3 md:px-5 flex items-center gap-3">
        {/* Left: Brand */}
        <div className="flex items-center gap-3 shrink-0 min-w-fit">
          <div className="w-10 h-10 rounded-xl bg-white flex items-center justify-center shadow-sm overflow-hidden">
            <img
              src="/iso (2).png"
              alt="iso-Health logo"
              className="w-8 h-8 object-contain"
            />
          </div>

          <div className="flex flex-col leading-none">
            <span className="text-[15px] md:text-base font-semibold tracking-tight text-white">
              iso-Health
            </span>
            <span className="text-[11px] text-white/75 hidden md:block">
              Accessibility Mapping
            </span>
          </div>
        </div>

        {/* Right side actions */}
        <div className="ml-auto flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            onClick={() => setSearchOpen((prev) => !prev)}
            className="h-10 px-3 rounded-xl bg-white/10 text-white hover:bg-white/15 border border-white/20 shadow-none gap-2"
          >
            <Search className="w-4 h-4" />
            <span className="hidden sm:inline">Search</span>
            {searchOpen ? (
              <ChevronUp className="w-4 h-4 hidden sm:inline" />
            ) : (
              <ChevronDown className="w-4 h-4 hidden sm:inline" />
            )}
          </Button>

          <Button
            size="sm"
            onClick={handleUseMyLocation}
            className="h-10 px-3 md:px-4 rounded-xl bg-white text-[#1773cf] hover:bg-white/90 border-0 shadow-none gap-2"
          >
            <MapPin className="w-4 h-4" />
            <span className="hidden md:inline">My Location</span>
          </Button>

          {user ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="sm"
                  className="h-10 px-3 rounded-xl bg-white/10 text-white hover:bg-white/15 border border-white/20 shadow-none gap-2"
                >
                  <User className="w-4 h-4" />
                  <span className="hidden md:inline max-w-[110px] truncate">
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
              className="h-10 px-3 md:px-4 rounded-xl bg-white/10 text-white hover:bg-white/15 border border-white/20 shadow-none gap-2"
            >
              <LogIn className="w-4 h-4" />
              <span className="hidden md:inline">Sign In</span>
            </Button>
          )}
        </div>
      </div>

      {/* Floating collapsible search */}
      {searchOpen && (
        <div className="absolute top-full left-0 right-0 z-50 px-3 md:px-5 pt-2">
          <div className="max-w-2xl ml-auto">
            <div className="relative bg-white rounded-xl shadow-lg border border-slate-200">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                placeholder="Search location (e.g., Nairobi, Lagos)..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                className="w-full h-11 pl-10 pr-20 bg-white rounded-xl text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none"
              />
              <button
                type="button"
                onClick={handleSearch}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 h-8 px-3 rounded-lg bg-[#1773cf] text-white text-sm font-medium hover:bg-[#1567b9] transition-colors"
              >
                Go
              </button>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
