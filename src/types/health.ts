import type { Feature, FeatureCollection } from 'geojson';

export type TransportProfile = 'driving-car' | 'cycling-regular' | 'foot-walking';
export type AnalysisType = 'time' | 'distance';

export type FacilityType =
  | 'hospital'
  | 'clinic'
  | 'pharmacy'
  | 'doctors'
  | 'dentist'
  | 'laboratory'
  | 'healthcare';

export type FacilitySource = 'OpenStreetMap' | 'Uploaded';

export type OsmObjectType = 'node' | 'way' | 'relation';

export interface Facility {
  id: string;

  source: FacilitySource;
  sourceDataset?: string;

  osmType?: OsmObjectType;
  osmId?: number | string;

  name: string;
  localName?: string;
  type: FacilityType;

  lat: number;
  lon: number;

  tags: Record<string, string>;

  operator?: string;
  openingHours?: string;
  emergency?: string;
  speciality?: string;

  straightLineDistanceMeters: number;

  travelDistanceMeters?: number;
  travelDurationSeconds?: number;

  minimumBandValue?: number;
  minimumBandLabel?: string;
  minimumBandIndex?: number;

  insideOutermostIsochrone: boolean;
  matrixEvaluated: boolean;
}

export interface TravelBand {
  index: number;
  value: number;
  unit: 'seconds' | 'metres';
  label: string;
  feature: Feature;
}

export interface FacilityDataQuality {
  total: number;
  withName: number;
  withoutName: number;
  withOperator: number;
  withOpeningHours: number;
  withEmergencyTag: number;
  withSpeciality: number;
  osmNodes: number;
  osmWays: number;
  osmRelations: number;
  uploadedFacilities: number;
  possibleDuplicates: number;
}

export interface MatrixCoverage {
  totalReachableFacilities: number;
  evaluatedFacilities: number;
  complete: boolean;
}

export interface AnalysisResult {
  analysisId: string;
  analysisDate: string;

  origin: {
    lat: number;
    lon: number;
    label?: string;
  };

  isochrones: FeatureCollection;
  bands: TravelBand[];

  facilities: Facility[];
  nearbyFacilities: Facility[];

  nearestFacility: Facility | null;
  nearestByType: Partial<Record<FacilityType, Facility>>;

  profileUsed: TransportProfile;
  analysisTypeUsed: AnalysisType;
  rangesUsed: number[];

  facilitySourceMode: 'osm' | 'uploaded' | 'combined';

  facilityQueryRadiusMeters: number | null;
  facilityResultTruncated: boolean;

  matrixAvailable: boolean;
  matrixCoverage: MatrixCoverage;

  dataQuality: FacilityDataQuality;

  cumulativeCountsByBand: Record<string, number>;
  incrementalCountsByBand: Record<string, number>;

  warnings: string[];
}

export type AnalysisErrorCode =
  | 'INVALID_INPUT'
  | 'ISOCHRONE_UNAVAILABLE'
  | 'FACILITY_PROVIDER_UNAVAILABLE'
  | 'NO_FACILITIES_FOUND'
  | 'NO_FACILITIES_REACHABLE'
  | 'MATRIX_UNAVAILABLE'
  | 'PARTIAL_MATRIX_COVERAGE'
  | 'ANALYSIS_TOO_LARGE'
  | 'RATE_LIMITED'
  | 'CANCELLED'
  | 'UNKNOWN';

export interface AppState {
  center: [number, number];
  zoom: number;
  transportProfile: TransportProfile;
  analysisPoint: [number, number] | null;
  originLabel: string;
  analysisType: AnalysisType;
  timeThresholds: number[];
  distanceThresholds: number[];
  speed: number;
  activeTab: string;
  isAnalyzing: boolean;
  analysisError: string | null;
  showFacilities: boolean;
  showIsochrones: boolean;
}
