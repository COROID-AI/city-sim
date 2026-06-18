export type MetricKey =
  | 'safety'
  | 'walkability'
  | 'economicHealth'
  | 'environmentalImpact'
  | 'overallScore';

export type AppErrorCode =
  | 'INVALID_SEED'
  | 'INVALID_DIMS'
  | 'INVALID_HOUR'
  | 'INVALID_OPPORTUNITY'
  | 'INVALID_OPPORTUNITY_STATUS'
  | 'OPPORTUNITY_NOT_FOUND'
  | 'OPPORTUNITY_ALREADY_ACCEPTED'
  | 'CITY_INVALID_STATE';

export class AppError extends Error {
  public readonly code: AppErrorCode;

  public constructor(code: AppErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'AppError';
  }
}

export type OpportunityStatus = 'draft' | 'active' | 'accepted' | 'completed';

export type Opportunity = Readonly<{
  id: string;
  kind: 'transport' | 'housing' | 'safety' | 'economy' | 'environment';
  description: string;
  createdAtTick: number;
  status: OpportunityStatus;
  // Downstream tasks may add more fields; keep contract additive.
  metrics?: Partial<Record<MetricKey, number>>;
}>;

export type City = Readonly<{
  readonly seed: number;
  readonly width: number;
  readonly height: number;
  readonly startHour: number;
  readonly tick: number;
  readonly hour: number;
  readonly population: number;
  readonly opportunities: ReadonlyArray<Opportunity>;
}>;

export type CreateCityInput = {
  seed: number;
  width: number;
  height: number;
  startHour: number;
};

export type AddOpportunityInput = {
  kind: Opportunity['kind'];
  description: string;
};

function assertInt(value: number, name: string): void {
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    throw new AppError('CITY_INVALID_STATE', `${name} must be an integer`);
  }
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function validateSeed(seed: number): number {
  if (!Number.isFinite(seed) || !Number.isInteger(seed)) {
    throw new AppError('INVALID_SEED', 'seed must be an integer');
  }
  return clampInt(seed, 0, 2_147_483_647);
}

function validateDims(width: number, height: number): { width: number; height: number } {
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    throw new AppError('INVALID_DIMS', 'width/height must be numbers');
  }
  assertInt(width, 'width');
  assertInt(height, 'height');
  if (width < 1 || width > 256 || height < 1 || height > 256) {
    throw new AppError('INVALID_DIMS', 'width/height out of range');
  }
  return { width, height };
}

function validateHour(startHour: number): number {
  if (!Number.isFinite(startHour) || !Number.isInteger(startHour)) {
    throw new AppError('INVALID_HOUR', 'startHour must be an integer');
  }
  if (startHour < 0 || startHour > 23) {
    throw new AppError('INVALID_HOUR', 'startHour must be between 0 and 23');
  }
  return startHour;
}

function stablePopulation(seed: number, width: number, height: number): number {
  // Deterministic, framework-agnostic formula (no RNG needed for foundation contract).
  const area = width * height;
  const s = (seed % 9973 + 9973) % 9973;
  return Math.max(10, Math.floor((area * 37 + s * 11) / 10));
}

function nextHour(hour: number): number {
  return (hour + 1) % 24;
}

function makeOpportunityId(seed: number, tick: number, idx: number): string {
  return `opp_${seed}_${tick}_${idx}`;
}

export function createCity(input: CreateCityInput): City {
  const seed = validateSeed(input.seed);
  const dims = validateDims(input.width, input.height);
  const startHour = validateHour(input.startHour);

  const population = stablePopulation(seed, dims.width, dims.height);

  return {
    seed,
    width: dims.width,
    height: dims.height,
    startHour,
    tick: 0,
    hour: startHour,
    population,
    opportunities: []
  };
}

export function recordTick(city: City): City {
  // Immutable update.
  return {
    ...city,
    tick: city.tick + 1,
    hour: nextHour(city.hour)
  };
}

export function addOpportunity(city: City, input: AddOpportunityInput): City {
  const description = input.description.trim();
  if (!description) {
    throw new AppError('INVALID_OPPORTUNITY', 'description must be non-empty');
  }

  const kind = input.kind;
  if (!['transport', 'housing', 'safety', 'economy', 'environment'].includes(kind)) {
    throw new AppError('INVALID_OPPORTUNITY', `invalid kind: ${kind}`);
  }

  const idx = city.opportunities.length;
  const id = makeOpportunityId(city.seed, city.tick, idx);

  const opportunity: Opportunity = {
    id,
    kind,
    description,
    createdAtTick: city.tick,
    status: 'active'
  };

  return {
    ...city,
    opportunities: [...city.opportunities, opportunity]
  };
}

export function acceptOpportunity(city: City, opportunityId: string): City {
  const exists = city.opportunities.some((o) => o.id === opportunityId);
  if (!exists) {
    throw new AppError('OPPORTUNITY_NOT_FOUND', 'opportunity not found');
  }

  const updated: Opportunity[] = city.opportunities.map((o) => {
    if (o.id !== opportunityId) return o;
    if (o.status === 'accepted' || o.status === 'completed') {
      throw new AppError('OPPORTUNITY_ALREADY_ACCEPTED', 'opportunity already accepted');
    }
    if (o.status !== 'active' && o.status !== 'draft') {
      throw new AppError('INVALID_OPPORTUNITY_STATUS', `cannot accept status: ${o.status}`);
    }

    return {
      ...o,
      status: 'accepted' satisfies Opportunity['status']
    };
  });

  return {
    ...city,
    opportunities: updated as City['opportunities']
  };
}
