# Routing engine

isoHealth uses a small `RoutingProvider` abstraction so the underlying
isochrone and matrix engine can be swapped without rewriting the app.
See `src/services/routing/types.ts`.

## Active provider

`OpenRouteServiceProvider` (`src/services/routing/openRouteServiceProvider.ts`)

- Isochrones: `POST /api/generate-isochrones` -> ORS `/v2/isochrones/{profile}`
- Matrix: `POST /api/compute-matrix` -> ORS `/v2/matrix/{profile}`
- Server-side only; the ORS API key is never shipped to the browser.

## Future provider (not implemented)

A future local provider may run alongside ORS. Sketch:

- FastAPI backend service on a small VM
- OSMnx to download and cache regional road graphs
- NetworkX for graph handling
- Dijkstra with non-negative travel-time weights (per-mode speed profiles)
- Cached, versioned graphs per region to keep memory bounded

To activate it, implement `RoutingProvider` with `id: 'local-dijkstra'` (widen
the union in `types.ts`) and register it in `src/services/routing/index.ts`
via `setRoutingProvider(...)`. Until such a provider exists and is validated,
no "Local Dijkstra" option is shown in the interface.

## Contract

```
generateIsochrones({ origin, profile, rangeType, ranges })
  -> GeoJSON.FeatureCollection of Polygon | MultiPolygon features
     with `properties.value` set to the numeric range (seconds or metres).

computeMatrix({ origins, destinations, profile })
  -> { durations: (number|null)[][], distances: (number|null)[][] }
     Values are non-negative or null when no route exists.
```