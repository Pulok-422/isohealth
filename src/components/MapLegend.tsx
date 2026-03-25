import { useAppState } from '@/context/AppContext';

const COLORS = [
  'rgba(255, 245, 157, 0.60)',
  'rgba(255, 224, 130, 0.60)',
  'rgba(255, 183, 77, 0.60)',
  'rgba(255, 138, 101, 0.60)',
  'rgba(239, 83, 80, 0.60)',
  'rgba(173, 20, 87, 0.60)',
];

const BORDER_COLORS = [
  '#fff59d',
  '#ffe082',
  '#ffb74d',
  '#ff8a65',
  '#ef5350',
  '#ad1457',
];

export function MapLegend() {
  const { state } = useAppState();

  if (!state.analysisResult?.isochrones || !state.showIsochrones) return null;

  const features = state.analysisResult.isochrones.features || [];
  if (features.length === 0) return null;

  const sortedValues = [...features]
    .map((f: any) => f.properties?.value)
    .filter(Boolean)
    .sort((a, b) => a - b);

  const uniqueValues = [...new Set(sortedValues)];
  const isTime = state.analysisType === 'time';

  return (
    <div className="absolute bottom-6 left-4 z-[1000] bg-card/95 backdrop-blur-sm border border-border rounded-lg shadow-lg p-3 min-w-[120px]">
      <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
        {isTime ? 'Range (min)' : 'Range (km)'}
      </div>
      <div className="space-y-1">
        {uniqueValues.map((val, i) => {
          const colorIdx = Math.min(i, COLORS.length - 1);
          const label = isTime ? `${Math.round(val / 60)} min` : `${(val / 1000).toFixed(0)} km`;
          return (
            <div key={val} className="flex items-center gap-2">
              <div
                className="w-4 h-3 rounded-sm border"
                style={{
                  backgroundColor: COLORS[colorIdx],
                  borderColor: BORDER_COLORS[colorIdx],
                }}
              />
              <span className="text-xs text-foreground">{label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
