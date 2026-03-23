
-- Fix permissive INSERT policies by requiring user_id = auth.uid()
DROP POLICY "Auth users can insert isochrone requests" ON public.isochrone_requests;
CREATE POLICY "Auth users can insert isochrone requests" ON public.isochrone_requests
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY "Auth users can insert route requests" ON public.route_requests;
CREATE POLICY "Auth users can insert route requests" ON public.route_requests
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY "Auth users can insert matrix requests" ON public.matrix_requests;
CREATE POLICY "Auth users can insert matrix requests" ON public.matrix_requests
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
