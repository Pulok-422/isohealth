import {
  MapPin,
  LogIn,
  User,
  LayoutDashboard,
  Shield,
  LogOut,
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
import { toast } from 'sonner';

export function TopBar() {
  const { dispatch } = useAppState();
  const { user, signOut, isAdmin } = useAuth();
  const navigate = useNavigate();

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
    <header className="bg-white border-b border-gray-200 shadow-sm z-50">
      <div className="h-14 px-3 md:px-5 flex items-center">

        {/* Left: Brand */}
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-lg bg-[#1773cf]/10 flex items-center justify-center overflow-hidden">
            <img
              src="/iso (2).png"
              alt="iso-Health logo"
              className="w-7 h-7 object-contain"
            />
          </div>

          <div className="flex flex-col leading-none">
            <span className="text-sm font-semibold text-gray-900 tracking-tight">
              iso-Health
            </span>
            <span className="text-[10px] text-gray-500 hidden sm:block">
              Accessibility Mapping
            </span>
          </div>
        </div>

        {/* Right: Actions */}
        <div className="ml-auto flex items-center gap-2">

          <Button
            size="sm"
            onClick={handleUseMyLocation}
            className="h-9 px-3 rounded-lg bg-[#1773cf] text-white hover:bg-[#1567b9] border-0 shadow-none gap-1.5"
          >
            <MapPin className="w-4 h-4" />
            <span className="hidden md:inline">My Location</span>
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
