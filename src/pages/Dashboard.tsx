import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowLeft, Clock, MapPin, Trash2, Search } from 'lucide-react';
import { toast } from 'sonner';

interface SavedAnalysis {
  id: string;
  title: string;
  location_name: string | null;
  latitude: number;
  longitude: number;
  created_at: string;
}

interface SearchEntry {
  id: string;
  place_name: string;
  latitude: number;
  longitude: number;
  search_method: string | null;
  created_at: string;
}

export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [savedAnalyses, setSavedAnalyses] = useState<SavedAnalysis[]>([]);
  const [searchHistory, setSearchHistory] = useState<SearchEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    loadData();
  }, [user]);

  async function loadData() {
    setLoading(true);
    const [analyses, searches] = await Promise.all([
      supabase.from('saved_analyses').select('*').eq('user_id', user!.id).order('created_at', { ascending: false }).limit(20),
      supabase.from('user_search_history').select('*').eq('user_id', user!.id).order('created_at', { ascending: false }).limit(30),
    ]);
    setSavedAnalyses((analyses.data as SavedAnalysis[]) || []);
    setSearchHistory((searches.data as SearchEntry[]) || []);
    setLoading(false);
  }

  async function deleteAnalysis(id: string) {
    await supabase.from('saved_analyses').delete().eq('id', id);
    setSavedAnalyses(prev => prev.filter(a => a.id !== id));
    toast.success('Analysis deleted');
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b border-border bg-card px-6 py-4 flex items-center gap-4">
        <Button variant="ghost" size="sm" onClick={() => navigate('/')}>
          <ArrowLeft className="w-4 h-4 mr-2" /> Back to Map
        </Button>
        <h1 className="text-lg font-semibold">My Dashboard</h1>
      </div>

      <div className="max-w-5xl mx-auto p-6 space-y-6">
        {/* Saved Analyses */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <MapPin className="w-4 h-4 text-primary" /> Saved Analyses
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-sm text-muted-foreground">Loading...</p>
            ) : savedAnalyses.length === 0 ? (
              <p className="text-sm text-muted-foreground">No saved analyses yet. Run an analysis and save it to see it here.</p>
            ) : (
              <div className="space-y-2">
                {savedAnalyses.map((a) => (
                  <div key={a.id} className="flex items-center justify-between p-3 border border-border rounded-lg hover:bg-secondary/50 transition-colors">
                    <div>
                      <p className="text-sm font-medium">{a.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {a.location_name || `${a.latitude.toFixed(4)}, ${a.longitude.toFixed(4)}`} · {new Date(a.created_at).toLocaleDateString()}
                      </p>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => deleteAnalysis(a.id)}>
                      <Trash2 className="w-3.5 h-3.5 text-destructive" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Search History */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Search className="w-4 h-4 text-primary" /> Recent Searches
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-sm text-muted-foreground">Loading...</p>
            ) : searchHistory.length === 0 ? (
              <p className="text-sm text-muted-foreground">No search history yet.</p>
            ) : (
              <div className="space-y-1">
                {searchHistory.map((s) => (
                  <div key={s.id} className="flex items-center gap-3 p-2 text-sm">
                    <Clock className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                    <span className="font-medium">{s.place_name}</span>
                    <span className="text-xs text-muted-foreground ml-auto">
                      {new Date(s.created_at).toLocaleDateString()}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
