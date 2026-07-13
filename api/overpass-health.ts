interface ApiRequest {
  method?: string;
}

interface ApiResponse {
  setHeader(name: string, value: string): void;
  status(code: number): ApiResponse;
  json(payload: unknown): ApiResponse;
  end(): void;
}

export const config = {
  maxDuration: 30,
};

const OVERPASS_ENDPOINTS = [
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
] as const;

const HEALTH_QUERY = `
[out:json][timeout:5];
node(1);
out ids;
`;

async function checkProvider(endpoint: string) {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    7000,
  );

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type':
          'application/x-www-form-urlencoded;charset=UTF-8',
        'User-Agent':
          process.env.OVERPASS_USER_AGENT ||
          'isoHealth/1.0 healthcare-accessibility-platform',
      },
      body: new URLSearchParams({
        data: HEALTH_QUERY,
      }).toString(),
      signal: controller.signal,
    });

    const text = await response.text();
    let validJson = false;

    try {
      const parsed: unknown = JSON.parse(text);

      validJson =
        typeof parsed === 'object' &&
        parsed !== null &&
        Array.isArray(
          (parsed as { elements?: unknown }).elements,
        );
    } catch {
      validJson = false;
    }

    return {
      provider: endpoint,
      healthy: response.ok && validJson,
      status: response.status,
      durationMs: Date.now() - startedAt,
      message:
        response.ok && validJson
          ? undefined
          : 'Invalid or unsuccessful response',
    };
  } catch (error) {
    const timedOut =
      error instanceof Error &&
      error.name === 'AbortError';

    return {
      provider: endpoint,
      healthy: false,
      durationMs: Date.now() - startedAt,
      message: timedOut
        ? 'Timeout'
        : error instanceof Error
          ? error.message
          : 'Network error',
    };
  } finally {
    clearTimeout(timer);
  }
}

export default async function handler(
  req: ApiRequest,
  res: ApiResponse,
) {
  res.setHeader(
    'Content-Type',
    'application/json',
  );

  res.setHeader(
    'Cache-Control',
    'no-store',
  );

  if (req.method !== 'GET') {
    return res.status(405).json({
      success: false,
      error: 'Method not allowed.',
    });
  }

  const providers = [];

  for (const endpoint of OVERPASS_ENDPOINTS) {
    providers.push(
      await checkProvider(endpoint),
    );
  }

  const success = providers.some(
    (provider) => provider.healthy,
  );

  return res
    .status(success ? 200 : 503)
    .json({
      success,
      providers,
    });
}
