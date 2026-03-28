import type { TransportProfile } from '@/types/health';

const SPEEDS_KMH: Record<TransportProfile, number> = {
  'foot-walking': 5,
  'cycling-regular': 15,
  'driving-car': 40,
};

const MODE_LABELS: Record<TransportProfile, string> = {
  'foot-walking': 'walk',
  'cycling-regular': 'cycle',
  'driving-car': 'drive',
};

/** Given distance in meters and a transport profile, return seconds */
export function estimateTravelTime(distanceMeters: number, profile: TransportProfile): number {
  const speedKmh = SPEEDS_KMH[profile];
  return (distanceMeters / 1000 / speedKmh) * 3600;
}

/** Format travel time as "8 min walk" */
export function formatTravelTime(distanceMeters: number, profile: TransportProfile): string {
  const seconds = estimateTravelTime(distanceMeters, profile);
  const minutes = Math.round(seconds / 60);
  const label = MODE_LABELS[profile];
  if (minutes < 1) return `< 1 min ${label}`;
  if (minutes >= 60) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m > 0 ? `${h}h ${m}m ${label}` : `${h}h ${label}`;
  }
  return `${minutes} min ${label}`;
}

/** Format distance compactly */
export function formatDistanceCompact(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}
