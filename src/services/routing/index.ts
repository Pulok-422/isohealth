import { OpenRouteServiceProvider } from './openRouteServiceProvider';
import type { RoutingProvider } from './types';

export * from './types';
export { OpenRouteServiceProvider } from './openRouteServiceProvider';

// Only ORS is active in production. A future local Dijkstra provider
// (see docs/ROUTING_ENGINE.md) will conform to the RoutingProvider interface
// and can be swapped in here without changes to the rest of the app.
let activeProvider: RoutingProvider = new OpenRouteServiceProvider();

export function getRoutingProvider(): RoutingProvider {
  return activeProvider;
}

export function setRoutingProvider(provider: RoutingProvider): void {
  activeProvider = provider;
}

export const ROUTING_PROVIDER_LABEL = 'OpenRouteService';