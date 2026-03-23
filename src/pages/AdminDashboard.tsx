import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowLeft, Users, MapPin, BarChart3, Activity, Globe } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, LineChart, Line, Tooltip } from 'recharts';

export default function AdminDashboard() {
  const navigate = useNavigate();
  const [stats, setStats] = useState({
    totalUsers: 0,
    totalIsochrones: 0,
    totalRoutes: 0,
    totalMatrix: 0,
    totalSaved: 0,
  });
  const [topPlaces, setTopPlaces] = useState<{ place_name: string; count: number }[]>([]);
  const [recentActivity, setRecentActivity] = useState<any[]>([]);
  const [dailyUsage, setDailyUsage] = useState<{ date: string; count: number }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadAdminData();
  }, []);

  async function loadAdminData() {
    setLoading(true);

    const [profiles, isochrones, routes, matrix, saved, searches, recentSearches] = await Promise.all([
      supabase.from('profiles').select('id', { count: 'exact', head: true }),
      supabase.from('isochrone_requests').select('id', { count: 'exact', head: true }),
      supabase.from('route_requests').select('id', { count: 'exact', head: true }),
      supabase.from('matrix_requests').select('id', { count: 'exact', head: true }),
      supabase.from('saved_analyses').select('id', { count: 'exact', head: true }),
      supabase.from('user_search_history').select('place_name').limit(500),
      supabase.from('user_search_history').select('*').order('created_at', { ascending: false }).limit(20),
    ]);

    setStats({
      totalUsers: profiles.count || 0,
      totalIsochrones: isochrones.count || 0,
      totalRoutes: routes.count || 0,
      totalMatrix: matrix.count || 0,
      totalSaved: saved.count || 0,
    });

    // Top places
    if (searches.data) {
      const counts: Record<string, number> = {};
      searches.data.forEach((s: any) => { counts[s.place_name] = (counts[s.place_name] || 0) + 1; });
      const sorted = Object.entries(counts)
        .map(([place_name, count]) => ({ place_name, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);
      setTopPlaces(sorted);
    }

    setRecentActivity(recentSearches.data || []);

    // Daily usage from isochrone_requests
    const { data: isoData } = await supabase.from('isochrone_requests').select('created_at').order('created_at', { ascending: true }).limit(500);
    if (isoData) {
      const daily: Record<string, number> = {};
      isoData.forEach((r: any) => {
        const date = new Date(r.created_at).toISOString().split('T')[0];
        daily[date] = (daily[date] || 0) + 1;
      });
      setDailyUsage(Object.entries(daily).map(([date, count]) => ({ date, count })));
    }

    setLoading(false);
  }

  const kpis = [
    { label: 'Total Users', value: stats.totalUsers, icon: Users, color: 'text-primary' },
    { label: 'Isochrones Generated', value: stats.totalIsochrones, icon: Globe, color: 'text-chart-green' },
    { label: 'Route Requests', value: stats.totalRoutes, icon: MapPin, color: 'text-chart-amber' },
    { label: 'Analyses Saved', value: stats.totalSaved, icon: BarChart3, color: 'text-chart-purple' },
  ];

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b border-border bg-card px-6 py-4 flex items-center gap-4">
        <Button variant="ghost" size="sm" onClick={() => navigate('/')}>
          <ArrowLeft className="w-4 h-4 mr-2" /> Back to Map
        </Button>
        <h1 className="text-lg font-semibold">Admin Analytics</h1>
      </div>

      <div className="max-w-6xl mx-auto p-6 space-y-6">
        {loading ? (
          <p className="text-muted-foreground">Loading analytics...</p>
        ) : (
          <>
            {/* KPIs */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {kpis.map(({ label, value, icon: Icon, color }) => (
                <Card key={label}>
                  <CardContent className="pt-6">
                    <div className="flex items-center gap-2 mb-1">
                      <Icon className={`w-4 h-4 ${color}`} />
                      <span className="text-xs uppercase tracking-wider text-muted-foreground font-medium">{label}</span>
                    </div>
                    <p className={`text-2xl font-semibold font-mono ${color}`}>{value.toLocaleString()}</p>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Charts row */}
            <div className="grid md:grid-cols-2 gap-6">
              {/* Usage over time */}
              <Card>
                <CardHeader><CardTitle className="text-base flex items-center gap-2"><Activity className="w-4 h-4" /> Usage Over Time</CardTitle></CardHeader>
                <CardContent>
                  {dailyUsage.length > 0 ? (
                    <div className="h-48">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={dailyUsage}>
                          <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                          <YAxis tick={{ fontSize: 10 }} />
                          <Tooltip />
                          <Line type="monotone" dataKey="count" stroke="hsl(210, 80%, 45%)" strokeWidth={2} dot={false} />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground py-8 text-center">No usage data yet</p>
                  )}
                </CardContent>
              </Card>

              {/* Top places */}
              <Card>
                <CardHeader><CardTitle className="text-base flex items-center gap-2"><MapPin className="w-4 h-4" /> Top Searched Places</CardTitle></CardHeader>
                <CardContent>
                  {topPlaces.length > 0 ? (
                    <div className="h-48">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={topPlaces.slice(0, 6)} layout="vertical">
                          <XAxis type="number" tick={{ fontSize: 10 }} />
                          <YAxis type="category" dataKey="place_name" tick={{ fontSize: 10 }} width={100} />
                          <Bar dataKey="count" fill="hsl(210, 80%, 45%)" radius={[0, 4, 4, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground py-8 text-center">No search data yet</p>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Recent activity */}
            <Card>
              <CardHeader><CardTitle className="text-base">Recent Activity</CardTitle></CardHeader>
              <CardContent>
                {recentActivity.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No recent activity</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border">
                          <th className="text-left py-2 text-xs text-muted-foreground font-medium">Place</th>
                          <th className="text-left py-2 text-xs text-muted-foreground font-medium">Method</th>
                          <th className="text-left py-2 text-xs text-muted-foreground font-medium">Coordinates</th>
                          <th className="text-left py-2 text-xs text-muted-foreground font-medium">Date</th>
                        </tr>
                      </thead>
                      <tbody>
                        {recentActivity.map((a: any) => (
                          <tr key={a.id} className="border-b border-border/50">
                            <td className="py-2">{a.place_name}</td>
                            <td className="py-2 text-muted-foreground">{a.search_method || 'search'}</td>
                            <td className="py-2 font-mono text-xs text-muted-foreground">{a.latitude?.toFixed(4)}, {a.longitude?.toFixed(4)}</td>
                            <td className="py-2 text-muted-foreground">{new Date(a.created_at).toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
