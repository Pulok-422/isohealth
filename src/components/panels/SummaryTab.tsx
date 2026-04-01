import { Building2, MapPin, Users, Clock, Ruler, Save, Info, Zap, Shield, AlertTriangle, CheckCircle } from 'lucide-react';
import { useAppState } from '@/context/AppContext';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { formatDistanceCompact, formatTravelTime } from '@/lib/travelTime';
import { haversine } from '@/lib/analysis';
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer } from 'recharts';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { toast } from 'sonner';
import { useState, useMemo } from 'react';
import type { Facility, TransportProfile } from '@/types/health';

function formatPopulation(n: number): string {
  if (n >= 1_000_000) return `~${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `~${(n / 1_000).toFixed(0)}K`;
  return `~${n}`;
}

function getThresholdLabel(state: any): string {
  const profile = state.transportProfile as TransportProfile;
  const modeLabel: Record<TransportProfile, string> = {
    'foot-walking': 'walking',
    'cycling-regular': 'cycling',
    'driving-car': 'driving',
  };
  const mode = modeLabel[profile] || 'walking';

  if (state.analysisType === 'distance') {
    const maxDist = Math.max(...(state.distanceThresholds || [6000]));
    return `${(maxDist / 1000).toFixed(0)} km ${mode}`;
  }
  const maxTime = Math.max(...(state.timeThresholds || [3600]));
  return `${Math.round(maxTime / 60)} min ${mode}`;
}

function getCoverageLevel(facilityCount: number): { label: string; color: string; icon: typeof CheckCircle; description: string } {
  if (facilityCount >= 20) return {
    label: 'Good',
    color: 'text-success',
    icon: CheckCircle,
    description: 'Strong healthcare coverage with multiple facility types accessible.',
  };
  if (facilityCount >= 5) return {
    label: 'Moderate',
    color: 'text-chart-amber',
    icon: Shield,
    description: 'Some healthcare access available, but coverage could be improved.',
  };
  return {
    label: 'Poor',
    color: 'text-destructive',
    icon: AlertTriangle,
    description: 'Limited healthcare access. Consider expanding range or changing transport mode.',
  };
}

function KPICard({ icon: Icon, label, value, subtitle, color = 'text-primary', tooltip }: {
  icon: typeof Building2;
  label: string;
  value: string | number;
  subtitle?: string;
  color?: string;
  tooltip?: string;
}) {
  const card = (
    <div className="data-card">
      <div className="flex items-center gap-2">
        <Icon className={`w-4 h-4 ${color}`} />
        <span className="kpi-label">{label}</span>
        {tooltip && <Info className="w-3 h-3 text-muted-foreground/50" />}
      </div>
      <div className={`kpi-value ${color}`}>{value}</div>
      {subtitle && <div className="text-[10px] text-muted-foreground mt-0.5">{subtitle}</div>}
    </div>
  );

  if (!tooltip) return card;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{card}</TooltipTrigger>
        <TooltipContent className="max-w-[250px] text-xs">
          <p>{tooltip}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function NearestByType({ facilities, analysisPoint, profile }: {
  facilities: Facility[];
  analysisPoint: [number, number];
  profile: TransportProfile;
}) {
  const nearestByType = useMemo(() => {
    const types = ['hospital', 'pharmacy', 'clinic', 'doctors', 'healthcare'] as const;
    const result: { type: string; facility: Facility; distMeters: number }[] = [];

    for (const type of types) {
      const ofType = facilities.filter(f => f.type === type);
      if (!ofType.length) continue;

      let nearest = ofType[0];
      let minDist = haversine(analysisPoint[0], analysisPoint[1], nearest.lat, nearest.lon);

      for (let i = 1; i < ofType.length; i++) {
        const d = haversine(analysisPoint[0], analysisPoint[1], ofType[i].lat, ofType[i].lon);
        if (d < minDist) { minDist = d; nearest = ofType[i]; }
      }

      result.push({ type, facility: nearest, distMeters: minDist * 1000 });
    }

    return result.sort((a, b) => a.distMeters - b.distMeters);
  }, [facilities, analysisPoint, profile]);

  if (!nearestByType.length) return null;

  const typeLabels: Record<string, string> = {
    hospital: '🏥 Closest Hospital',
    pharmacy: '💊 Closest Pharmacy',
    clinic: '🏨 Closest Clinic',
    doctors: '👨‍⚕️ Closest Doctor',
    healthcare: '⚕️ Closest Healthcare',
  };

  return (
    <div className="data-card space-y-2">
      <span className="kpi-label">Nearest Facilities by Type</span>
      {nearestByType.map(({ type, facility, distMeters }) => (
        <div key={type} className="flex items-start justify-between gap-2 py-1.5 border-b border-border/50 last:border-0">
          <div className="min-w-0">
            <div className="text-xs font-medium text-muted-foreground">{typeLabels[type] || type}</div>
            <div className="text-sm font-medium truncate">{facility.name}</div>
          </div>
          <div className="text-right shrink-0">
            <div className="text-xs font-medium">{formatDistanceCompact(distMeters)}</div>
            <div className="text-[10px] text-muted-foreground">{formatTravelTime(distMeters, profile)}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function FacilityMixInsight({ facilities }: { facilities: Facility[] }) {
  const insight = useMemo(() => {
    if (!facilities.length) return null;
    const counts: Record<string, number> = {};
    facilities.forEach(f => { counts[f.type] = (counts[f.type] || 0) + 1; });
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    if (sorted.length < 2) return null;

    const most = sorted[0][0];
    const least = sorted[sorted.length - 1][0];
    return `Most reachable facilities are ${most}s, while ${least} access is more limited.`;
  }, [facilities]);

  if (!insight) return null;

  return (
    <div className="flex items-start gap-2 p-2.5 rounded-lg bg-secondary/50 text-xs text-muted-foreground">
      <Zap className="w-3.5 h-3.5 mt-0.5 shrink-0 text-primary" />
      <span>{insight}</span>
    </div>
  );
}

export function SummaryTab() {
  const { state } = useAppState();
  const { user } = useAuth();
  const result = state.analysisResult;
  const [saving, setSaving] = useState(false);

  const profile = (result?.profileUsed || state.transportProfile) as TransportProfile;
  const thresholdLabel = getThresholdLabel(state);

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
      },
    });
    setSaving(false);
    if (error) toast.error('Failed to save');
    else toast.success('Analysis saved to dashboard');
  };

  if (!result) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center space-y-4 p-6">
        <MapPin className="w-12 h-12 text-muted-foreground/30" />
        <div>
          <h3 className="text-sm font-medium text-foreground">No analysis yet</h3>
          <p className="text-xs text-muted-foreground mt-1">
            Select a location on the map or search for a place, then click <strong>Analyze Accessibility</strong> to discover nearby healthcare facilities and coverage.
          </p>
        </div>
      </div>
    );
  }

  const facilityTypes = result.facilities.reduce((acc, f) => {
    acc[f.type] = (acc[f.type] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const chartData = Object.entries(facilityTypes).map(([name, count]) => ({ name, count }));

  const sourceLabel = result.populationSource === 'worldpop'
    ? 'WorldPop (estimated)'
    : 'Simulated (fallback)';

  const methodTooltip = result.populationMethod
    || 'Population estimates based on WorldPop country-level density data with spatial intersection against isochrone geometry.';

  // Coverage level
  const coverage = getCoverageLevel(result.facilities.length);
  const CoverageIcon = coverage.icon;

  // Key insight line
  const keyInsight = result.facilities.length > 0
    ? `${result.facilities.length} health facilities are reachable within ${thresholdLabel}, covering an estimated ${formatPopulation(result.populationCovered)} people.`
    : `No health facilities found within ${thresholdLabel}. Try increasing the range or switching transport mode.`;

  return (
    <div className="space-y-3 p-3">
      {/* Save button */}
      {user && (
        <Button size="sm" variant="outline" onClick={handleSave} disabled={saving} className="w-full gap-1.5">
          <Save className="w-3.5 h-3.5" />
          {saving ? 'Saving...' : 'Save Analysis'}
        </Button>
      )}

      {/* Key Insight */}
      <div className="p-3 rounded-lg bg-primary/5 border border-primary/10">
        <p className="text-xs font-medium text-foreground leading-relaxed">{keyInsight}</p>
      </div>

      {/* Coverage Level */}
      <div className="flex items-center gap-3 p-2.5 rounded-lg border border-border bg-card">
        <CoverageIcon className={`w-5 h-5 ${coverage.color}`} />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold">Coverage Level:</span>
            <span className={`text-xs font-bold ${coverage.color}`}>{coverage.label}</span>
          </div>
          <p className="text-[10px] text-muted-foreground mt-0.5">{coverage.description}</p>
        </div>
      </div>

      {/* Coverage Threshold Badge */}
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Clock className="w-3 h-3" />
        Coverage threshold: <span className="font-semibold text-foreground">{thresholdLabel}</span>
      </div>

      {/* Population Source Badge */}
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-help">
              <Info className="w-3 h-3" />
              Population Source: <span className="font-medium text-foreground">{sourceLabel}</span>
            </div>
          </TooltipTrigger>
          <TooltipContent className="max-w-[300px] text-xs">
            <p>{methodTooltip}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-2">
        <KPICard
          icon={Building2}
          label="Nearby Health Facilities"
          value={result.facilities.length}
          subtitle={`within ${thresholdLabel}`}
        />
        <KPICard
          icon={Users}
          label="Est. Population in Service Area"
          value={formatPopulation(result.populationCovered)}
          color="text-success"
          tooltip="Estimated population within the isochrone coverage area, based on WorldPop density data."
        />
      </div>

      {/* Facility Mix Insight */}
      <FacilityMixInsight facilities={result.facilities} />

      {/* Nearest Facilities by Type */}
      {state.analysisPoint && (
        <NearestByType
          facilities={result.facilities}
          analysisPoint={state.analysisPoint}
          profile={profile}
        />
      )}

      {/* Facility Types Chart */}
      {chartData.length > 0 && (
        <div className="data-card">
          <span className="kpi-label">Facility Types</span>
          <div className="h-28 mt-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Bar dataKey="count" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Data source attribution */}
      <div className="text-[10px] text-muted-foreground space-y-0.5 pt-2 border-t border-border">
        <p>📍 Facility data: OpenStreetMap contributors</p>
        <p>📊 Travel time estimated using road network data</p>
      </div>
    </div>
  );
}
