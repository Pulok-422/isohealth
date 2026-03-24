import { useEffect, useRef, useMemo, useState } from 'react';
import { MapContainer, TileLayer, useMap, useMapEvents, CircleMarker, GeoJSON, Popup, Marker } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import 'leaflet.markercluster';
import { useAppState } from '@/context/AppContext';
import { Layers, MapPin, Eye, EyeOff, RotateCcw } from 'lucide-react';
import type { Facility, PopulationPoint } from '@/types/health';

// Facility icon — emoji at high zoom, simple dot at low zoom
function createFacilityIcon(type: string, isSimulated: boolean = false) {
  const icons: Record<string, string> = {
    hospital: '🏥', clinic: '🏨', pharmacy: '💊', doctors: '👨‍⚕️', healthcare: '⚕️',
  };
  const emoji = icons[type] || '⚕️';
  const border = isSimulated ? 'border: 2px dashed hsl(38, 90%, 55%);' : 'border: 1px solid hsl(220, 13%, 85%);';
  return L.divIcon({
    html: `<div style="font-size:18px;width:32px;height:32px;display:flex;align-items:center;justify-content:center;background:white;border-radius:50%;${border}box-shadow:0 2px 6px rgba(0,0,0,0.15);">${emoji}</div>`,
    className: '',
    iconSize: [32, 32],
    iconAnchor: [16, 16],
  });
}

// Selected location pin icon
const selectedLocationIcon = L.divIcon({
  html: `<div style="width:20px;height:20px;background:hsl(210,80%,45%);border:3px solid white;border-radius:50%;box-shadow:0 2px 8px rgba(0,0,0,0.3);"></div>`,
  className: '',
  iconSize: [20, 20],
  iconAnchor: [10, 10],
});

const BASEMAPS = {
  positron: { url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', label: 'Light', attribution: '&copy; CARTO' },
  osm: { url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', label: 'OSM', attribution: '&copy; OpenStreetMap' },
  satellite: { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', label: 'Satellite', attribution: '&copy; Esri' },
};

function MapUpdater() {
  const { state } = useAppState();
  const map = useMap();
  useEffect(() => { map.setView(state.center, state.zoom, { animate: true }); }, [state.center, state.zoom, map]);
  return null;
}

// Fit map to isochrone bounds after analysis
function IsochroneFitter() {
  const { state } = useAppState();
  const map = useMap();
  const prevIso = useRef<string | null>(null);

  useEffect(() => {
    if (!state.analysisResult?.isochrones) return;
    const key = JSON.stringify(state.analysisResult.isochrones).slice(0, 100);
    if (key === prevIso.current) return;
    prevIso.current = key;
    try {
      const geoLayer = L.geoJSON(state.analysisResult.isochrones);
      const bounds = geoLayer.getBounds();
      if (bounds.isValid()) {
        map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
      }
    } catch {}
  }, [state.analysisResult?.isochrones, map]);

  return null;
}

function MapClickHandler() {
  const { state, dispatch } = useAppState();
  useMapEvents({
    click(e) {
      const { lat, lng } = e.latlng;
      if (state.simulationMode) {
        const newFacility: Facility = {
          id: Date.now(),
          name: `Simulated Clinic #${state.simulatedFacilities.length + 1}`,
          type: 'clinic',
          lat,
          lon: lng,
          tags: {},
          isSimulated: true,
        };
        dispatch({ type: 'ADD_SIMULATED_FACILITY', payload: newFacility });
      } else {
        dispatch({ type: 'SET_ANALYSIS_POINT', payload: [lat, lng] });
      }
    },
  });
  return null;
}

function ClusteredFacilityMarkers({ facilities }: { facilities: Facility[] }) {
  const map = useMap();
  const clusterRef = useRef<L.MarkerClusterGroup | null>(null);

  useEffect(() => {
    if (clusterRef.current) map.removeLayer(clusterRef.current);
    const cluster = (L as any).markerClusterGroup({
      maxClusterRadius: 50,
      spiderfyOnMaxZoom: true,
      showCoverageOnHover: false,
      zoomToBoundsOnClick: true,
      disableClusteringAtZoom: 14,
      iconCreateFunction: (c: any) => {
        const count = c.getChildCount();
        return L.divIcon({
          html: `<div style="width:36px;height:36px;display:flex;align-items:center;justify-content:center;background:hsl(210,80%,45%);color:white;border-radius:50%;font-size:12px;font-weight:600;box-shadow:0 2px 6px rgba(0,0,0,0.2);border:2px solid white;">${count}</div>`,
          className: '',
          iconSize: [36, 36],
          iconAnchor: [18, 18],
        });
      },
    });

    facilities.forEach((f) => {
      const marker = L.marker([f.lat, f.lon], { icon: createFacilityIcon(f.type, f.isSimulated) });
      marker.bindPopup(
        `<div style="font-size:13px"><strong>${f.name}</strong><br/><span style="text-transform:capitalize">${f.type}${f.isSimulated ? ' (Simulated)' : ''}</span><br/><code>${f.lat.toFixed(4)}, ${f.lon.toFixed(4)}</code></div>`
      );
      cluster.addLayer(marker);
    });

    map.addLayer(cluster);
    clusterRef.current = cluster;
    return () => { if (clusterRef.current) map.removeLayer(clusterRef.current); };
  }, [facilities, map]);

  return null;
}

function OptimizationMarkers() {
  const { state } = useAppState();
  return (
    <>
      {state.optimizationResults.map((opt, i) => (
        <CircleMarker
          key={`opt-${i}`}
          center={[opt.lat, opt.lon]}
          radius={12}
          pathOptions={{ color: 'hsl(270, 60%, 55%)', fillColor: 'hsl(270, 60%, 55%)', fillOpacity: 0.2, weight: 2, dashArray: '4,6' }}
        >
          <Popup>
            <div className="text-sm space-y-1">
              <div className="font-semibold">📍 Suggested Location #{i + 1}</div>
              <div className="text-xs">Score: {opt.score}/100</div>
              <div className="text-xs">{opt.reason}</div>
            </div>
          </Popup>
        </CircleMarker>
      ))}
    </>
  );
}

function AnalysisPointMarker() {
  const { state } = useAppState();
  if (!state.analysisPoint) return null;
  return (
    <Marker position={state.analysisPoint} icon={selectedLocationIcon}>
      <Popup>
        <div className="text-sm">
          <div className="font-semibold">📍 Selected Location</div>
          <div className="text-xs font-mono text-muted-foreground">
            {state.analysisPoint[0].toFixed(4)}, {state.analysisPoint[1].toFixed(4)}
          </div>
        </div>
      </Popup>
    </Marker>
  );
}

const isochroneColors = ['rgba(250, 204, 21, 0.18)', 'rgba(249, 115, 22, 0.18)', 'rgba(239, 68, 68, 0.18)'];
const isochroneBorders = ['#facc15', '#f97316', '#ef4444'];

function BasemapSwitcher({ basemap, setBasemap }: { basemap: keyof typeof BASEMAPS; setBasemap: (b: keyof typeof BASEMAPS) => void }) {
  const map = useMap();
  const layerRef = useRef<L.TileLayer | null>(null);

  useEffect(() => {
    if (layerRef.current) map.removeLayer(layerRef.current);
    const bm = BASEMAPS[basemap];
    const layer = L.tileLayer(bm.url, { attribution: bm.attribution });
    layer.addTo(map);
    layerRef.current = layer;
    return () => { if (layerRef.current) map.removeLayer(layerRef.current); };
  }, [basemap, map]);

  return null;
}

// Floating map control panel
function FloatingMapControl() {
  const { state, dispatch } = useAppState();
  const [open, setOpen] = useState(false);
  const [basemap, setBasemap] = useState<keyof typeof BASEMAPS>('positron');

  return (
    <>
      <BasemapSwitcher basemap={basemap} setBasemap={setBasemap} />
      <div className="absolute top-3 right-3 z-[1000]">
        <button
          onClick={() => setOpen(!open)}
          className="w-9 h-9 bg-card border border-border rounded-lg shadow-md flex items-center justify-center hover:bg-secondary transition-colors"
        >
          <Layers className="w-4 h-4 text-foreground" />
        </button>

        {open && (
          <div className="mt-2 bg-card border border-border rounded-lg shadow-lg p-3 min-w-[180px] space-y-3">
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Layers</div>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={state.showFacilities}
                onChange={() => dispatch({ type: 'TOGGLE_LAYER', payload: 'showFacilities' })}
                className="rounded border-border"
              />
              Facilities
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={state.showIsochrones}
                onChange={() => dispatch({ type: 'TOGGLE_LAYER', payload: 'showIsochrones' })}
                className="rounded border-border"
              />
              Isochrones
            </label>

            <div className="border-t border-border pt-2 mt-2">
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Basemap</div>
              <div className="flex gap-1">
                {(Object.keys(BASEMAPS) as (keyof typeof BASEMAPS)[]).map((key) => (
                  <button
                    key={key}
                    onClick={() => setBasemap(key)}
                    className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                      basemap === key ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {BASEMAPS[key].label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

export function HealthMap() {
  const { state, dispatch } = useAppState();
  const mapRef = useRef<L.Map | null>(null);

  const allFacilities = useMemo(
    () => [...state.facilities, ...state.simulatedFacilities],
    [state.facilities, state.simulatedFacilities]
  );

  return (
    <div className="relative w-full h-full">
      <MapContainer
        center={state.center}
        zoom={state.zoom}
        className="w-full h-full"
        ref={mapRef}
        zoomControl={true}
      >
        <TileLayer
          attribution='&copy; <a href="https://carto.com/">CARTO</a>'
          url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
        />
        <MapUpdater />
        <MapClickHandler />
        <IsochroneFitter />

        {/* Isochrones — rendered below facilities */}
        {state.showIsochrones && state.analysisResult?.isochrones && (
          <GeoJSON
            key={JSON.stringify(state.analysisResult.isochrones).slice(0, 100)}
            data={state.analysisResult.isochrones}
            style={(feature) => {
              const idx = feature?.properties?.group_index || 0;
              return {
                fillColor: isochroneColors[idx] || isochroneColors[0],
                color: isochroneBorders[idx] || isochroneBorders[0],
                weight: 2,
                fillOpacity: 0.18,
              };
            }}
          />
        )}

        {/* Facilities with clustering */}
        {state.showFacilities && allFacilities.length > 0 && (
          <ClusteredFacilityMarkers facilities={allFacilities} />
        )}

        <OptimizationMarkers />
        <AnalysisPointMarker />

        {/* Route */}
        {state.routeGeoJson && (
          <GeoJSON
            key={`route-${Date.now()}`}
            data={state.routeGeoJson}
            style={{ color: 'hsl(210, 80%, 45%)', weight: 4, opacity: 0.8 }}
          />
        )}
      </MapContainer>

      {/* Floating map controls */}
      <FloatingMapControl />

      {/* Reset button — only when there's an analysis */}
      {(state.analysisResult || state.analysisPoint) && (
        <div className="absolute top-3 right-14 z-[1000]">
          <button
            onClick={() => dispatch({ type: 'RESET_ANALYSIS' })}
            className="w-9 h-9 bg-card border border-border rounded-lg shadow-md flex items-center justify-center hover:bg-destructive/10 hover:border-destructive/30 transition-colors"
            title="Reset Analysis"
          >
            <RotateCcw className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>
      )}

      {/* Loading overlay */}
      {state.isAnalyzing && (
        <div className="absolute inset-0 bg-background/40 backdrop-blur-sm flex items-center justify-center z-[1000]">
          <div className="glass-panel p-6 flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            <span className="text-sm text-muted-foreground">Running accessibility analysis...</span>
          </div>
        </div>
      )}

      {/* Simulation mode indicator */}
      {state.simulationMode && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[1000]">
          <div className="glass-panel px-4 py-2 border-accent/30 bg-accent/5">
            <span className="text-xs font-medium text-accent-foreground">
              🎯 Click map to place a simulated facility
            </span>
          </div>
        </div>
      )}

      {/* Onboarding helper */}
      {!state.analysisResult && !state.isAnalyzing && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-[1000]">
          <div className="glass-panel px-5 py-3 shadow-md">
            <div className="text-xs text-muted-foreground space-y-1">
              <p className="font-medium text-foreground text-sm">Get Started</p>
              <p>1. Select a location (search, click map, or use My Location)</p>
              <p>2. Choose a travel mode (Walk, Drive, Cycle)</p>
              <p>3. Click <span className="text-primary font-medium">Analyze</span> to see results</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
