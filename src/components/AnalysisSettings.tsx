import { useAppState } from '@/context/AppContext';
import { useAnalysis } from '@/hooks/useAnalysis';
import { Footprints, Car, Bike, Play, Loader2, Clock, Ruler } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { TransportProfile, AnalysisType } from '@/types/health';

const transportModes: { id: TransportProfile; icon: typeof Car; label: string; defaultSpeed: number }[] = [
  { id: 'foot-walking', icon: Footprints, label: 'Walking', defaultSpeed: 5 },
  { id: 'cycling-regular', icon: Bike, label: 'Cycling', defaultSpeed: 15 },
  { id: 'driving-car', icon: Car, label: 'Driving', defaultSpeed: 40 },
];

const TIME_PRESETS = [10, 20, 30, 40, 50, 60];
const DISTANCE_PRESETS = [1, 2, 3, 4, 5, 6];

export function AnalysisSettings() {
  const { state, dispatch } = useAppState();


  return (
    <div className="space-y-4 p-3">
      <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
        Analysis Settings
      </div>

      {/* Transport Mode */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-foreground">Transport Mode</label>
        <div className="flex gap-1 bg-secondary rounded-lg p-1">
          {transportModes.map(({ id, icon: Icon, label }) => (
            <button
              key={id}
              onClick={() => dispatch({ type: 'SET_TRANSPORT', payload: id })}
              className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-2 rounded-md text-xs font-medium transition-colors ${
                state.transportProfile === id
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Analysis Type */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-foreground">Analysis Type</label>
        <div className="flex gap-1 bg-secondary rounded-lg p-1">
          {([
            { id: 'time' as AnalysisType, icon: Clock, label: 'Time' },
            { id: 'distance' as AnalysisType, icon: Ruler, label: 'Distance' },
          ]).map(({ id, icon: Icon, label }) => (
            <button
              key={id}
              onClick={() => dispatch({ type: 'SET_ANALYSIS_TYPE', payload: id })}
              className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-2 rounded-md text-xs font-medium transition-colors ${
                state.analysisType === id
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Range Bands */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-foreground">
          Range Bands ({state.analysisType === 'time' ? 'minutes' : 'km'})
        </label>
        <div className="flex flex-wrap gap-1.5">
          {(state.analysisType === 'time' ? TIME_PRESETS : DISTANCE_PRESETS).map((val) => {
            const inSeconds = val * 60;
            const inMeters = val * 1000;
            const thresholds =
              state.analysisType === 'time' ? state.timeThresholds : state.distanceThresholds;
            const targetVal = state.analysisType === 'time' ? inSeconds : inMeters;
            const isActive = thresholds.includes(targetVal);

            return (
              <button
                key={val}
                onClick={() => {
                  const actionType =
                    state.analysisType === 'time' ? 'SET_THRESHOLDS' : 'SET_DISTANCE_THRESHOLDS';

                  if (isActive) {
                    const next = thresholds.filter((t) => t !== targetVal);
                    if (next.length > 0) {
                      dispatch({ type: actionType, payload: next });
                    }
                  } else {
                    dispatch({
                      type: actionType,
                      payload: [...thresholds, targetVal].sort((a, b) => a - b),
                    });
                  }
                }}
                className={`px-2.5 py-1.5 rounded-md text-xs font-medium border transition-colors ${
                  isActive
                    ? 'bg-primary/10 text-primary border-primary/30'
                    : 'bg-secondary text-muted-foreground border-border hover:text-foreground'
                }`}
              >
                {val} {state.analysisType === 'time' ? 'min' : 'km'}
              </button>
            );
          })}
        </div>
      </div>

      {/* Location status */}
      {state.analysisPoint ? (
        <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-primary/5 border border-primary/15">
          <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
          <span className="text-[11px] font-medium text-primary">Selected location</span>
        </div>
      ) : (
        <p className="text-[10px] text-muted-foreground text-center">
          Click the map or search for a place to begin.
        </p>
      )}
    </div>
  );
}

export function StickyAnalyzeButton() {
  const { state } = useAppState();
  const { runAnalysis } = useAnalysis();

  const handleAnalyze = () => {
    if (state.analysisPoint) {
      runAnalysis(state.analysisPoint[0], state.analysisPoint[1]);
    } else {
      runAnalysis(state.center[0], state.center[1]);
    }
  };

  return (
    <div className="sticky bottom-0 p-3 bg-card/95 backdrop-blur-sm border-t border-border">
      <Button
        onClick={handleAnalyze}
        disabled={state.isAnalyzing}
        className="w-full gap-2"
        size="sm"
      >
        {state.isAnalyzing ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <Play className="w-4 h-4" />
        )}
        {state.isAnalyzing ? 'Analyzing accessibility…' : 'Analyze Accessibility'}
      </Button>
    </div>
  );
}
