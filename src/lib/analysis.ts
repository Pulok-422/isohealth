import type { PopulationPoint } from '@/types/health';
import type { FeatureCollection } from 'geojson';

// Generate mock population grid around a center point
export function generatePopulationGrid(
  centerLat: number,
  centerLon: number,
  gridSize: number = 20,
  spacing: number = 0.008
): PopulationPoint[] {
  const points: PopulationPoint[] = [];
  const halfGrid = gridSize / 2;

  for (let i = -halfGrid; i < halfGrid; i++) {
    for (let j = -halfGrid; j < halfGrid; j++) {
      const lat = centerLat + i * spacing;
      const lon = centerLon + j * spacing;
      
      // Create realistic population distribution - higher near center, with clusters
      const distFromCenter = Math.sqrt(i * i + j * j) / halfGrid;
      const basePopulation = Math.max(0, 1000 * (1 - distFromCenter * 0.7));
      
      // Add some clusters
      const cluster1 = 800 * Math.exp(-((i - 3) ** 2 + (j + 4) ** 2) / 8);
      const cluster2 = 600 * Math.exp(-((i + 5) ** 2 + (j - 3) ** 2) / 6);
      const cluster3 = 500 * Math.exp(-((i - 7) ** 2 + (j + 7) ** 2) / 10);
      
      const noise = Math.random() * 200;
      const population = Math.round(basePopulation + cluster1 + cluster2 + cluster3 + noise);

      if (population > 50) {
        points.push({ lat, lon, population });
      }
    }
  }

  return points;
}

// Check if a point is within any isochrone polygon
export function isPointInIsochrone(
  lat: number,
  lon: number,
  isochrones: FeatureCollection | null
): boolean {
  if (!isochrones?.features) return false;
  
  for (const feature of isochrones.features) {
    if (feature.geometry.type === 'Polygon') {
      if (pointInPolygon([lon, lat], feature.geometry.coordinates[0])) {
        return true;
      }
    }
  }
  return false;
}

function pointInPolygon(point: number[], polygon: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0], yi = polygon[i][1];
    const xj = polygon[j][0], yj = polygon[j][1];
    
    const intersect = ((yi > point[1]) !== (yj > point[1])) &&
      (point[0] < (xj - xi) * (point[1] - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

// Calculate coverage stats
export function calculateCoverage(
  populationGrid: PopulationPoint[],
  isochrones: FeatureCollection | null
) {
  let covered = 0;
  let underserved = 0;
  let total = 0;

  for (const point of populationGrid) {
    total += point.population;
    if (isPointInIsochrone(point.lat, point.lon, isochrones)) {
      covered += point.population;
    } else {
      underserved += point.population;
    }
  }

  return { covered, underserved, total };
}

// Find underserved clusters
export function findUnderservedClusters(
  populationGrid: PopulationPoint[],
  isochrones: FeatureCollection | null,
  minPopulation: number = 200
): PopulationPoint[] {
  return populationGrid.filter(
    p => p.population >= minPopulation && !isPointInIsochrone(p.lat, p.lon, isochrones)
  ).sort((a, b) => b.population - a.population);
}

// Suggest optimal facility locations
export function suggestFacilityLocations(
  underservedClusters: PopulationPoint[],
  maxSuggestions: number = 5
) {
  if (underservedClusters.length === 0) return [];

  // Simple greedy clustering - pick highest population, then skip nearby
  const suggestions: { lat: number; lon: number; score: number; affectedPopulation: number; reason: string }[] = [];
  const used = new Set<number>();

  for (const cluster of underservedClusters) {
    if (suggestions.length >= maxSuggestions) break;
    
    const idx = underservedClusters.indexOf(cluster);
    if (used.has(idx)) continue;

    // Mark nearby points as used
    let totalPop = cluster.population;
    for (let i = 0; i < underservedClusters.length; i++) {
      if (i === idx) continue;
      const dist = haversine(cluster.lat, cluster.lon, underservedClusters[i].lat, underservedClusters[i].lon);
      if (dist < 3) {
        used.add(i);
        totalPop += underservedClusters[i].population;
      }
    }

    suggestions.push({
      lat: cluster.lat,
      lon: cluster.lon,
      score: Math.min(100, Math.round(totalPop / 50)),
      affectedPopulation: totalPop,
      reason: `High-density underserved area (~${totalPop.toLocaleString()} people)`,
    });
  }

  return suggestions;
}

export function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)}m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

// Compute bounding box [minLon, minLat, maxLon, maxLat] from an isochrone FeatureCollection
export function getBBoxFromIsochrones(
  isochrones: FeatureCollection | null | undefined
): [number, number, number, number] | null {
  if (!isochrones?.features?.length) return null;

  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;

  const walkRing = (ring: number[][]) => {
    for (const [lon, lat] of ring) {
      if (lon < minLon) minLon = lon;
      if (lat < minLat) minLat = lat;
      if (lon > maxLon) maxLon = lon;
      if (lat > maxLat) maxLat = lat;
    }
  };

  for (const feature of isochrones.features) {
    const geom: any = feature.geometry;
    if (!geom) continue;
    if (geom.type === 'Polygon') {
      for (const ring of geom.coordinates) walkRing(ring);
    } else if (geom.type === 'MultiPolygon') {
      for (const polygon of geom.coordinates) {
        for (const ring of polygon) walkRing(ring);
      }
    }
  }

  if (!Number.isFinite(minLon)) return null;
  return [minLon, minLat, maxLon, maxLat];
}
