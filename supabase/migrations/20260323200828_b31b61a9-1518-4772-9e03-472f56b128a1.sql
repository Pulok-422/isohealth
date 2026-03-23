
-- Roles enum
CREATE TYPE public.app_role AS ENUM ('admin', 'user');

-- User roles table (security best practice - separate from profiles)
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role app_role NOT NULL DEFAULT 'user',
  UNIQUE (user_id, role)
);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Profiles table
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  full_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_active_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- User search history
CREATE TABLE public.user_search_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  place_name TEXT NOT NULL,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  search_method TEXT DEFAULT 'search',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.user_search_history ENABLE ROW LEVEL SECURITY;

-- Isochrone requests log
CREATE TABLE public.isochrone_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  profile TEXT NOT NULL DEFAULT 'driving-car',
  ranges JSONB DEFAULT '[600,1200,1800]',
  request_type TEXT DEFAULT 'analysis',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.isochrone_requests ENABLE ROW LEVEL SECURITY;

-- Route requests log
CREATE TABLE public.route_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  start_lat DOUBLE PRECISION NOT NULL,
  start_lon DOUBLE PRECISION NOT NULL,
  end_lat DOUBLE PRECISION NOT NULL,
  end_lon DOUBLE PRECISION NOT NULL,
  profile TEXT NOT NULL DEFAULT 'driving-car',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.route_requests ENABLE ROW LEVEL SECURITY;

-- Matrix requests log
CREATE TABLE public.matrix_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  origin_lat DOUBLE PRECISION NOT NULL,
  origin_lon DOUBLE PRECISION NOT NULL,
  destination_count INTEGER NOT NULL DEFAULT 0,
  profile TEXT NOT NULL DEFAULT 'driving-car',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.matrix_requests ENABLE ROW LEVEL SECURITY;

-- Saved analyses
CREATE TABLE public.saved_analyses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  title TEXT NOT NULL,
  location_name TEXT,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  settings_json JSONB DEFAULT '{}',
  results_json JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.saved_analyses ENABLE ROW LEVEL SECURITY;

-- Simulation scenarios
CREATE TABLE public.simulation_scenarios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  scenario_name TEXT NOT NULL,
  scenario_data_json JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.simulation_scenarios ENABLE ROW LEVEL SECURITY;

-- Security definer function for role checks
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  )
$$;

-- Auto-create profile + default role on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', ''));
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'user');
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- RLS Policies

-- Profiles: users read/update own, admins read all
CREATE POLICY "Users can view own profile" ON public.profiles
  FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Admins can view all profiles" ON public.profiles
  FOR SELECT USING (public.has_role(auth.uid(), 'admin'));

-- User roles: users read own, admins manage
CREATE POLICY "Users can view own roles" ON public.user_roles
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Admins can manage roles" ON public.user_roles
  FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- Search history: users own data
CREATE POLICY "Users manage own search history" ON public.user_search_history
  FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Admins can view all search history" ON public.user_search_history
  FOR SELECT USING (public.has_role(auth.uid(), 'admin'));

-- Isochrone requests: insert for all auth, select own or admin
CREATE POLICY "Auth users can insert isochrone requests" ON public.isochrone_requests
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Users view own isochrone requests" ON public.isochrone_requests
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Admins view all isochrone requests" ON public.isochrone_requests
  FOR SELECT USING (public.has_role(auth.uid(), 'admin'));

-- Route requests
CREATE POLICY "Auth users can insert route requests" ON public.route_requests
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Users view own route requests" ON public.route_requests
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Admins view all route requests" ON public.route_requests
  FOR SELECT USING (public.has_role(auth.uid(), 'admin'));

-- Matrix requests
CREATE POLICY "Auth users can insert matrix requests" ON public.matrix_requests
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Users view own matrix requests" ON public.matrix_requests
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Admins view all matrix requests" ON public.matrix_requests
  FOR SELECT USING (public.has_role(auth.uid(), 'admin'));

-- Saved analyses: users own
CREATE POLICY "Users manage own saved analyses" ON public.saved_analyses
  FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Admins view all saved analyses" ON public.saved_analyses
  FOR SELECT USING (public.has_role(auth.uid(), 'admin'));

-- Simulation scenarios: users own
CREATE POLICY "Users manage own scenarios" ON public.simulation_scenarios
  FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Admins view all scenarios" ON public.simulation_scenarios
  FOR SELECT USING (public.has_role(auth.uid(), 'admin'));
