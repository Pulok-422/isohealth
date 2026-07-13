import type {
  Facility,
  ProviderAttempt,
} from '@/types/health';

type SuccessEnvelope<T> = {
  success: true;
  data: T;
};

type ErrorEnvelope = {
  success: false;
  error: string;
  code?: string;
  requestId?: string;
  attempts?: ProviderAttempt[];
};

export class ApiError extends Error {
  status?: number;
  code?: string;
  requestId?: string;
  attempts?: ProviderAttempt[];

  constructor(
    message: string,
    options?: {
      status?: number;
      code?: string;
      requestId?: string;
      attempts?: ProviderAttempt[];
    },
  ) {
    super(message);

    this.name = 'ApiError';
    this.status = options?.status;
    this.code = options?.code;
    this.requestId = options?.requestId;
    this.attempts = options?.attempts;
  }
}

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value)
  );
}

function isProviderAttempt(
  value: unknown,
): value is ProviderAttempt {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.provider === 'string' &&
    typeof value.durationMs === 'number' &&
    typeof value.outcome === 'string'
  );
}

function parseErrorEnvelope(
  value: unknown,
): ErrorEnvelope | null {
  if (
    !isRecord(value) ||
    value.success !== false ||
    typeof value.error !== 'string'
  ) {
    return null;
  }

  const attempts = Array.isArray(value.attempts)
    ? value.attempts.filter(isProviderAttempt)
    : undefined;

  return {
    success: false,
    error: value.error,
    code:
      typeof value.code === 'string'
        ? value.code
        : undefined,
    requestId:
      typeof value.requestId === 'string'
        ? value.requestId
        : undefined,
    attempts,
  };
}

export async function postJson<T>(
  path: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<T> {
  let response: Response;

  try {
    response = await fetch(path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (
      error instanceof Error &&
      error.name === 'AbortError'
    ) {
      throw new ApiError(
        'Request cancelled.',
        {
          code: 'CANCELLED',
        },
      );
    }

    throw new ApiError(
      `Network error while calling ${path}`,
      {
        code: 'NETWORK',
      },
    );
  }

  const rawText = await response.text();
  let payload: unknown = null;

  if (rawText) {
    try {
      payload = JSON.parse(rawText);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const errorPayload =
      parseErrorEnvelope(payload);

    throw new ApiError(
      errorPayload?.error ||
        `Request failed (${response.status})`,
      {
        status: response.status,
        code: errorPayload?.code,
        requestId: errorPayload?.requestId,
        attempts: errorPayload?.attempts,
      },
    );
  }

  if (
    !isRecord(payload) ||
    payload.success !== true ||
    !('data' in payload)
  ) {
    const errorPayload =
      parseErrorEnvelope(payload);

    throw new ApiError(
      errorPayload?.error ||
        'The server returned an unexpected response.',
      {
        status: response.status,
        code:
          errorPayload?.code ||
          'INVALID_RESPONSE',
        requestId:
          errorPayload?.requestId,
        attempts:
          errorPayload?.attempts,
      },
    );
  }

  return payload.data as T;
}

export interface FacilityFetchResult {
  facilities: Facility[];
  radiusUsed: number;
  source: 'OpenStreetMap Overpass';
  provider: string;
  truncated: boolean;
  rawElementCount: number;
  normalizedCount: number;
  possibleDuplicateCount: number;
  requestId: string;
  attempts: ProviderAttempt[];
}

type FacilityApiRecord = Omit<
  Facility,
  | 'insideOutermostIsochrone'
  | 'matrixEvaluated'
>;

function isFacilityApiRecord(
  value: unknown,
): value is FacilityApiRecord {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.type === 'string' &&
    typeof value.lat === 'number' &&
    Number.isFinite(value.lat) &&
    typeof value.lon === 'number' &&
    Number.isFinite(value.lon) &&
    typeof value.straightLineDistanceMeters ===
      'number' &&
    Number.isFinite(
      value.straightLineDistanceMeters,
    ) &&
    isRecord(value.tags)
  );
}

interface RawFacilityFetchResult {
  facilities: unknown;
  radiusUsed: number;
  source: 'OpenStreetMap Overpass';
  provider: string;
  truncated: boolean;
  rawElementCount: number;
  normalizedCount: number;
  possibleDuplicateCount: number;
  requestId: string;
  attempts: ProviderAttempt[];
}

export async function fetchFacilities(
  lat: number,
  lon: number,
  radius: number,
  signal?: AbortSignal,
): Promise<FacilityFetchResult> {
  const data =
    await postJson<RawFacilityFetchResult>(
      '/api/fetch-facilities',
      {
        lat,
        lon,
        radius,
      },
      signal,
    );

  if (!Array.isArray(data.facilities)) {
    throw new ApiError(
      'Facility service returned an invalid facilities list.',
      {
        code: 'INVALID_RESPONSE',
      },
    );
  }

  const facilities = data.facilities
    .filter(isFacilityApiRecord)
    .map<Facility>((facility) => ({
      ...facility,
      insideOutermostIsochrone: false,
      matrixEvaluated: false,
    }));

  if (
    facilities.length !==
    data.facilities.length
  ) {
    console.warn(
      `Discarded ${
        data.facilities.length -
        facilities.length
      } invalid facility records.`,
    );
  }

  return {
    ...data,
    facilities,
    attempts: Array.isArray(data.attempts)
      ? data.attempts.filter(
          isProviderAttempt,
        )
      : [],
  };
}
