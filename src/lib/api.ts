import { supabase } from '@/integrations/supabase/client';
import type { Facility, TransportProfile } from '@/types/health';

export async function fetchFacilities(lat: number, lon: number, radius: number = 10000): Promise<Facility[]> {
  const { data, error } = await supabase.functions.invoke('fetch-facilities', {
    body: { lat, lon, radius },
  });
  if (error) throw new Error(error.message);
  return data.facilities || [];
}

export async function generateIsochrones(
  lat: number,
  lon: number,
  profile: TransportProfile = 'driving-car',
  ranges: number[] = [600, 1200, 1800]
) {
  const { data, error } = await supabase.functions.invoke('generate-isochrones', {
    body: { lat, lon, profile, ranges },
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function calculateRoute(
  start: { lat: number; lon: number },
  end: { lat: number; lon: number },
  profile: TransportProfile = 'driving-car'
) {
  const { data, error } = await supabase.functions.invoke('calculate-route', {
    body: { start, end, profile },
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function computeMatrix(
  origins: { lat: number; lon: number }[],
  destinations: { lat: number; lon: number }[],
  profile: TransportProfile = 'driving-car'
) {
  const { data, error } = await supabase.functions.invoke('compute-matrix', {
    body: { origins, destinations, profile },
  });
  if (error) throw new Error(error.message);
  return data;
}
