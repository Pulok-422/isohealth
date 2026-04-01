
-- Create site_visits table for analytics tracking
CREATE TABLE public.site_visits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visitor_id text NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  page_path text NOT NULL DEFAULT '/',
  referrer text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Add visitor_id column to isochrone_requests
ALTER TABLE public.isochrone_requests ADD COLUMN IF NOT EXISTS visitor_id text;

-- Enable RLS
ALTER TABLE public.site_visits ENABLE ROW LEVEL SECURITY;

-- Anyone can insert their own visit (anonymous or authenticated)
CREATE POLICY "Anyone can insert site visits"
ON public.site_visits
FOR INSERT
TO public
WITH CHECK (true);

-- Only admins can read all visits
CREATE POLICY "Admins can view all site visits"
ON public.site_visits
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));
