import { useEffect, useRef, useMemo } from 'react';
import { MapContainer, TileLayer, useMap, useMapEvents, CircleMarker, GeoJSON, Popup } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useAppState } from '@/context/AppContext';
import { useAnalysis } from '@/hooks/useAnalysis';
import type { Facility, PopulationPoint } from '@/types/health';

const facilityColors: Record<string, string> = {
  hospital: '#ef4444',
  clinic: '#22d3ee',
  pharmacy: '#a855f7',
  doctors: '#22c55e',
  healthcare: '#f59e0b',
};

const facilityIcons: Record<string, string> = {
  hospital: '🏥',
  clinic: '🏨',
  pharmacy: '💊',
  doctors: '👨‍⚕️',
  healthcare: '⚕️',
};

function MapUpdater() {
  const { state } = useAppState();
  const map = useMap();
  
  useEffect(() => {
    map.setView(state.center, state.zoom, { animate: true });
  }, [state.center, state.zoom, map]);

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
        <CircleMarker
          key={`${f.id}-${f.isSimulated ? 's' : 'r'}`}
          center={[f.lat, f.lon]}
          radius={f.type === 'hospital' ? 8 : 5}
          pathOptions={{
            color: f.isSimulated ? '#f59e0b' : facilityColors[f.type] || '#22d3ee',
            fillColor: f.isSimulated ? '#f59e0b' : facilityColors[f.type] || '#22d3ee',
            fillOpacity: f.isSimulated ? 0.8 : 0.6,
            weight: f.isSimulated ? 3 : 2,
            dashArray: f.isSimulated ? '5,5' : undefined,
          }}
        >
          <Popup>
            <div className="text-sm space-y-1">
              <div className="font-semibold">{facilityIcons[f.type]} {f.name}</div>
              <div className="text-xs opacity-70 capitalize">{f.type}{f.isSimulated ? ' (Simulated)' : ''}</div>
              <div className="text-xs font-mono opacity-50">{f.lat.toFixed(4)}, {f.lon.toFixed(4)}</div>
            </div>
          </Popup>
        </CircleMarker>
      ))}
    </>
  );
}

function PopulationHeatmap({ points }: { points: PopulationPoint[] }) {
  const maxPop = useMemo(() => Math.max(...points.map(p => p.population), 1), [points]);
  
  return (
    <>
      {points.map((p, i) => {
        const intensity = p.population / maxPop;
        const color = intensity > 0.7 ? '#ef4444' : intensity > 0.4 ? '#f59e0b' : '#22c55e';
        return (
          <CircleMarker
            key={`pop-${i}`}
            center={[p.lat, p.lon]}
            radius={3 + intensity * 6}
            pathOptions={{
              color: 'transparent',
              fillColor: color,
              fillOpacity: 0.15 + intensity * 0.35,
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
          radius={10}
          pathOptions={{
            color: '#a855f7',
            fillColor: '#a855f7',
            fillOpacity: 0.3,
            weight: 2,
            dashArray: '3,6',
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
      pathOptions={{
        color: '#22d3ee',
        fillColor: '#22d3ee',
        fillOpacity: 0.3,
        weight: 3,
      }}
    >
      <Popup>
        <div className="text-sm">
          <div className="font-semibold">📍 Analysis Point</div>
          <div className="text-xs font-mono opacity-50">
            {state.analysisPoint[0].toFixed(4)}, {state.analysisPoint[1].toFixed(4)}
          </div>
        </div>
      </Popup>
    </CircleMarker>
  );
}

const isochroneColors = ['#22d3ee33', '#22d3ee22', '#22d3ee11'];
const isochroneBorders = ['#22d3ee88', '#22d3ee55', '#22d3ee33'];

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
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        />
        <MapUpdater />
        <MapClickHandler />

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
                weight: 1,
                fillOpacity: 0.3,
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

        {/* Optimization suggestions */}
        <OptimizationMarkers />

        {/* Analysis point */}
        <AnalysisPointMarker />

        {/* Route */}
        {state.routeGeoJson && (
          <GeoJSON
            key={`route-${Date.now()}`}
            data={state.routeGeoJson}
            style={{ color: '#22d3ee', weight: 4, opacity: 0.8 }}
          />
        )}
      </MapContainer>

      {/* Map status overlay */}
      {state.isAnalyzing && (
        <div className="absolute inset-0 bg-background/30 backdrop-blur-sm flex items-center justify-center z-[1000]">
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
            <span className="text-xs font-medium text-accent">
              🎯 Click map to place a simulated facility
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
