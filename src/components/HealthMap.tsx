import { useEffect, useRef, useMemo, useState } from 'react';
import {
  MapContainer,
  TileLayer,
  useMap,
  useMapEvents,
  CircleMarker,
  GeoJSON,
  Popup,
  Marker,
} from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import 'leaflet.markercluster';
import { useAppState } from '@/context/AppContext';
import { Layers, RotateCcw } from 'lucide-react';
import { MapLegend } from '@/components/MapLegend';
import type { Facility } from '@/types/health';

const ISOCHRONE_COLORS = [
  'rgba(255, 245, 157, 0.60)',
  'rgba(255, 224, 130, 0.60)',
  'rgba(255, 183, 77, 0.60)',
  'rgba(255, 138, 101, 0.60)',
  'rgba(239, 83, 80, 0.60)',
  'rgba(173, 20, 87, 0.60)',
];

const ISOCHRONE_BORDERS = [
  '#fff59d',
  '#ffe082',
  '#ffb74d',
  '#ff8a65',
  '#ef5350',
  '#ad1457',
];

function createFacilityIcon(type: string, isSimulated: boolean = false) {
  const icons: Record<string, string> = {
    hospital: '🏥',
    clinic: '🏨',
    pharmacy: '💊',
    doctors: '👨‍⚕️',
    healthcare: '⚕️',
  };

  const emoji = icons[type] || '⚕️';
  const border = isSimulated
    ? 'border: 2px dashed hsl(38, 90%, 55%);'
    : 'border: 1px solid hsl(220, 13%, 85%);';

  return L.divIcon({
    html: `<div style="font-size:18px;width:32px;height:32px;display:flex;align-items:center;justify-content:center;background:white;border-radius:50%;${border}box-shadow:0 2px 6px rgba(0,0,0,0.15);">${emoji}</div>`,
    className: '',
    iconSize: [32, 32],
    iconAnchor: [16, 16],
  });
}

const selectedLocationIcon = L.divIcon({
  html: `
    <div style="position: relative; width: 28px; height: 28px; display:flex; align-items:center; justify-content:center;">
      <style>
        @keyframes user-location-pulse {
          0% {
            transform: scale(0.9);
            opacity: 0.85;
          }
          70% {
            transform: scale(2.3);
            opacity: 0;
          }
          100% {
            transform: scale(2.3);
            opacity: 0;
          }
        }
      </style>
      <div
        style="
          position:absolute;
          width:18px;
          height:18px;
          border-radius:9999px;
          background:rgba(220, 38, 38, 0.35);
          animation:user-location-pulse 1.6s ease-out infinite;
        "
      ></div>
      <div
        style="
          position:absolute;
          width:14px;
          height:14px;
          background:#dc2626;
          border:3px solid #ffffff;
          border-radius:9999px;
          box-shadow:0 0 0 2px rgba(220,38,38,0.25), 0 3px 10px rgba(0,0,0,0.35);
        "
      ></div>
    </div>
  `,
  className: '',
  iconSize: [28, 28],
  iconAnchor: [14, 14],
  popupAnchor: [0, -12],
});

const BASEMAPS = {
  positron: {
    url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    label: 'Light',
    attribution: '&copy; CARTO',
  },
  osm: {
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    label: 'OSM',
    attribution: '&copy; OpenStreetMap',
  },
  satellite: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    label: 'Satellite',
    attribution: '&copy; Esri',
  },
};

function buildIsochroneSignature(data: any, transportProfile?: string, analysisType?: string) {
  if (!data?.features?.length) {
    return `${transportProfile || 'na'}|${analysisType || 'na'}|empty`;
  }

  const parts = data.features.map((f: any) => {
    const value = f?.properties?.value ?? 'na';
    const type = f?.geometry?.type ?? 'na';
    const coordsLen = JSON.stringify(f?.geometry?.coordinates ?? []).length;
    return `${value}-${type}-${coordsLen}`;
  });

  return `${transportProfile || 'na'}|${analysisType || 'na'}|${parts.join('|')}`;
}

function pointInRing(point: [number, number], ring: number[][]) {
  const [x, y] = point;
  let inside = false;

  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];

    const intersect =
      yi > y !== yj > y &&
      x < ((xj - xi) * (y - yi)) / ((yj - yi) || Number.EPSILON) + xi;

    if (intersect) inside = !inside;
  }

  return inside;
}

function pointInPolygonCoords(point: [number, number], polygonCoords: number[][][]) {
  if (!polygonCoords?.length) return false;

  const outerRing = polygonCoords[0];
  if (!pointInRing(point, outerRing)) return false;

  for (let i = 1; i < polygonCoords.length; i++) {
    if (pointInRing(point, polygonCoords[i])) return false;
  }

  return true;
}

function pointInGeometry(point: [number, number], geometry: any) {
  if (!geometry) return false;

  if (geometry.type === 'Polygon') {
    return pointInPolygonCoords(point, geometry.coordinates);
  }

  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates.some((polygonCoords: number[][][]) =>
      pointInPolygonCoords(point, polygonCoords)
    );
  }

  return false;
}

function getOutermostIsochroneGeometry(isochrones: any) {
  const features = isochrones?.features;
  if (!features?.length) return null;

  const validFeatures = features.filter(
    (f: any) => f?.geometry && f?.properties?.value != null
  );

  if (!validFeatures.length) return null;

  const outermost = validFeatures.reduce((maxFeature: any, current: any) => {
    const maxValue = Number(maxFeature?.properties?.value ?? -Infinity);
    const currentValue = Number(current?.properties?.value ?? -Infinity);
    return currentValue > maxValue ? current : maxFeature;
  });

  return outermost?.geometry ?? null;
}

function prettifyLabel(key: string) {
  return key
    .replace(/_/g, ' ')
    .replace(/:/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function prettifyValue(value: unknown) {
  if (value == null || value === '') return 'Not available';
  return String(value)
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildAddress(tags: Record<string, any>) {
  const parts = [
    tags['addr:housenumber'],
    tags['addr:street'],
    tags['addr:suburb'],
    tags['addr:city'],
    tags['addr:district'],
  ].filter(Boolean);

  return parts.length ? parts.join(', ') : null;
}

function buildFacilityPopupHtml(facility: Facility) {
  const tags = (facility.tags ?? {}) as Record<string, any>;

  const detailCandidates = [
    { label: 'Operator', value: tags.operator || tags.brand || tags.network },
    {
      label: 'Service',
      value: tags.healthcare || tags.amenity || tags['healthcare:speciality'] || facility.type,
    },
    { label: 'Specialty', value: tags['healthcare:speciality'] || tags.speciality },
    { label: 'Emergency', value: tags.emergency },
    { label: 'Opening Hours', value: tags.opening_hours },
    { label: 'Phone', value: tags.phone || tags['contact:phone'] },
    { label: 'Website', value: tags.website || tags['contact:website'] },
    { label: 'Wheelchair Access', value: tags.wheelchair },
    { label: 'Address', value: buildAddress(tags) || tags.address || tags['addr:full'] },
  ].filter((item) => item.value != null && item.value !== '');

  const shownDetails = detailCandidates.slice(0, 5);

  const extraTagEntries = Object.entries(tags)
    .filter(([key, value]) => {
      if (value == null || value === '') return false;

      const excludedKeys = new Set([
        'operator',
        'brand',
        'network',
        'healthcare',
        'amenity',
        'healthcare:speciality',
        'speciality',
        'emergency',
        'opening_hours',
        'phone',
        'contact:phone',
        'website',
        'contact:website',
        'wheelchair',
        'address',
        'addr:full',
        'addr:housenumber',
        'addr:street',
        'addr:suburb',
        'addr:city',
        'addr:district',
        'name',
      ]);

      return !excludedKeys.has(key);
    })
    .slice(0, 2);

  const detailHtml = shownDetails.length
    ? shownDetails
        .map(
          (item) => `
            <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;">
              <span style="color:#64748b;font-size:12px;white-space:nowrap;">${escapeHtml(
                item.label
              )}</span>
              <span style="color:#0f172a;font-size:12px;font-weight:500;text-align:right;">${escapeHtml(
                prettifyValue(item.value)
              )}</span>
            </div>
          `
        )
        .join('')
    : `
      <div style="color:#64748b;font-size:12px;">
        Basic facility information is available.
      </div>
    `;

  const extraHtml = extraTagEntries.length
    ? `
      <div style="margin-top:8px;padding-top:8px;border-top:1px solid #e2e8f0;">
        ${extraTagEntries
          .map(
            ([key, value]) => `
              <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;">
                <span style="color:#64748b;font-size:12px;white-space:nowrap;">${escapeHtml(
                  prettifyLabel(key)
                )}</span>
                <span style="color:#0f172a;font-size:12px;font-weight:500;text-align:right;">${escapeHtml(
                  prettifyValue(value)
                )}</span>
              </div>
            `
          )
          .join('')}
      </div>
    `
    : '';

  return `
    <div style="min-width:220px;max-width:260px;font-size:13px;line-height:1.45;">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:8px;">
        <div>
          <div style="font-weight:700;font-size:14px;color:#0f172a;">${escapeHtml(
            facility.name || 'Unnamed Facility'
          )}</div>
          <div style="margin-top:4px;">
            <span style="display:inline-flex;align-items:center;padding:2px 8px;border-radius:9999px;background:${
              facility.isSimulated ? 'rgba(245, 158, 11, 0.12)' : 'rgba(37, 99, 235, 0.10)'
            };color:${facility.isSimulated ? '#b45309' : '#1d4ed8'};font-size:11px;font-weight:600;text-transform:capitalize;">
              ${escapeHtml(facility.type)}${facility.isSimulated ? ' • Simulated' : ''}
            </span>
          </div>
        </div>
      </div>

      <div style="display:flex;flex-direction:column;gap:6px;">
        ${detailHtml}
      </div>

      ${extraHtml}
    </div>
  `;
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
  const prevSignature = useRef<string | null>(null);

  const signature = useMemo(() => {
    return buildIsochroneSignature(
      state.analysisResult?.isochrones,
      state.transportProfile,
      state.analysisType
    );
  }, [
    state.analysisResult?.isochrones,
    state.transportProfile,
    state.analysisType,
  ]);

  useEffect(() => {
    if (!state.analysisResult?.isochrones?.features?.length) return;
    if (signature === prevSignature.current) return;

    prevSignature.current = signature;

    try {
      const geoLayer = L.geoJSON(state.analysisResult.isochrones as any);
      const bounds = geoLayer.getBounds();

      if (bounds.isValid()) {
        map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
      }
    } catch (error) {
      console.error('Failed to fit isochrone bounds:', error);
    }
  }, [signature, state.analysisResult?.isochrones, map]);

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
    if (clusterRef.current) {
      map.removeLayer(clusterRef.current);
      clusterRef.current = null;
    }

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
      const marker = L.marker([f.lat, f.lon], {
        icon: createFacilityIcon(f.type, f.isSimulated),
      });

      marker.bindPopup(buildFacilityPopupHtml(f));

      cluster.addLayer(marker);
    });

    map.addLayer(cluster);
    clusterRef.current = cluster;

    return () => {
      if (clusterRef.current) {
        map.removeLayer(clusterRef.current);
        clusterRef.current = null;
      }
    };
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
    <Marker position={state.analysisPoint} icon={selectedLocationIcon}>
      <Popup>
        <div className="text-sm">
          <div className="font-semibold text-red-600">📍 You are here!</div>
          <div className="text-xs text-muted-foreground">
            This is your selected location.
          </div>
        </div>
      </Popup>
    </Marker>
  );
}

function SortedIsochrones({
  data,
  renderSignature,
}: {
  data: any;
  renderSignature: string;
}) {
  const prepared = useMemo(() => {
    if (!data?.features?.length) {
      return {
        features: [] as any[],
        ascValues: [] as number[],
      };
    }

    const validFeatures = data.features.filter(
      (f: any) => f?.geometry && f?.properties?.value != null
    );

    const featuresDesc = [...validFeatures].sort(
      (a: any, b: any) => Number(b.properties?.value ?? 0) - Number(a.properties?.value ?? 0)
    );

    const valuesSet = new Set<number>(validFeatures.map((f: any) => Number(f.properties?.value)));
    const ascValues: number[] = Array.from(valuesSet).sort((a: number, b: number) => a - b);

    return { features: featuresDesc, ascValues };
  }, [data]);

  if (!prepared.features.length) return null;

  return (
    <>
      {prepared.features.map((feature: any, index: number) => {
        const value = Number(feature?.properties?.value);
        const colorIndex = prepared.ascValues.indexOf(value);
        const safeColorIndex =
          colorIndex >= 0 ? Math.min(colorIndex, ISOCHRONE_COLORS.length - 1) : 0;

        const geometryLen = JSON.stringify(feature?.geometry?.coordinates ?? []).length;

        return (
          <GeoJSON
            key={`iso-${renderSignature}-${value}-${index}-${geometryLen}`}
            data={feature}
            style={{
              fillColor: ISOCHRONE_COLORS[safeColorIndex],
              color: ISOCHRONE_BORDERS[safeColorIndex],
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

let _setBasemapFn: ((b: keyof typeof BASEMAPS) => void) | null = null;
let _currentBasemap: keyof typeof BASEMAPS = 'positron';

function BasemapSyncInMap() {
  const [basemap, setBasemap] = useState<keyof typeof BASEMAPS>('positron');

  _setBasemapFn = (b) => {
    setBasemap(b);
    _currentBasemap = b;
  };

  return <BasemapSwitcher basemap={basemap} />;
}

function FloatingMapControl() {
  const { state, dispatch } = useAppState();
  const [open, setOpen] = useState(false);
  const [, forceRender] = useState(0);

  return (
    <div className="absolute top-3 right-3 z-[1000]">
      <button
        onClick={() => setOpen(!open)}
        className="w-9 h-9 bg-card border border-border rounded-lg shadow-md flex items-center justify-center hover:bg-secondary transition-colors"
      >
        <Layers className="w-4 h-4 text-foreground" />
      </button>

      {open && (
        <div className="mt-2 bg-card border border-border rounded-lg shadow-lg p-3 min-w-[180px] space-y-3">
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Layers
          </div>

          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={state.showFacilities}
              onChange={() =>
                dispatch({ type: 'TOGGLE_LAYER', payload: 'showFacilities' })
              }
              className="rounded border-border"
            />
            Facilities
          </label>

          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={state.showIsochrones}
              onChange={() =>
                dispatch({ type: 'TOGGLE_LAYER', payload: 'showIsochrones' })
              }
              className="rounded border-border"
            />
            Isochrones
          </label>

          <div className="border-t border-border pt-2 mt-2">
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              Basemap
            </div>

            <div className="flex gap-1">
              {(Object.keys(BASEMAPS) as (keyof typeof BASEMAPS)[]).map((key) => (
                <button
                  key={key}
                  onClick={() => {
                    _setBasemapFn?.(key);
                    forceRender((n) => n + 1);
                  }}
                  className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                    _currentBasemap === key
                      ? 'bg-primary/10 text-primary'
                      : 'text-muted-foreground hover:text-foreground'
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
  );
}

export function HealthMap() {
  const { state, dispatch } = useAppState();
  const mapRef = useRef<L.Map | null>(null);

  const allFacilities = useMemo(
    () => [...state.facilities, ...state.simulatedFacilities],
    [state.facilities, state.simulatedFacilities]
  );

  const outerGeometry = useMemo(() => {
    return getOutermostIsochroneGeometry(state.analysisResult?.isochrones);
  }, [state.analysisResult?.isochrones]);

  const visibleFacilities = useMemo(() => {
    if (!outerGeometry) return [];

    return allFacilities.filter((facility) =>
      pointInGeometry([facility.lon, facility.lat], outerGeometry)
    );
  }, [allFacilities, outerGeometry]);

  const isochroneRenderSignature = useMemo(() => {
    return buildIsochroneSignature(
      state.analysisResult?.isochrones,
      state.transportProfile,
      state.analysisType
    );
  }, [
    state.analysisResult?.isochrones,
    state.transportProfile,
    state.analysisType,
  ]);

  const routeSignature = useMemo(() => {
    if (!state.routeGeoJson) return 'no-route';
    return JSON.stringify(state.routeGeoJson).slice(0, 200);
  }, [state.routeGeoJson]);

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

        <BasemapSyncInMap />
        <MapUpdater />
        <MapClickHandler />
        <IsochroneFitter />

        {state.showIsochrones && state.analysisResult?.isochrones && (
          <SortedIsochrones
            key={`sorted-iso-${isochroneRenderSignature}`}
            data={state.analysisResult.isochrones}
            renderSignature={isochroneRenderSignature}
          />
        )}

        {state.showFacilities && visibleFacilities.length > 0 && (
          <ClusteredFacilityMarkers facilities={visibleFacilities} />
        )}

        <OptimizationMarkers />
        <AnalysisPointMarker />

        {state.routeGeoJson && (
          <GeoJSON
            key={`route-${routeSignature}`}
            data={state.routeGeoJson}
            style={{ color: 'hsl(210, 80%, 45%)', weight: 4, opacity: 0.8 }}
          />
        )}
      </MapContainer>

      <FloatingMapControl />
      <MapLegend />

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

      {state.isAnalyzing && (
        <div className="absolute inset-0 bg-background/40 backdrop-blur-sm flex items-center justify-center z-[1000]">
          <div className="glass-panel p-6 flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            <span className="text-sm text-muted-foreground">
              Running accessibility analysis...
            </span>
          </div>
        </div>
      )}

      {state.simulationMode && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[1000]">
          <div className="glass-panel px-4 py-2 border-accent/30 bg-accent/5">
            <span className="text-xs font-medium text-accent-foreground">
              🎯 Click map to place a simulated facility
            </span>
          </div>
        </div>
      )}

      {!state.analysisResult && !state.isAnalyzing && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-[1000]">
          <div className="glass-panel px-5 py-3 shadow-md">
            <div className="text-xs text-muted-foreground space-y-1">
              <p className="font-medium text-foreground text-sm">Get Started</p>
              <p>1. Select a location (search, click map, or use My Location)</p>
              <p>2. Configure analysis settings in the right panel</p>
              <p>
                3. Click <span className="text-primary font-medium">Analyze Accessibility</span>
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
