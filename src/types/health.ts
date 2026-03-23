export interface Facility {
  id: number;
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

export interface AnalysisResult {
  facilities: Facility[];
  isochrones: GeoJSON.FeatureCollection | null;
  nearestFacility: Facility | null;
  nearestDistance: number | null;
  nearestDuration: number | null;
  populationCovered: number;
  populationUnderserved: number;
  totalPopulation: number;
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

export interface AppState {
  center: [number, number];
  zoom: number;
  transportProfile: TransportProfile;
  analysisPoint: [number, number] | null;
  timeThresholds: number[];
  searchRadius: number;
  activeTab: string;
  isAnalyzing: boolean;
  showFacilities: boolean;
  showIsochrones: boolean;
  showPopulation: boolean;
  showUnderserved: boolean;
  simulationMode: boolean;
}
