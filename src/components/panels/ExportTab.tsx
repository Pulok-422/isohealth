import { useState } from 'react';
import { useAppState } from '@/context/AppContext';
import { Download, FileSpreadsheet, FileJson, Link2, Copy, Check, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import { ROUTING_PROVIDER_LABEL } from '@/services/routing';
import type { Facility } from '@/types/health';

function facilityRow(f: Facility, originLat: number, originLon: number, analysisId: string, analysisDate: string, originLabel: string) {
  return {
    'Analysis ID': analysisId,
    'Analysis Date': analysisDate,
    'Origin Latitude': originLat,
    'Origin Longitude': originLon,
    'Origin Label': originLabel,
    'Facility ID': f.id,
    'Facility Name': f.name,
    'Facility Type': f.type,
    'Facility Source': f.source,
    'Source Dataset': f.sourceDataset ?? '',
    'OSM Type': f.osmType ?? '',
    'OSM ID': f.osmId ?? '',
    Latitude: f.lat,
    Longitude: f.lon,
    'Minimum Travel Band': f.minimumBandLabel ?? '',
    'Minimum Band Value': f.minimumBandValue ?? '',
    'Straight-line Distance (m)': Math.round(f.straightLineDistanceMeters),
    'Road Distance (m)': f.travelDistanceMeters != null ? Math.round(f.travelDistanceMeters) : '',
    'Road Travel Time (s)': f.travelDurationSeconds != null ? Math.round(f.travelDurationSeconds) : '',
    'Matrix Evaluated': f.matrixEvaluated ? 'Yes' : 'No',
    'Inside Outermost Isochrone': f.insideOutermostIsochrone ? 'Yes' : 'No',
    Operator: f.operator ?? '',
    'Opening Hours': f.openingHours ?? '',
    Emergency: f.emergency ?? '',
    Speciality: f.speciality ?? '',
  };
}

function buildShareUrl(state: any): string {
  const params = new URLSearchParams();
  if (state.analysisPoint) {
    params.set('lat', state.analysisPoint[0].toFixed(5));
    params.set('lon', state.analysisPoint[1].toFixed(5));
  }
  params.set('mode', state.transportProfile);
  params.set('type', state.analysisType);
  params.set('ranges', (state.analysisType === 'time' ? state.timeThresholds : state.distanceThresholds).join(','));
  return `${window.location.origin}?${params.toString()}`;
}

export function ExportTab() {
  const { state } = useAppState();
  const [copied, setCopied] = useState(false);
  const result = state.analysisResult;
  const hasData = !!result;

  const exportCSV = () => {
    if (!result) return;
    const rows = result.facilities.map((f) =>
      facilityRow(f, result.origin.lat, result.origin.lon, result.analysisId, result.analysisDate, result.origin.label ?? ''),
    );
    if (!rows.length) {
      toast.warning('No facilities to export');
      return;
    }
    const header = Object.keys(rows[0]);
    const csv = [header.join(','), ...rows.map((r) => header.map((h) => JSON.stringify((r as any)[h] ?? '')).join(','))].join('\n');
    saveAs(new Blob([csv], { type: 'text/csv' }), 'isohealth-facilities.csv');
    toast.success('CSV exported');
  };

  const exportExcel = () => {
    if (!result) return;
    const wb = XLSX.utils.book_new();

    const facilityRows = result.facilities.map((f) =>
      facilityRow(f, result.origin.lat, result.origin.lon, result.analysisId, result.analysisDate, result.origin.label ?? ''),
    );
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(facilityRows), 'Facilities');

    const summary = [
      { Metric: 'Transport mode', Value: result.profileUsed },
      { Metric: 'Analysis type', Value: result.analysisTypeUsed },
      { Metric: 'Selected ranges', Value: result.rangesUsed.join(', ') },
      { Metric: 'Facility source mode', Value: result.facilitySourceMode },
      { Metric: 'Reachable facility count', Value: result.facilities.length },
      { Metric: 'Nearby facility count', Value: result.nearbyFacilities.length },
      { Metric: 'Distinct facility types', Value: new Set(result.facilities.map((f) => f.type)).size },
      { Metric: 'Facility query radius (m)', Value: result.facilityQueryRadiusMeters ?? '' },
      { Metric: 'Routing provider', Value: ROUTING_PROVIDER_LABEL },
      { Metric: 'Matrix available', Value: result.matrixAvailable ? 'Yes' : 'No' },
      { Metric: 'Matrix evaluated count', Value: result.matrixCoverage.evaluatedFacilities },
      { Metric: 'Matrix total count', Value: result.matrixCoverage.totalReachableFacilities },
      { Metric: 'Matrix coverage complete', Value: result.matrixCoverage.complete ? 'Yes' : 'No' },
      { Metric: 'Facility result truncated', Value: result.facilityResultTruncated ? 'Yes' : 'No' },
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary), 'Summary');

    const bandRows = result.bands.map((b) => ({
      'Band Label': b.label,
      'Band Value': b.value,
      'Incremental Facility Count': result.incrementalCountsByBand[b.label] ?? 0,
      'Cumulative Facility Count': result.cumulativeCountsByBand[b.label] ?? 0,
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(bandRows), 'Travel Bands');

    const q = result.dataQuality;
    const qualityRows = Object.entries(q).map(([Metric, Value]) => ({ Metric, Value }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(qualityRows), 'Data Quality');

    const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    saveAs(new Blob([buf]), 'isohealth-analysis.xlsx');
    toast.success('Excel exported');
  };

  const exportGeoJSON = () => {
    if (!result) return;
    const features: any[] = [];
    features.push({
      type: 'Feature',
      properties: { role: 'origin', label: result.origin.label ?? '' },
      geometry: { type: 'Point', coordinates: [result.origin.lon, result.origin.lat] },
    });
    for (const f of result.facilities) {
      features.push({
        type: 'Feature',
        properties: {
          name: f.name,
          facilityType: f.type,
          source: f.source,
          sourceDataset: f.sourceDataset ?? null,
          osmType: f.osmType ?? null,
          osmId: f.osmId ?? null,
          minimumBandLabel: f.minimumBandLabel ?? null,
          minimumBandValue: f.minimumBandValue ?? null,
          straightLineDistanceMeters: f.straightLineDistanceMeters,
          travelDistanceMeters: f.travelDistanceMeters ?? null,
          travelDurationSeconds: f.travelDurationSeconds ?? null,
          matrixEvaluated: f.matrixEvaluated,
          operator: f.operator ?? null,
          openingHours: f.openingHours ?? null,
          emergency: f.emergency ?? null,
          speciality: f.speciality ?? null,
        },
        geometry: { type: 'Point', coordinates: [f.lon, f.lat] },
      });
    }
    if (result.isochrones?.features) features.push(...result.isochrones.features);
    saveAs(new Blob([JSON.stringify({ type: 'FeatureCollection', features }, null, 2)], { type: 'application/geo+json' }), 'isohealth-analysis.geojson');
    toast.success('GeoJSON exported');
  };

  const exportMethodology = () => {
    if (!result) return;
    const doc = {
      analysisId: result.analysisId,
      analysisDate: result.analysisDate,
      origin: result.origin,
      transportProfile: result.profileUsed,
      analysisType: result.analysisTypeUsed,
      ranges: result.rangesUsed,
      routingProvider: ROUTING_PROVIDER_LABEL,
      facilitySourceMode: result.facilitySourceMode,
      facilityQueryRadiusMeters: result.facilityQueryRadiusMeters,
      facilityTagsQueried: [
        'amenity=hospital', 'amenity=clinic', 'amenity=pharmacy', 'amenity=doctors', 'amenity=dentist',
        'healthcare=hospital', 'healthcare=clinic', 'healthcare=pharmacy', 'healthcare=doctor',
        'healthcare=doctors', 'healthcare=centre', 'healthcare=health_centre', 'healthcare=dentist',
        'healthcare=laboratory',
      ],
      matrixCoverage: result.matrixCoverage,
      limitations: [
        'Facility coverage depends on OpenStreetMap completeness.',
        'Matrix limited to the nearest 250 facilities per analysis.',
        'Road-network metrics unavailable when the routing service is offline.',
      ],
    };
    saveAs(new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' }), 'isohealth-methodology.json');
    toast.success('Methodology exported');
  };

  const copyShareLink = async () => {
    const url = buildShareUrl(state);
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success('Share link copied');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Failed to copy link');
    }
  };

  return (
    <div className="space-y-3 p-3">
      <div className="data-card">
        <span className="kpi-label">Share & export</span>
        <p className="text-xs text-muted-foreground mt-1">Share the current settings or download the analysis outputs.</p>
      </div>

      <Button size="sm" variant="outline" onClick={copyShareLink} className="w-full justify-start gap-2">
        {copied ? <Check className="w-3.5 h-3.5 text-success" /> : <Link2 className="w-3.5 h-3.5" />}
        {copied ? 'Copied' : 'Copy share link'}
      </Button>

      <div className="border-t border-border pt-3 space-y-2">
        <span className="kpi-label">Data export</span>
        <Button size="sm" variant="outline" onClick={exportCSV} disabled={!hasData} className="w-full justify-start gap-2">
          <Download className="w-3.5 h-3.5" /> Facilities CSV
        </Button>
        <Button size="sm" variant="outline" onClick={exportExcel} disabled={!hasData} className="w-full justify-start gap-2">
          <FileSpreadsheet className="w-3.5 h-3.5" /> Excel workbook
        </Button>
        <Button size="sm" variant="outline" onClick={exportGeoJSON} disabled={!hasData} className="w-full justify-start gap-2">
          <FileJson className="w-3.5 h-3.5" /> GeoJSON
        </Button>
        <Button size="sm" variant="outline" onClick={exportMethodology} disabled={!hasData} className="w-full justify-start gap-2">
          <FileText className="w-3.5 h-3.5" /> Methodology JSON
        </Button>
      </div>

      {!hasData && (
        <p className="text-xs text-muted-foreground text-center py-2">Run an analysis first to enable data exports.</p>
      )}
    </div>
  );
}