import { useAppState } from '@/context/AppContext';
import { useAnalysis } from '@/hooks/useAnalysis';
import { Trash2, RefreshCw, MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function SimulationTab() {
  const { state, dispatch } = useAppState();
  const { runAnalysis } = useAnalysis();

  const handleReanalyze = () => {
    if (state.analysisPoint) {
      runAnalysis(state.analysisPoint[0], state.analysisPoint[1]);
    }
  };

  // Empty state
  if (!state.analysisResult && state.simulatedFacilities.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center space-y-4 p-6">
        <MapPin className="w-12 h-12 text-muted-foreground/30" />
        <div>
          <h3 className="text-sm font-medium text-foreground">No Analysis Yet</h3>
          <p className="text-xs text-muted-foreground mt-1">
            Click on the map or search a location, then click <strong>Analyze Accessibility</strong> to begin.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-3">
      <div className="data-card">
        <span className="kpi-label">Intervention Simulation</span>
        <p className="text-xs text-muted-foreground mt-1">
          Enable simulation mode from the top bar, then click on the map to place new facilities.
          Re-analyze to see the impact.
        </p>
      </div>

      {/* Simulated facilities */}
      <div>
        <span className="kpi-label">Simulated Facilities ({state.simulatedFacilities.length})</span>
        <div className="space-y-1.5 mt-2">
          {state.simulatedFacilities.map((f) => (
            <div key={f.id} className="data-card p-3 border-accent/20">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium">{f.name}</div>
                  <div className="text-xs font-mono text-muted-foreground">
                    {f.lat.toFixed(4)}, {f.lon.toFixed(4)}
                  </div>
                </div>
                <button
                  onClick={() => dispatch({ type: 'REMOVE_SIMULATED_FACILITY', payload: f.id })}
                  className="text-muted-foreground hover:text-destructive transition-colors p-1"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
          {state.simulatedFacilities.length === 0 && (
            <div className="text-xs text-muted-foreground text-center py-4">
              No simulated facilities yet
            </div>
          )}
        </div>
      </div>

      {state.simulatedFacilities.length > 0 && (
        <div className="space-y-2">
          <Button
            size="sm"
            onClick={handleReanalyze}
            disabled={state.isAnalyzing}
            className="w-full gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Re-analyze with simulated facilities
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => dispatch({ type: 'SET_SIMULATED_FACILITIES', payload: [] })}
            className="w-full"
          >
            Clear all simulated facilities
          </Button>
        </div>
      )}

      {/* Before/After comparison */}
      {state.analysisResult && state.simulatedFacilities.length > 0 && (
        <div className="data-card">
          <span className="kpi-label">Impact Preview</span>
          <div className="grid grid-cols-2 gap-3 mt-2">
            <div>
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Current</span>
              <div className="text-lg font-mono font-semibold text-foreground">
                {state.analysisResult.facilities.filter(f => !f.isSimulated).length}
              </div>
              <span className="text-[10px] text-muted-foreground">facilities</span>
            </div>
            <div>
              <span className="text-[10px] uppercase tracking-wider text-accent">With Simulation</span>
              <div className="text-lg font-mono font-semibold text-accent">
                {state.analysisResult.facilities.length}
              </div>
              <span className="text-[10px] text-accent/70">facilities</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
