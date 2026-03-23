import { useEffect, useRef, useMemo, useState } from 'react';
import { MapContainer, TileLayer, useMap, useMapEvents, CircleMarker, GeoJSON, Popup, Marker } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useAppState } from '@/context/AppContext';
import { useAnalysis } from '@/hooks/useAnalysis';
import type { Facility, PopulationPoint } from '@/types/health';

// Custom facility icons using divIcon
function createFacilityIcon(type: string, isSimulated: boolean = false) {
  const icons: Record<string, string> = {
    hospital: '🏥',
    clinic: '🏨',
    pharmacy: '💊',
    doctors: '👨‍⚕️',
    healthcare: '⚕️',
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

function MapClickHandler() {
  const { state, dispatch } = useAppState();
  const { runAnalysis } = useAnalysis();
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
        runAnalysis(lat, lng);
      }
    },
  });
  return null;
}

function FacilityMarkers({ facilities }: { facilities: Facility[] }) {
  return (
    <>
      {facilities.map((f) => (
        <Marker
          key={`${f.id}-${f.isSimulated ? 's' : 'r'}`}
          position={[f.lat, f.lon]}
          icon={createFacilityIcon(f.type, f.isSimulated)}
        >
          <Popup>
            <div className="text-sm space-y-1">
              <div className="font-semibold">{f.name}</div>
              <div className="text-xs text-muted-foreground capitalize">{f.type}{f.isSimulated ? ' (Simulated)' : ''}</div>
              <div className="text-xs font-mono text-muted-foreground">{f.lat.toFixed(4)}, {f.lon.toFixed(4)}</div>
            </div>
          </Popup>
        </Marker>
      ))}
    </>
  );
}

function PopulationHeatmap({ points }: { points: PopulationPoint[] }) {
  const map = useMap();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (points.length === 0) return;
    const canvas = document.createElement('canvas');
    canvasRef.current = canvas;
    const maxPop = Math.max(...points.map(p => p.population), 1);

    const overlay = L.DomUtil.create('div');
    const canvasOverlay = (L as any).DomOverlay ? null : null; // fallback to circle approach

    // Use simple CircleMarker overlay approach via the map
    // We'll use a custom pane for performance
    return () => {};
  }, [points, map]);

  // Fallback: use subtle hex grid with canvas overlay
  const maxPop = useMemo(() => Math.max(...points.map(p => p.population), 1), [points]);

  return (
    <>
      {points.map((p, i) => {
        const intensity = p.population / maxPop;
        // Use subtle filled rectangles to approximate choropleth
        return (
          <CircleMarker
            key={`pop-${i}`}
            center={[p.lat, p.lon]}
            radius={6}
            pathOptions={{
              color: 'transparent',
              fillColor: intensity > 0.7 ? '#ef4444' : intensity > 0.4 ? '#f59e0b' : '#22c55e',
              fillOpacity: 0.08 + intensity * 0.22,
              weight: 0,
            }}
          />
        );
      })}
    </>
  );
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
          pathOptions={{
            color: 'hsl(270, 60%, 55%)',
            fillColor: 'hsl(270, 60%, 55%)',
            fillOpacity: 0.2,
            weight: 2,
            dashArray: '4,6',
          }}
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
    <CircleMarker
      center={state.analysisPoint}
      radius={8}
      pathOptions={{ color: 'hsl(210, 80%, 45%)', fillColor: 'hsl(210, 80%, 45%)', fillOpacity: 0.3, weight: 3 }}
    >
      <Popup>
        <div className="text-sm">
          <div className="font-semibold">📍 Analysis Point</div>
          <div className="text-xs font-mono text-muted-foreground">
            {state.analysisPoint[0].toFixed(4)}, {state.analysisPoint[1].toFixed(4)}
          </div>
        </div>
      </Popup>
    </CircleMarker>
  );
}

// Isochrone colors: yellow → orange → red
const isochroneColors = ['#fbbf2480', '#f5970080', '#ef444480'];
const isochroneBorders = ['#fbbf24', '#f59700', '#ef4444'];

function BasemapSwitcher() {
  const [basemap, setBasemap] = useState<keyof typeof BASEMAPS>('positron');
  const map = useMap();
  const layerRef = useRef<L.TileLayer | null>(null);

  useEffect(() => {
    if (layerRef.current) {
      map.removeLayer(layerRef.current);
    }
    const bm = BASEMAPS[basemap];
    const layer = L.tileLayer(bm.url, { attribution: bm.attribution });
    layer.addTo(map);
    layerRef.current = layer;
    return () => { if (layerRef.current) map.removeLayer(layerRef.current); };
  }, [basemap, map]);

  return (
    <div className="leaflet-bottom leaflet-left" style={{ zIndex: 1000 }}>
      <div className="leaflet-control bg-card border border-border rounded-md shadow-sm p-1 flex gap-1 mb-6 ml-2">
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
  );
}

export function HealthMap() {
  const { state } = useAppState();
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
        <BasemapSwitcher />

        {/* Isochrones */}
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
                fillOpacity: 0.25,
              };
            }}
          />
        )}

        {/* Population */}
        {state.showPopulation && state.populationGrid.length > 0 && (
          <PopulationHeatmap points={state.populationGrid} />
        )}

        {/* Facilities */}
        {state.showFacilities && <FacilityMarkers facilities={allFacilities} />}

        {/* Optimization */}
        <OptimizationMarkers />

        {/* Analysis point */}
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
              <p>2. Choose a travel mode (Drive, Cycle, Walk)</p>
              <p>3. Click <span className="text-primary font-medium">Analyze</span> to see results</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
