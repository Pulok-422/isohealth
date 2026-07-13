import type { FeatureCollection } from 'geojson';

export type RoutingProfile =
  | 'foot-walking'
  | 'cycling-regular'
  | 'driving-car';

export interface Coordinate {
  lat: number;
  lon: number;
}

export interface MatrixResult {
  durations: Array<Array<number | null>>;
  distances: Array<Array<number | null>>;
}

export interface RoutingProvider {
  id: 'openrouteservice';

  generateIsochrones(params: {
    origin: Coordinate;
    profile: RoutingProfile;
    rangeType: 'time' | 'distance';
    ranges: number[];
  }): Promise<FeatureCollection>;

  computeMatrix(params: {
    origins: Coordinate[];
    destinations: Coordinate[];
    profile: RoutingProfile;
  }): Promise<MatrixResult>;
}