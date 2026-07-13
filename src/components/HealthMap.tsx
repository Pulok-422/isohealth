import { useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, useMap, useMapEvents, GeoJSON, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import 'leaflet.markercluster';
import { useAppState } from '@/context/AppContext';
import { Layers } from 'lucide-react';
import { MapLegend } from '@/components/MapLegend';
import type { Facility, FacilityType } from '@/types/health';

const ISOCHRONE_COLORS = [
  'rgba(255, 245, 157, 0.60)',
  'rgba(255, 224, 130, 0.60)',
  'rgba(255, 183, 77, 0.60)',
  'rgba(255, 138, 101, 0.60)',
  'rgba(239, 83, 80, 0.60)',
  'rgba(173, 20, 87, 0.60)',
];
const ISOCHRONE_BORDERS = ['#fff59d', '#ffe082', '#ffb74d', '#ff8a65', '#ef5350', '#ad1457'];

const BASEMAPS = {
  positron: { url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', label: 'Light', attribution: '&copy; CARTO' },
  osm: { url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', label: 'OSM', attribution: '&copy; OpenStreetMap' },
  satellite: { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', label: 'Satellite', attribution: '&copy; Esri' },
};

const TYPE_ICONS: Record<FacilityType, string> = {
  hospital: '🏥',
  clinic: '⚕️',
  pharmacy: '💊',
  doctors: '👨‍⚕️',
  dentist: '🦷',
  laboratory: '🧪',
  healthcare: '+',
};

function createFacilityIcon(facility: Facility) {
  const emoji = TYPE_ICONS[facility.type] || '⚕️';
  const isUploaded = facility.source === 'Uploaded';
  const border = isUploaded
    ? 'border: 2px dashed hsl(38, 90%, 55%);'
    : 'border: 2px solid hsl(210, 80%, 45%);';
  return L.divIcon({
    html: `<div style="font-size:18px;width:32px;height:32px;display:flex;align-items:center;justify-content:center;background:white;border-radius:50%;${border}box-shadow:0 2px 6px rgba(0,0,0,0.15);font-weight:700;color:hsl(210,80%,35%);">${emoji}</div>`,
    className: '',
    iconSize: [32, 32],
    iconAnchor: [16, 16],
  });
}

const selectedLocationIcon = L.divIcon({
  html: `<div style="position:relative;width:28px;height:28px;display:flex;align-items:center;justify-content:center;">
    <style>@keyframes ulp{0%{transform:scale(0.9);opacity:.85}70%{transform:scale(2.3);opacity:0}100%{transform:scale(2.3);opacity:0}}</style>
    <div style="position:absolute;width:18px;height:18px;border-radius:9999px;background:rgba(220,38,38,0.35);animation:ulp 1.6s ease-out infinite;"></div>
    <div style="position:absolute;width:14px;height:14px;background:#dc2626;border:3px solid #fff;border-radius:9999px;box-shadow:0 0 0 2px rgba(220,38,38,0.25),0 3px 10px rgba(0,0,0,0.35);"></div>
  </div>`,
  className: '',
  iconSize: [28, 28],
  iconAnchor: [14, 14],
  popupAnchor: [0, -12],
});

function escapeHtml(v: unknown) {
  return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function formatMeters(m?: number) {
  if (m == null || !Number.isFinite(m)) return null;
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
}

function formatSeconds(s?: number) {
  if (s == null || !Number.isFinite(s)) return null;
  const mins = Math.round(s / 60);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const r = mins % 60;
  return r ? `${h}h ${r}m` : `${h}h`;
}

function buildFacilityPopupHtml(f: Facility) {
  const rows: [string, string | null | undefined][] = [
    ['Source', f.source + (f.osmType ? ` (${f.osmType}/${f.osmId})` : '')],
    ['Minimum travel band', f.minimumBandLabel ?? null],
    ['Road travel time', formatSeconds(f.travelDurationSeconds)],
    ['Road travel distance', formatMeters(f.travelDistanceMeters)],
    ['Straight-line distance', formatMeters(f.straightLineDistanceMeters)],
    ['Operator', f.operator ?? null],
    ['Opening hours', f.openingHours ?? null],
    ['Emergency', f.emergency ?? null],
    ['Speciality', f.speciality ?? null],
  ];
  const rowHtml = rows
    .filter(([, v]) => v != null && v !== '')
    .map(
      ([k, v]) => `<div style="display:flex;justify-content:space-between;gap:10px;font-size:12px;">
        <span style="color:#64748b;">${escapeHtml(k)}</span>
        <span style="color:#0f172a;font-weight:500;text-align:right;">${escapeHtml(v)}</span>
      </div>`,
    )
    .join('');

  return `<div style="min-width:220px;max-width:280px;font-size:13px;line-height:1.45;">
    <div style="font-weight:700;font-size:14px;color:#0f172a;">${escapeHtml(f.name)}</div>
    <div style="margin:3px 0 8px 0;">
      <span style="display:inline-flex;align-items:center;padding:2px 8px;border-radius:9999px;background:rgba(37,99,235,0.10);color:#1d4ed8;font-size:11px;font-weight:600;text-transform:capitalize;">
        ${escapeHtml(f.type)}
      </span>
    </div>
    <div style="display:flex;flex-direction:column;gap:5px;">${rowHtml}</div>
    <div style="margin-top:6px;font-size:11px;color:#94a3b8;">${f.lat.toFixed(5)}, ${f.lon.toFixed(5)}</div>
  </div>`;
}

function MapUpdater() {
  const { state } = useAppState();
  const map = useMap();
  useEffect(() => {
    map.setView(state.center, state.zoom, { animate: true });
  }, [state.center, state.zoom, map]);
  return null;
}

function IsochroneFitter() {
  const { state } = useAppState();
  const map = useMap();
  const prev = useRef<string | null>(null);
  const iso = state.analysisResult?.isochrones;
  const sig = useMemo(() => JSON.stringify(iso?.features?.map((f) => f.properties?.value)) || '', [iso]);
  useEffect(() => {
    if (!iso?.features?.length) return;
    if (sig === prev.current) return;
    prev.current = sig;
    try {
      const layer = L.geoJSON(iso as any);
      const b = layer.getBounds();
      if (b.isValid()) map.fitBounds(b, { padding: [40, 40], maxZoom: 15 });
    } catch (e) {
      console.error('Fit isochrone bounds failed:', e);
    }
  }, [iso, sig, map]);
  return null;
}

function MapClickHandler() {
  const { dispatch } = useAppState();
  useMapEvents({
    click(e) {
      const { lat, lng } = e.latlng;
      dispatch({ type: 'SET_ANALYSIS_POINT', payload: [lat, lng] });
    },
  });
  return null;
}

function ClusteredFacilityMarkers({ facilities }: { facilities: Facility[] }) {
  const map = useMap();
  const layerRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (layerRef.current) {
      map.removeLayer(layerRef.current);
      layerRef.current = null;
    }
    const canCluster = typeof (L as any).markerClusterGroup === 'function';
    const layer: L.LayerGroup = canCluster
      ? (L as any).markerClusterGroup({
          maxClusterRadius: 50,
          spiderfyOnMaxZoom: true,
          showCoverageOnHover: false,
          zoomToBoundsOnClick: true,
          disableClusteringAtZoom: 14,
          iconCreateFunction: (c: any) => {
            const count = c.getChildCount();
            return L.divIcon({
              html: `<div style="width:36px;height:36px;display:flex;align-items:center;justify-content:center;background:hsl(210,80%,45%);color:#fff;border-radius:50%;font-size:12px;font-weight:600;box-shadow:0 2px 6px rgba(0,0,0,0.2);border:2px solid #fff;">${count}</div>`,
              className: '',
              iconSize: [36, 36],
              iconAnchor: [18, 18],
            });
          },
        })
      : L.layerGroup();

    facilities.forEach((f) => {
      const marker = L.marker([f.lat, f.lon], { icon: createFacilityIcon(f) });
      marker.bindPopup(buildFacilityPopupHtml(f));
      layer.addLayer(marker);
    });

    map.addLayer(layer);
    layerRef.current = layer;
    return () => {
      if (layerRef.current) {
        map.removeLayer(layerRef.current);
        layerRef.current = null;
      }
    };
  }, [facilities, map]);

  return null;
}

function AnalysisPointMarker() {
  const { state } = useAppState();
  if (!state.analysisPoint) return null;
  return (
    <Marker position={state.analysisPoint} icon={selectedLocationIcon}>
      <Popup>
        <div className="text-sm font-semibold text-red-600">Selected origin</div>
      </Popup>
    </Marker>
  );
}

function SortedIsochrones({ data }: { data: any }) {
  const prepared = useMemo(() => {
    const valid = (data?.features || []).filter(
      (f: any) => f?.geometry && f?.properties?.value != null,
    );
    const desc = [...valid].sort(
      (a: any, b: any) => Number(b.properties?.value ?? 0) - Number(a.properties?.value ?? 0),
    );
    const asc: number[] = Array.from(new Set(valid.map((f: any) => Number(f.properties?.value)))).sort(
      (a: unknown, b: unknown) => Number(a) - Number(b),
    ) as number[];
    return { desc, asc };
  }, [data]);

  if (!prepared.desc.length) return null;
  return (
    <>
      {prepared.desc.map((feature: any, i: number) => {
        const value = Number(feature?.properties?.value);
        const idx = Math.max(0, Math.min(prepared.asc.indexOf(value), ISOCHRONE_COLORS.length - 1));
        return (
          <GeoJSON
            key={`iso-${value}-${i}`}
            data={feature}
            style={{
              fillColor: ISOCHRONE_COLORS[idx],
              color: ISOCHRONE_BORDERS[idx],
              weight: 1.5,
              fillOpacity: 0.45,
            }}
          />
        );
      })}
    </>
  );
}

function BasemapSwitcher({ basemap }: { basemap: keyof typeof BASEMAPS }) {
  const map = useMap();
  const layerRef = useRef<L.TileLayer | null>(null);
  useEffect(() => {
    if (layerRef.current) {
      map.removeLayer(layerRef.current);
      layerRef.current = null;
    }
    const bm = BASEMAPS[basemap];
    const layer = L.tileLayer(bm.url, { attribution: bm.attribution });
    layer.addTo(map);
    layerRef.current = layer;
    return () => {
      if (layerRef.current) {
        map.removeLayer(layerRef.current);
        layerRef.current = null;
      }
    };
  }, [basemap, map]);
  return null;
}

function FloatingMapControl({
  basemap,
  setBasemap,
}: {
  basemap: keyof typeof BASEMAPS;
  setBasemap: React.Dispatch<React.SetStateAction<keyof typeof BASEMAPS>>;
}) {
  const { state, dispatch } = useAppState();
  const [open, setOpen] = useState(false);
  return (
    <div className="absolute top-3 right-3 z-[1000]">
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        aria-label="Map layers"
        className="w-9 h-9 bg-card border border-border rounded-lg shadow-md flex items-center justify-center hover:bg-secondary transition-colors"
      >
        <Layers className="w-4 h-4 text-foreground" />
      </button>
      {open && (
        <div className="absolute top-11 right-0 bg-card border border-border rounded-lg shadow-lg p-3 min-w-[190px] space-y-3">
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Layers</div>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={state.showFacilities}
              onChange={() => dispatch({ type: 'TOGGLE_LAYER', payload: 'showFacilities' })}
            />
            Facilities
          </label>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={state.showIsochrones}
              onChange={() => dispatch({ type: 'TOGGLE_LAYER', payload: 'showIsochrones' })}
            />
            Travel areas
          </label>
          <div className="border-t border-border pt-2 mt-2">
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Basemap</div>
            <div className="flex flex-wrap gap-1">
              {(Object.keys(BASEMAPS) as (keyof typeof BASEMAPS)[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setBasemap(k)}
                  className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                    basemap === k ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {BASEMAPS[k].label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function HealthMap() {
  const { state } = useAppState();
  const [basemap, setBasemap] = useState<keyof typeof BASEMAPS>('positron');

  const visibleFacilities = state.facilities;

  return (
    <div className="relative w-full h-full">
      <MapContainer center={state.center} zoom={state.zoom} className="w-full h-full" zoomControl>
        <BasemapSwitcher basemap={basemap} />
        <MapUpdater />
        <MapClickHandler />
        <IsochroneFitter />
        {state.showIsochrones && state.analysisResult?.isochrones && (
          <SortedIsochrones data={state.analysisResult.isochrones} />
        )}
        {state.showFacilities && visibleFacilities.length > 0 && (
          <ClusteredFacilityMarkers facilities={visibleFacilities} />
        )}
        <AnalysisPointMarker />
      </MapContainer>

      <FloatingMapControl basemap={basemap} setBasemap={setBasemap} />
      <MapLegend />

      {state.isAnalyzing && (
        <div className="absolute inset-0 bg-background/40 backdrop-blur-sm flex items-center justify-center z-[1000]">
          <div className="glass-panel p-6 flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            <span className="text-sm font-medium text-foreground">Analyzing accessibility…</span>
            <span className="text-xs text-muted-foreground">Finding nearby healthcare facilities</span>
          </div>
        </div>
      )}
    </div>
  );
}