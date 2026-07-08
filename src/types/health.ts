export interface Facility {
  id: number | string;
  name: string;
  type: 'hospital' | 'clinic' | 'pharmacy' | 'doctors' | 'healthcare';
  lat: number;
  lon: number;
  tags: Record<string, string>;
  isSimulated?: boolean;
}

export interface PopulationPoint {
  lat: number;
  lon: number;
  population: number;
}

import type { FeatureCollection } from 'geojson';

export interface AnalysisResult {
  facilities: Facility[];
  reachableFacilityCount?: number;
  totalFacilityCount?: number;
  isochrones: FeatureCollection | null;
  nearestFacility: Facility | null;
  nearestDistance: number | null;
  nearestDuration: number | null;
  populationCovered: number;
  populationUnderserved: number;
  totalPopulation: number;
  profileUsed?: string;
  analysisTypeUsed?: string;
  rangesUsed?: number[];
}

export interface Scenario {
  id: string;
  name: string;
  simulatedFacilities: Facility[];
  result: AnalysisResult | null;
}

export interface OptimizationResult {
  lat: number;
  lon: number;
  score: number;
  affectedPopulation: number;
  reason: string;
}

export type TransportProfile = 'driving-car' | 'cycling-regular' | 'foot-walking';
export type AnalysisType = 'time' | 'distance';

export interface AppState {
  center: [number, number];
  zoom: number;
  transportProfile: TransportProfile;
  analysisPoint: [number, number] | null;
  analysisType: AnalysisType;
  timeThresholds: number[];
  distanceThresholds: number[];
  speed: number;
  searchRadius: number;
  activeTab: string;
  isAnalyzing: boolean;
  showFacilities: boolean;
  showIsochrones: boolean;
  showPopulation: boolean;
  showUnderserved: boolean;
  simulationMode: boolean;
}
