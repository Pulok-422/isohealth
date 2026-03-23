import { useState } from 'react';
import { useAppState } from '@/context/AppContext';
import { Download, FileSpreadsheet, Map, FileJson } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';

export function ExportTab() {
  const { state } = useAppState();
  const [exporting, setExporting] = useState(false);

  const exportCSV = () => {
    if (!state.analysisResult) return;
    const rows = state.analysisResult.facilities.map(f => ({
      Name: f.name,
      Type: f.type,
      Latitude: f.lat,
      Longitude: f.lon,
      Simulated: f.isSimulated ? 'Yes' : 'No',
    }));
    const header = Object.keys(rows[0] || {}).join(',');
    const csv = [header, ...rows.map(r => Object.values(r).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    saveAs(blob, 'health-facilities.csv');
    toast.success('CSV exported');
  };

  const exportExcel = () => {
    if (!state.analysisResult) return;
    const facilities = state.analysisResult.facilities.map(f => ({
      Name: f.name,
      Type: f.type,
      Latitude: f.lat,
      Longitude: f.lon,
      Simulated: f.isSimulated ? 'Yes' : 'No',
    }));

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(facilities);
    XLSX.utils.book_append_sheet(wb, ws, 'Facilities');

    // KPIs sheet
    const kpis = [
      { Metric: 'Total Facilities', Value: state.analysisResult.facilities.length },
      { Metric: 'Population Covered', Value: state.analysisResult.populationCovered },
      { Metric: 'Population Underserved', Value: state.analysisResult.populationUnderserved },
      { Metric: 'Coverage %', Value: state.analysisResult.totalPopulation > 0 ? Math.round((state.analysisResult.populationCovered / state.analysisResult.totalPopulation) * 100) : 0 },
    ];
    const ws2 = XLSX.utils.json_to_sheet(kpis);
    XLSX.utils.book_append_sheet(wb, ws2, 'Summary');

    const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    saveAs(new Blob([buf]), 'health-analysis.xlsx');
    toast.success('Excel exported');
  };

  const exportGeoJSON = () => {
    if (!state.analysisResult) return;
    const geojson = {
      type: 'FeatureCollection',
      features: state.analysisResult.facilities.map(f => ({
        type: 'Feature',
        properties: { name: f.name, type: f.type, simulated: f.isSimulated },
        geometry: { type: 'Point', coordinates: [f.lon, f.lat] },
      })),
    };
    const blob = new Blob([JSON.stringify(geojson, null, 2)], { type: 'application/json' });
    saveAs(blob, 'health-facilities.geojson');
    toast.success('GeoJSON exported');
  };

  const hasData = !!state.analysisResult;

  return (
    <div className="space-y-3">
      <div className="data-card">
        <span className="kpi-label">Export Analysis Data</span>
        <p className="text-xs text-muted-foreground mt-1">
          Download facility data, coverage statistics, and analysis results
        </p>
      </div>

      <div className="space-y-2">
        <Button
          size="sm"
          variant="outline"
          onClick={exportCSV}
          disabled={!hasData}
          className="w-full justify-start gap-2"
        >
          <Download className="w-3.5 h-3.5" />
          Export as CSV
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={exportExcel}
          disabled={!hasData}
          className="w-full justify-start gap-2"
        >
          <FileSpreadsheet className="w-3.5 h-3.5" />
          Export as Excel
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={exportGeoJSON}
          disabled={!hasData}
          className="w-full justify-start gap-2"
        >
          <FileJson className="w-3.5 h-3.5" />
          Export as GeoJSON
        </Button>
      </div>

      {!hasData && (
        <p className="text-xs text-muted-foreground text-center py-2">
          Run an analysis first to enable exports
        </p>
      )}
    </div>
  );
}
