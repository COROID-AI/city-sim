import type {
  ImplementationSurface,
  OpportunityConfidence,
  OpportunityEvidence,
  OpportunityRecommendation,
  OpportunityScore,
  RecommendationCategory,
  RecommendationStatus,
} from './types';

export type ValidationOk = { ok: true };

export type ValidationError = {
  ok: false;
  errors: readonly {
    path: string;
    message: string;
  }[];
};

export type ValidationResult = ValidationOk | ValidationError;

const CATEGORY_VALUES: readonly RecommendationCategory[] = [
  'performance',
  'reliability',
  'ux',
  'cost',
  'security',
  'testability',
  'accessibility',
  'documentation',
];

const STATUS_VALUES: readonly RecommendationStatus[] = [
  'proposed',
  'under-review',
  'accepted',
  'rejected',
  'deferred',
];

const CONFIDENCE_BASIS: readonly OpportunityConfidence['basis'][] = [
  'evidence-strength',
  'historical-precedent',
  'analyst-judgment',
  'mixed',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function addError(
  errors: { path: string; message: string }[],
  path: string,
  message: string,
): void {
  errors.push({ path, message });
}

function validateFiniteNumber(
  value: unknown,
  path: string,
  errors: { path: string; message: string }[],
): value is number {
  if (typeof value !== 'number' || Number.isNaN(value) || !Number.isFinite(value)) {
    addError(errors, path, 'Expected a finite number.');
    return false;
  }
  return true;
}

function validateRange01(
  value: unknown,
  path: string,
  errors: { path: string; message: string }[],
): value is number {
  if (!validateFiniteNumber(value, path, errors)) return false;
  const n = value as number;
  if (n < 0 || n > 1) {
    addError(errors, path, 'Expected value in [0, 1].');
    return false;
  }
  return true;
}

function validateIsoTimestamp(
  value: unknown,
  path: string,
  errors: { path: string; message: string }[],
): value is string {
  if (typeof value !== 'string') {
    addError(errors, path, 'Expected a string timestamp.');
    return false;
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    addError(errors, path, 'Expected a valid ISO timestamp string.');
    return false;
  }
  return true;
}

function validateCategory(
  value: unknown,
  path: string,
  errors: { path: string; message: string }[],
): value is RecommendationCategory {
  if (typeof value !== 'string') {
    addError(errors, path, 'Expected category to be a string.');
    return false;
  }
  if (!CATEGORY_VALUES.includes(value as RecommendationCategory)) {
    addError(errors, path, 'Unknown category.');
    return false;
  }
  return true;
}

function validateStatus(
  value: unknown,
  path: string,
  errors: { path: string; message: string }[],
): value is RecommendationStatus {
  if (typeof value !== 'string') {
    addError(errors, path, 'Expected status to be a string.');
    return false;
  }
  if (!STATUS_VALUES.includes(value as RecommendationStatus)) {
    addError(errors, path, 'Unknown status.');
    return false;
  }
  return true;
}

function validateEvidence(e: unknown, path: string, errors: { path: string; message: string }[]): e is OpportunityEvidence {
  if (!isRecord(e)) {
    addError(errors, path, 'Expected evidence to be an object.');
    return false;
  }
  const kind = e.kind;
  if (kind !== 'metric' && kind !== 'file' && kind !== 'event' && kind !== 'comparison') {
    addError(errors, `${path}.kind`, 'Unknown evidence kind.');
    return false;
  }
  if (typeof e.id !== 'string') {
    addError(errors, `${path}.id`, 'Expected evidence.id to be a string.');
    return false;
  }

  switch (kind) {
    case 'metric': {
      if (typeof e.path !== 'string') addError(errors, `${path}.path`, 'Expected metric.path to be a string.');
      if (!validateFiniteNumber(e.observed, `${path}.observed`, errors)) return false;
      if (!validateFiniteNumber(e.expected, `${path}.expected`, errors)) return false;
      return errors.length === 0;
    }
    case 'file': {
      if (typeof e.path !== 'string') addError(errors, `${path}.path`, 'Expected file.path to be a string.');
      if (!Array.isArray(e.lines) || !e.lines.every((n) => typeof n === 'number' && Number.isFinite(n))) {
        addError(errors, `${path}.lines`, 'Expected file.lines to be an array of finite numbers.');
        return false;
      }
      if (typeof e.excerpt !== 'string') addError(errors, `${path}.excerpt`, 'Expected file.excerpt to be a string.');
      return errors.length === 0;
    }
    case 'event': {
      if (typeof e.system !== 'string') addError(errors, `${path}.system`, 'Expected event.system to be a string.');
      if (typeof e.payloadRef !== 'string') addError(errors, `${path}.payloadRef`, 'Expected event.payloadRef to be a string.');
      return errors.length === 0;
    }
    case 'comparison': {
      if (typeof e.baselineId !== 'string') addError(errors, `${path}.baselineId`, 'Expected comparison.baselineId to be a string.');
      if (typeof e.candidateId !== 'string') addError(errors, `${path}.candidateId`, 'Expected comparison.candidateId to be a string.');
      return errors.length === 0;
    }
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

function validateSurface(s: unknown, path: string, errors: { path: string; message: string }[]): s is ImplementationSurface {
  if (!isRecord(s)) {
    addError(errors, path, 'Expected surfaces element to be an object.');
    return false;
  }
  const kind = s.kind;
  if (kind !== 'code-path' && kind !== 'module' && kind !== 'config' && kind !== 'doc') {
    addError(errors, `${path}.kind`, 'Unknown surface kind.');
    return false;
  }

  switch (kind) {
    case 'code-path': {
      if (typeof s.ref !== 'string') addError(errors, `${path}.ref`, 'Expected code-path.ref to be a string.');
      return errors.length === 0;
    }
    case 'module': {
      if (typeof s.modulePath !== 'string') addError(errors, `${path}.modulePath`, 'Expected module.modulePath to be a string.');
      if (typeof s.symbol !== 'undefined' && typeof s.symbol !== 'string') {
        addError(errors, `${path}.symbol`, 'Expected module.symbol to be a string if provided.');
      }
      return errors.length === 0;
    }
    case 'config': {
      if (typeof s.configPath !== 'string') addError(errors, `${path}.configPath`, 'Expected config.configPath to be a string.');
      if (typeof s.key !== 'undefined' && typeof s.key !== 'string') addError(errors, `${path}.key`, 'Expected config.key to be a string if provided.');
      return errors.length === 0;
    }
    case 'doc': {
      if (typeof s.docPath !== 'string') addError(errors, `${path}.docPath`, 'Expected doc.docPath to be a string.');
      if (typeof s.anchor !== 'undefined' && typeof s.anchor !== 'string') addError(errors, `${path}.anchor`, 'Expected doc.anchor to be a string if provided.');
      return errors.length === 0;
    }
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

function validateScore(
  score: unknown,
  path: string,
  errors: { path: string; message: string }[],
): score is OpportunityScore {
  if (!isRecord(score)) {
    addError(errors, path, 'Expected score to be an object.');
    return false;
  }
  if (!validateRange01(score.value, `${path}.value`, errors)) return false;
  if (!Array.isArray(score.components)) {
    addError(errors, `${path}.components`, 'Expected score.components to be an array.');
    return false;
  }
  for (let i = 0; i < score.components.length; i++) {
    const c = score.components[i];
    const cPath = `${path}.components[${i}]`;
    if (!isRecord(c)) {
      addError(errors, cPath, 'Expected component to be an object.');
      continue;
    }
    if (typeof c.key !== 'string') addError(errors, `${cPath}.key`, 'Expected component.key to be a string.');
    if (!validateRange01(c.weight, `${cPath}.weight`, errors)) continue;
    if (!validateRange01(c.contribution, `${cPath}.contribution`, errors)) continue;
  }
  return errors.length === 0;
}

function validateConfidence(
  confidence: unknown,
  path: string,
  errors: { path: string; message: string }[],
): confidence is OpportunityConfidence {
  if (!isRecord(confidence)) {
    addError(errors, path, 'Expected confidence to be an object.');
    return false;
  }
  if (!validateRange01(confidence.value, `${path}.value`, errors)) return false;
  if (typeof confidence.basis !== 'string') {
    addError(errors, `${path}.basis`, 'Expected confidence.basis to be a string.');
    return false;
  }
  if (!CONFIDENCE_BASIS.includes(confidence.basis as OpportunityConfidence['basis'])) {
    addError(errors, `${path}.basis`, 'Unknown confidence basis.');
    return false;
  }
  return errors.length === 0;
}

export function validateRecommendation(
  value: unknown,
): ValidationResult {
  const errors: { path: string; message: string }[] = [];
  if (!isRecord(value)) {
    addError(errors, 'recommendation', 'Expected recommendation to be an object.');
    return { ok: false, errors };
  }

  if (typeof value.id !== 'string' || value.id.length === 0) {
    addError(errors, 'id', 'Expected id to be a non-empty string.');
  }
  if (typeof value.title !== 'string') addError(errors, 'title', 'Expected title to be a string.');
  if (typeof value.summary !== 'string') addError(errors, 'summary', 'Expected summary to be a string.');
  if (!validateCategory(value.category, 'category', errors)) {
    // error added
  }

  if (!Array.isArray(value.evidence)) {
    addError(errors, 'evidence', 'Expected evidence to be an array.');
  } else {
    for (let i = 0; i < value.evidence.length; i++) {
      validateEvidence(value.evidence[i], `evidence[${i}]`, errors);
    }
  }

  if (!validateScore(value.score, 'score', errors)) {
    // error added
  }

  if (!validateConfidence(value.confidence, 'confidence', errors)) {
    // error added
  }

  if (!Array.isArray(value.surfaces)) {
    addError(errors, 'surfaces', 'Expected surfaces to be an array.');
  } else {
    for (let i = 0; i < value.surfaces.length; i++) {
      validateSurface(value.surfaces[i], `surfaces[${i}]`, errors);
    }
  }

  validateStatus(value.status, 'status', errors);
  validateIsoTimestamp(value.createdAt, 'createdAt', errors);

  if (typeof value.rationale !== 'string') addError(errors, 'rationale', 'Expected rationale to be a string.');

  if (!Array.isArray(value.tags) || !value.tags.every((t) => typeof t === 'string')) {
    addError(errors, 'tags', 'Expected tags to be an array of strings.');
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true };
}

export function assertIsRecommendation(value: unknown): asserts value is OpportunityRecommendation {
  const res = validateRecommendation(value);
  if (!res.ok) {
    const message = res.errors.map((e) => `${e.path}: ${e.message}`).join('; ');
    throw new Error(`Invalid OpportunityRecommendation: ${message}`);
  }
}
