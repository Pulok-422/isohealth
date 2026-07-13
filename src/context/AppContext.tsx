import {
  createContext,
  useContext,
  useReducer,
  type ReactNode,
} from 'react';

import type {
  AppState,
  Facility,
  AnalysisResult,
  TransportProfile,
  AnalysisType,
} from '@/types/health';

interface State extends AppState {
  facilities: Facility[];
  analysisResult: AnalysisResult | null;
}

type Action =
  | {
      type: 'SET_CENTER';
      payload: [number, number];
    }
  | {
      type: 'SET_ZOOM';
      payload: number;
    }
  | {
      type: 'SET_TRANSPORT';
      payload: TransportProfile;
    }
  | {
      type: 'SET_ANALYSIS_POINT';
      payload: [number, number] | null;
    }
  | {
      type: 'SET_ORIGIN_LABEL';
      payload: string;
    }
  | {
      type: 'SET_ANALYSIS_TYPE';
      payload: AnalysisType;
    }
  | {
      type: 'SET_THRESHOLDS';
      payload: number[];
    }
  | {
      type: 'SET_DISTANCE_THRESHOLDS';
      payload: number[];
    }
  | {
      type: 'SET_FACILITIES';
      payload: Facility[];
    }
  | {
      type: 'SET_ANALYSIS_RESULT';
      payload: AnalysisResult | null;
    }
  | {
      type: 'SET_ANALYZING';
      payload: boolean;
    }
  | {
      type: 'SET_ANALYSIS_ERROR';
      payload: string | null;
    }
  | {
      type: 'SET_ACTIVE_TAB';
      payload: string;
    }
  | {
      type: 'TOGGLE_LAYER';
      payload: keyof Pick<
        AppState,
        'showFacilities' | 'showIsochrones'
      >;
    }
  | {
      type: 'RESET_ANALYSIS';
    };

const initialState: State = {
  center: [23.8103, 90.4125],
  zoom: 12,
  transportProfile: 'foot-walking',
  analysisPoint: null,
  originLabel: '',
  analysisType: 'time',
  timeThresholds: [
    600,
    1200,
    1800,
    2400,
    3000,
    3600,
  ],
  distanceThresholds: [
    1000,
    2000,
    3000,
    4000,
    5000,
    6000,
  ],
  activeTab: 'settings',
  isAnalyzing: false,
  analysisError: null,
  showFacilities: true,
  showIsochrones: true,
  facilities: [],
  analysisResult: null,
};

function reducer(
  state: State,
  action: Action,
): State {
  switch (action.type) {
    case 'SET_CENTER':
      return {
        ...state,
        center: action.payload,
      };

    case 'SET_ZOOM':
      return {
        ...state,
        zoom: action.payload,
      };

    case 'SET_TRANSPORT':
      return {
        ...state,
        transportProfile: action.payload,
      };

    case 'SET_ANALYSIS_POINT':
      return {
        ...state,
        analysisPoint: action.payload,
      };

    case 'SET_ORIGIN_LABEL':
      return {
        ...state,
        originLabel: action.payload,
      };

    case 'SET_ANALYSIS_TYPE':
      return {
        ...state,
        analysisType: action.payload,
      };

    case 'SET_THRESHOLDS':
      return {
        ...state,
        timeThresholds: action.payload,
      };

    case 'SET_DISTANCE_THRESHOLDS':
      return {
        ...state,
        distanceThresholds:
          action.payload,
      };

    case 'SET_FACILITIES':
      return {
        ...state,
        facilities: action.payload,
      };

    case 'SET_ANALYSIS_RESULT':
      return {
        ...state,
        analysisResult: action.payload,
      };

    case 'SET_ANALYZING':
      return {
        ...state,
        isAnalyzing: action.payload,
      };

    case 'SET_ANALYSIS_ERROR':
      return {
        ...state,
        analysisError: action.payload,
      };

    case 'SET_ACTIVE_TAB':
      return {
        ...state,
        activeTab: action.payload,
      };

    case 'TOGGLE_LAYER':
      return {
        ...state,
        [action.payload]:
          !state[action.payload],
      };

    case 'RESET_ANALYSIS':
      return {
        ...state,
        analysisPoint: null,
        originLabel: '',
        analysisResult: null,
        facilities: [],
        analysisError: null,
      };

    default:
      return state;
  }
}

const AppContext = createContext<{
  state: State;
  dispatch: React.Dispatch<Action>;
} | null>(null);

export function AppProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [state, dispatch] = useReducer(
    reducer,
    initialState,
  );

  return (
    <AppContext.Provider
      value={{
        state,
        dispatch,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useAppState() {
  const context = useContext(AppContext);

  if (!context) {
    throw new Error(
      'useAppState must be used within AppProvider',
    );
  }

  return context;
}
