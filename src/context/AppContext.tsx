import { createContext, useContext, useReducer, type ReactNode } from 'react';
import type { AppState, Facility, AnalysisResult, Scenario, TransportProfile, OptimizationResult } from '@/types/health';
import type { PopulationPoint } from '@/types/health';

interface State extends AppState {
  facilities: Facility[];
  simulatedFacilities: Facility[];
  analysisResult: AnalysisResult | null;
  populationGrid: PopulationPoint[];
  scenarios: Scenario[];
  activeScenario: string | null;
  optimizationResults: OptimizationResult[];
  routeGeoJson: any;
}

type Action =
  | { type: 'SET_CENTER'; payload: [number, number] }
  | { type: 'SET_ZOOM'; payload: number }
  | { type: 'SET_TRANSPORT'; payload: TransportProfile }
  | { type: 'SET_ANALYSIS_POINT'; payload: [number, number] | null }
  | { type: 'SET_THRESHOLDS'; payload: number[] }
  | { type: 'SET_FACILITIES'; payload: Facility[] }
  | { type: 'SET_SIMULATED_FACILITIES'; payload: Facility[] }
  | { type: 'ADD_SIMULATED_FACILITY'; payload: Facility }
  | { type: 'REMOVE_SIMULATED_FACILITY'; payload: number }
  | { type: 'SET_ANALYSIS_RESULT'; payload: AnalysisResult | null }
  | { type: 'SET_POPULATION'; payload: PopulationPoint[] }
  | { type: 'SET_ANALYZING'; payload: boolean }
  | { type: 'SET_ACTIVE_TAB'; payload: string }
  | { type: 'TOGGLE_LAYER'; payload: keyof Pick<AppState, 'showFacilities' | 'showIsochrones' | 'showPopulation' | 'showUnderserved'> }
  | { type: 'SET_SIMULATION_MODE'; payload: boolean }
  | { type: 'ADD_SCENARIO'; payload: Scenario }
  | { type: 'SET_ACTIVE_SCENARIO'; payload: string | null }
  | { type: 'SET_OPTIMIZATION'; payload: OptimizationResult[] }
  | { type: 'SET_ROUTE'; payload: any }
  | { type: 'SET_SEARCH_RADIUS'; payload: number };

const initialState: State = {
  center: [-1.2921, 36.8219], // Nairobi
  zoom: 12,
  transportProfile: 'foot-walking', // Default to walking
  analysisPoint: null,
  timeThresholds: [600, 1200, 1800],
  searchRadius: 10000,
  activeTab: 'summary',
  isAnalyzing: false,
  showFacilities: true,
  showIsochrones: true,
  showPopulation: false,  // OFF by default
  showUnderserved: false,  // OFF by default
  simulationMode: false,
  facilities: [],
  simulatedFacilities: [],
  analysisResult: null,
  populationGrid: [],
  scenarios: [],
  activeScenario: null,
  optimizationResults: [],
  routeGeoJson: null,
};

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'SET_CENTER': return { ...state, center: action.payload };
    case 'SET_ZOOM': return { ...state, zoom: action.payload };
    case 'SET_TRANSPORT': return { ...state, transportProfile: action.payload };
    case 'SET_ANALYSIS_POINT': return { ...state, analysisPoint: action.payload };
    case 'SET_THRESHOLDS': return { ...state, timeThresholds: action.payload };
    case 'SET_FACILITIES': return { ...state, facilities: action.payload };
    case 'SET_SIMULATED_FACILITIES': return { ...state, simulatedFacilities: action.payload };
    case 'ADD_SIMULATED_FACILITY': return { ...state, simulatedFacilities: [...state.simulatedFacilities, action.payload] };
    case 'REMOVE_SIMULATED_FACILITY': return { ...state, simulatedFacilities: state.simulatedFacilities.filter(f => f.id !== action.payload) };
    case 'SET_ANALYSIS_RESULT': return { ...state, analysisResult: action.payload };
    case 'SET_POPULATION': return { ...state, populationGrid: action.payload };
    case 'SET_ANALYZING': return { ...state, isAnalyzing: action.payload };
    case 'SET_ACTIVE_TAB': return { ...state, activeTab: action.payload };
    case 'TOGGLE_LAYER': return { ...state, [action.payload]: !state[action.payload] };
    case 'SET_SIMULATION_MODE': return { ...state, simulationMode: action.payload };
    case 'ADD_SCENARIO': return { ...state, scenarios: [...state.scenarios, action.payload] };
    case 'SET_ACTIVE_SCENARIO': return { ...state, activeScenario: action.payload };
    case 'SET_OPTIMIZATION': return { ...state, optimizationResults: action.payload };
    case 'SET_ROUTE': return { ...state, routeGeoJson: action.payload };
    case 'SET_SEARCH_RADIUS': return { ...state, searchRadius: action.payload };
    default: return state;
  }
}

const AppContext = createContext<{ state: State; dispatch: React.Dispatch<Action> } | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  return <AppContext.Provider value={{ state, dispatch }}>{children}</AppContext.Provider>;
}

export function useAppState() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useAppState must be used within AppProvider');
  return ctx;
}
