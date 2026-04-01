import { useState } from 'react';
import { useAppState } from '@/context/AppContext';
import { Download, FileSpreadsheet, FileJson, Link2, Image, Copy, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';

function buildShareUrl(state: any): string {
  const params = new URLSearchParams();
  if (state.analysisPoint) {
    params.set('lat', state.analysisPoint[0].toFixed(5));
    params.set('lon', state.analysisPoint[1].toFixed(5));
  }
  params.set('mode', state.transportProfile);
  params.set('type', state.analysisType);
  if (state.analysisType === 'time') {
    params.set('ranges', state.timeThresholds.join(','));
  } else {
    params.set('ranges', state.distanceThresholds.join(','));
  }
  return `${window.location.origin}?${params.toString()}`;
}

export function ExportTab() {
  const { state } = useAppState();
  const [copied, setCopied] = useState(false);

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
    const features: any[] = state.analysisResult.facilities.map(f => ({
      type: 'Feature',
      properties: { name: f.name, type: f.type, simulated: f.isSimulated },
      geometry: { type: 'Point', coordinates: [f.lon, f.lat] },
    }));

    // Include isochrone geometries
    if (state.analysisResult.isochrones?.features) {
      features.push(...state.analysisResult.isochrones.features);
    }

    const geojson = { type: 'FeatureCollection', features };
    const blob = new Blob([JSON.stringify(geojson, null, 2)], { type: 'application/json' });
    saveAs(blob, 'health-analysis.geojson');
    toast.success('GeoJSON exported (facilities + isochrones)');
  };

  const copyShareLink = async () => {
    const url = buildShareUrl(state);
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success('Share link copied to clipboard');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Failed to copy link');
    }
  };

  const downloadMapPNG = async () => {
    try {
      const { toPng } = await import('html-to-image');
      const mapEl = document.querySelector('.leaflet-container') as HTMLElement;
      if (!mapEl) { toast.error('Map not found'); return; }

      toast.info('Capturing map...');
      const dataUrl = await toPng(mapEl, { quality: 0.95, backgroundColor: '#fff' });
      const link = document.createElement('a');
      link.download = 'isohealth-map.png';
      link.href = dataUrl;
      link.click();
      toast.success('Map image downloaded');
    } catch {
      toast.error('Failed to capture map');
    }
  };

  const hasData = !!state.analysisResult;

  return (
    <div className="space-y-3 p-3">
      {/* Share */}
      <div className="data-card">
        <span className="kpi-label">Share & Export</span>
        <p className="text-xs text-muted-foreground mt-1">
          Share your analysis or download data and map images
        </p>
      </div>

      <div className="space-y-2">
        <Button
          size="sm"
          variant="outline"
          onClick={copyShareLink}
          className="w-full justify-start gap-2"
        >
          {copied ? <Check className="w-3.5 h-3.5 text-success" /> : <Link2 className="w-3.5 h-3.5" />}
          {copied ? 'Copied!' : 'Copy Share Link'}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={downloadMapPNG}
          className="w-full justify-start gap-2"
        >
          <Image className="w-3.5 h-3.5" />
          Download Map as PNG
        </Button>
      </div>

      <div className="border-t border-border pt-3 space-y-2">
        <span className="kpi-label">Data Export</span>
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
          Run an analysis first to enable data exports
        </p>
      )}
    </div>
  );
}
