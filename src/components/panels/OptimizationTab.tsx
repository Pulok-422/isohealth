import { useAppState } from '@/context/AppContext';
import { MapPin, TrendingUp } from 'lucide-react';

export function OptimizationTab() {
  const { state } = useAppState();

  if (state.optimizationResults.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center space-y-4">
        <TrendingUp className="w-12 h-12 text-muted-foreground/30" />
        <div>
          <h3 className="text-sm font-medium text-foreground">No Suggestions Yet</h3>
          <p className="text-xs text-muted-foreground mt-1">
            Run an analysis to get facility placement suggestions based on underserved areas
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="data-card">
        <span className="kpi-label">Optimal Placement Suggestions</span>
        <p className="text-xs text-muted-foreground mt-1">
          Locations ranked by potential impact on underserved populations
        </p>
      </div>

      {state.optimizationResults.map((opt, i) => (
        <div key={i} className="data-card gradient-border">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-full bg-chart-purple/10 flex items-center justify-center flex-shrink-0">
              <span className="text-sm font-mono font-semibold text-chart-purple">#{i + 1}</span>
            </div>
            <div className="space-y-1 min-w-0">
              <div className="flex items-center gap-2">
                <MapPin className="w-3.5 h-3.5 text-chart-purple" />
                <span className="text-xs font-mono text-muted-foreground">
                  {opt.lat.toFixed(4)}, {opt.lon.toFixed(4)}
                </span>
              </div>
              <div className="text-sm font-medium">{opt.reason}</div>
              <div className="flex gap-3 text-xs">
                <span className="text-chart-purple">
                  Score: {opt.score}/100
                </span>
                <span className="text-muted-foreground">
                  ~{opt.affectedPopulation.toLocaleString()} people
                </span>
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
