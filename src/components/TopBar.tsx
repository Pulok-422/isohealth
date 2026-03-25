import {
  Search,
  Plus,
  MapPin,
  LogIn,
  User,
  LayoutDashboard,
  Shield,
  LogOut,
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
    <header className="h-16 bg-[#1773cf] border-b border-[#1567b9] flex items-center px-4 md:px-5 gap-3 shadow-sm z-50">
      {/* Left: Brand */}
      <div className="flex items-center gap-3 shrink-0 min-w-fit">
        <div className="w-9 h-9 rounded-xl bg-white/95 flex items-center justify-center shadow-sm">
          <Plus className="w-4 h-4 text-[#1773cf]" />
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

      {/* Center: Search */}
      <div className="flex-1 flex justify-center min-w-0">
        <div className="w-full max-w-2xl relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search location (e.g., Nairobi, Lagos)..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            className="w-full h-11 pl-10 pr-4 bg-white border border-white/70 rounded-xl text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-white/60"
          />
        </div>
      </div>

      {/* Right: Actions */}
      <div className="flex items-center gap-2 shrink-0">
        <Button
          size="sm"
          onClick={handleUseMyLocation}
          className="h-10 px-4 rounded-xl bg-white text-[#1773cf] hover:bg-white/90 border-0 shadow-none hidden sm:inline-flex gap-2"
        >
          <MapPin className="w-4 h-4" />
          <span className="hidden lg:inline">My Location</span>
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
            className="h-10 px-4 rounded-xl bg-white/10 text-white hover:bg-white/15 border border-white/20 shadow-none gap-2"
          >
            <LogIn className="w-4 h-4" />
            <span className="hidden md:inline">Sign In</span>
          </Button>
        )}
      </div>
    </header>
  );
}
