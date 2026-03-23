import { Building2, MapPin, Users, AlertTriangle, Clock, Ruler } from 'lucide-react';
import { useAppState } from '@/context/AppContext';
import { formatDuration, formatDistance } from '@/lib/analysis';
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';

function KPICard({ icon: Icon, label, value, color = 'text-primary' }: {
  icon: typeof Building2;
  label: string;
  value: string | number;
  color?: string;
}) {
  return (
    <div className="data-card">
      <div className="flex items-center gap-2">
        <Icon className={`w-4 h-4 ${color}`} />
        <span className="kpi-label">{label}</span>
      </div>
      <div className={`kpi-value ${color}`}>{value}</div>
    </div>
  );
}

export function SummaryTab() {
  const { state } = useAppState();
  const result = state.analysisResult;

  if (!result) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center space-y-4">
        <MapPin className="w-12 h-12 text-muted-foreground/30" />
        <div>
          <h3 className="text-sm font-medium text-foreground">No Analysis Yet</h3>
          <p className="text-xs text-muted-foreground mt-1">
            Click on the map or search a location to begin analysis
          </p>
        </div>
      </div>
    );
  }

  const coveragePercent = result.totalPopulation > 0
    ? Math.round((result.populationCovered / result.totalPopulation) * 100)
    : 0;

  const facilityTypes = result.facilities.reduce((acc, f) => {
    acc[f.type] = (acc[f.type] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const chartData = Object.entries(facilityTypes).map(([name, count]) => ({ name, count }));

  const pieData = [
    { name: 'Covered', value: result.populationCovered, color: 'hsl(152, 60%, 45%)' },
    { name: 'Underserved', value: result.populationUnderserved, color: 'hsl(0, 72%, 51%)' },
  ];

  return (
    <div className="space-y-4">
      {/* KPIs */}
      <div className="grid grid-cols-2 gap-2">
        <KPICard icon={Building2} label="Facilities" value={result.facilities.length} />
        <KPICard
          icon={Clock}
          label="Nearest"
          value={result.nearestDuration ? formatDuration(result.nearestDuration) : '—'}
          color="text-chart-cyan"
        />
        <KPICard
          icon={Users}
          label="Covered"
          value={`${coveragePercent}%`}
          color="text-success"
        />
        <KPICard
          icon={AlertTriangle}
          label="Underserved"
          value={result.populationUnderserved.toLocaleString()}
          color="text-destructive"
        />
      </div>

      {/* Nearest facility */}
      {result.nearestFacility && (
        <div className="data-card">
          <span className="kpi-label">Nearest Facility</span>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-sm font-medium">{result.nearestFacility.name}</span>
          </div>
          <div className="flex gap-3 mt-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Ruler className="w-3 h-3" />
              {result.nearestDistance ? formatDistance(result.nearestDistance) : '—'}
            </span>
            <span className="capitalize">{result.nearestFacility.type}</span>
          </div>
        </div>
      )}

      {/* Coverage Chart */}
      <div className="data-card">
        <span className="kpi-label">Population Coverage</span>
        <div className="h-32 mt-2">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={pieData}
                cx="50%"
                cy="50%"
                innerRadius={30}
                outerRadius={50}
                dataKey="value"
                stroke="none"
              >
                {pieData.map((entry, idx) => (
                  <Cell key={idx} fill={entry.color} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="flex justify-center gap-4 text-xs">
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-success" />
            Covered ({result.populationCovered.toLocaleString()})
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-destructive" />
            Gap ({result.populationUnderserved.toLocaleString()})
          </span>
        </div>
      </div>

      {/* Facility Types */}
      {chartData.length > 0 && (
        <div className="data-card">
          <span className="kpi-label">Facility Types</span>
          <div className="h-28 mt-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <XAxis dataKey="name" tick={{ fill: 'hsl(215, 12%, 50%)', fontSize: 10 }} />
                <YAxis tick={{ fill: 'hsl(215, 12%, 50%)', fontSize: 10 }} />
                <Bar dataKey="count" fill="hsl(187, 80%, 48%)" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}
