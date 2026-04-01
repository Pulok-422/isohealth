
-- Allow anonymous inserts to isochrone_requests for visitor tracking
CREATE POLICY "Anyone can insert isochrone requests"
ON public.isochrone_requests
FOR INSERT
TO public
WITH CHECK (true);

-- Drop the old auth-only insert policy
DROP POLICY IF EXISTS "Auth users can insert isochrone requests" ON public.isochrone_requests;
