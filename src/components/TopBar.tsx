import { Search, Plus, MapPin, LogIn, User, LayoutDashboard, Shield, LogOut } from 'lucide-react';
import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppState } from '@/context/AppContext';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
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
        toast.success('Location selected — configure settings and click Analyze');
      }
    } catch {
      toast.error('Search failed');
    }
  }, [searchQuery, dispatch]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
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
        toast.success('Location set — click Analyze to run');
      },
      () => toast.error('Could not get your location'),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

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

      {/* My Location */}
      <Button size="sm" variant="outline" onClick={handleUseMyLocation} className="gap-1.5 hidden sm:flex">
        <MapPin className="w-3.5 h-3.5" />
        <span className="hidden lg:inline">My Location</span>
      </Button>

      <div className="flex-1" />

      {/* User Menu */}
      {user ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline" className="gap-1.5">
              <User className="w-3.5 h-3.5" />
              <span className="hidden md:inline max-w-[100px] truncate">{user.email?.split('@')[0]}</span>
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
      ) : (
        <Button size="sm" variant="outline" onClick={() => navigate('/auth')} className="gap-1.5">
          <LogIn className="w-3.5 h-3.5" />
          <span className="hidden md:inline">Sign In</span>
        </Button>
      )}
    </div>
  );
}
