import { Building2, MapPin, Users, AlertTriangle, Clock, Ruler, Save } from 'lucide-react';
import { useAppState } from '@/context/AppContext';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { formatDuration, formatDistance } from '@/lib/analysis';
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { useState } from 'react';

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
  const { user } = useAuth();
  const result = state.analysisResult;
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!user || !result) return;
    setSaving(true);
    const { error } = await supabase.from('saved_analyses').insert({
      user_id: user.id,
      title: `Analysis at ${state.analysisPoint?.[0].toFixed(4)}, ${state.analysisPoint?.[1].toFixed(4)}`,
      latitude: state.analysisPoint?.[0] || 0,
      longitude: state.analysisPoint?.[1] || 0,
      settings_json: { transportProfile: state.transportProfile, thresholds: state.timeThresholds },
      results_json: {
        facilityCount: result.facilities.length,
        populationCovered: result.populationCovered,
        populationUnderserved: result.populationUnderserved,
      },
    });
    setSaving(false);
    if (error) toast.error('Failed to save');
    else toast.success('Analysis saved to dashboard');
  };

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
    { name: 'With Access', value: result.populationCovered, color: 'hsl(152, 60%, 38%)' },
    { name: 'Lacking Access', value: result.populationUnderserved, color: 'hsl(0, 72%, 51%)' },
  ];

  return (
    <div className="space-y-4">
      {/* Save button */}
      {user && (
        <Button size="sm" variant="outline" onClick={handleSave} disabled={saving} className="w-full gap-1.5">
          <Save className="w-3.5 h-3.5" />
          {saving ? 'Saving...' : 'Save Analysis'}
        </Button>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-2">
        <KPICard icon={Building2} label="Nearby Health Facilities" value={result.facilities.length} />
        <KPICard icon={Clock} label="Closest Facility" value={result.nearestDuration ? formatDuration(result.nearestDuration) : '—'} color="text-primary" />
        <KPICard icon={Users} label="Population with Access" value={`${coveragePercent}%`} color="text-success" />
        <KPICard icon={AlertTriangle} label="Population Lacking Access" value={result.populationUnderserved.toLocaleString()} color="text-destructive" />
      </div>

      {/* Nearest facility */}
      {result.nearestFacility && (
        <div className="data-card">
          <span className="kpi-label">Nearest Health Facility</span>
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
              <Pie data={pieData} cx="50%" cy="50%" innerRadius={30} outerRadius={50} dataKey="value" stroke="none">
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
            With Access ({result.populationCovered.toLocaleString()})
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-destructive" />
            Lacking Access ({result.populationUnderserved.toLocaleString()})
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
                <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Bar dataKey="count" fill="hsl(210, 80%, 45%)" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}
