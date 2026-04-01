import { useAppState } from '@/context/AppContext';
import { useAnalysis } from '@/hooks/useAnalysis';
import { Ambulance, Building2, Stethoscope, MapPinCheck } from 'lucide-react';
import type { TransportProfile } from '@/types/health';

const presets = [
  {
    id: 'emergency',
    label: 'Emergency Access',
    icon: Ambulance,
    description: 'Find emergency services within 15 min driving',
    transport: 'driving-car' as TransportProfile,
    analysisType: 'time' as const,
    timeThresholds: [300, 600, 900],
  },
  {
    id: 'nearest-hospital',
    label: 'Nearest Hospital',
    icon: Building2,
    description: 'Locate hospitals within 30 min walking',
    transport: 'foot-walking' as TransportProfile,
    analysisType: 'time' as const,
    timeThresholds: [600, 1200, 1800],
  },
  {
    id: 'coverage-check',
    label: 'Coverage Check',
    icon: MapPinCheck,
    description: 'Full coverage analysis within 60 min walking',
    transport: 'foot-walking' as TransportProfile,
    analysisType: 'time' as const,
    timeThresholds: [600, 1200, 1800, 2400, 3000, 3600],
  },
  {
    id: 'clinic-planning',
    label: 'Clinic Planning',
    icon: Stethoscope,
    description: 'Identify gaps within 5 km cycling radius',
    transport: 'cycling-regular' as TransportProfile,
    analysisType: 'distance' as const,
    distanceThresholds: [1000, 2000, 3000, 4000, 5000],
  },
];

export function PresetsPanel() {
  const { state, dispatch } = useAppState();
  const { runAnalysis } = useAnalysis();

  const applyPreset = (preset: typeof presets[0]) => {
    dispatch({ type: 'SET_TRANSPORT', payload: preset.transport });
    dispatch({ type: 'SET_ANALYSIS_TYPE', payload: preset.analysisType });
    if (preset.analysisType === 'time' && preset.timeThresholds) {
      dispatch({ type: 'SET_THRESHOLDS', payload: preset.timeThresholds });
    }
    if (preset.analysisType === 'distance' && preset.distanceThresholds) {
      dispatch({ type: 'SET_DISTANCE_THRESHOLDS', payload: preset.distanceThresholds });
    }

    // Auto-run if we have a point
    if (state.analysisPoint) {
      setTimeout(() => {
        runAnalysis(state.analysisPoint![0], state.analysisPoint![1]);
      }, 100);
    }
  };

  return (
    <div className="space-y-3 p-3">
      <div className="data-card">
        <span className="kpi-label">Quick Analysis Presets</span>
        <p className="text-xs text-muted-foreground mt-1">
          Choose a preset to quickly configure and run analysis
        </p>
      </div>

      <div className="space-y-2">
        {presets.map((preset) => {
          const Icon = preset.icon;
          return (
            <button
              key={preset.id}
              onClick={() => applyPreset(preset)}
              className="w-full text-left p-3 rounded-lg border border-border bg-card hover:bg-secondary/50 transition-colors group"
            >
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 group-hover:bg-primary/20 transition-colors">
                  <Icon className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <div className="text-sm font-medium text-foreground">{preset.label}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{preset.description}</div>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {!state.analysisPoint && (
        <p className="text-[10px] text-muted-foreground text-center">
          Select a location on the map first, then choose a preset to auto-analyze.
        </p>
      )}
    </div>
  );
}
