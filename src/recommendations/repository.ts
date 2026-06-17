import type {
  OpportunityRecommendation,
  RecommendationCategory,
  RecommendationStatus,
} from './types';
import { validateRecommendation } from './validate';

export type RecommendationFilter = {
  readonly status?: RecommendationStatus;
  readonly category?: RecommendationCategory;
  readonly minConfidence?: number;
};

export interface RecommendationRepository {
  add(recommendation: OpportunityRecommendation): void;
  get(id: string): OpportunityRecommendation | null;
  list(filter?: RecommendationFilter): OpportunityRecommendation[];
  updateStatus(id: string, next: RecommendationStatus): void;
  remove(id: string): void;
}

const ALLOWED_STATUS_TRANSITIONS: Readonly<Record<RecommendationStatus, readonly RecommendationStatus[]>> = {
  proposed: ['under-review', 'accepted', 'rejected', 'deferred'],
  'under-review': ['accepted', 'rejected', 'deferred'],
  accepted: [],
  rejected: [],
  deferred: ['under-review', 'rejected', 'accepted'],
};

export class InMemoryRecommendationRepository implements RecommendationRepository {
  private readonly byId = new Map<string, OpportunityRecommendation>();

  public add(recommendation: OpportunityRecommendation): void {
    const validation = validateRecommendation(recommendation);
    if (!validation.ok) {
      const message = validation.errors.map((e) => `${e.path}: ${e.message}`).join('; ');
      throw new Error(`Cannot add invalid recommendation: ${message}`);
    }
    if (this.byId.has(recommendation.id)) {
      throw new Error(`Recommendation with id '${recommendation.id}' already exists.`);
    }
    this.byId.set(recommendation.id, recommendation);
  }

  public get(id: string): OpportunityRecommendation | null {
    return this.byId.get(id) ?? null;
  }

  public list(filter?: RecommendationFilter): OpportunityRecommendation[] {
    const items = Array.from(this.byId.values());
    if (!filter) return items;
    return items.filter((r) => {
      if (filter.status && r.status !== filter.status) return false;
      if (filter.category && r.category !== filter.category) return false;
      if (typeof filter.minConfidence === 'number') {
        if (r.confidence.value < filter.minConfidence) return false;
      }
      return true;
    });
  }

  public updateStatus(id: string, next: RecommendationStatus): void {
    const existing = this.byId.get(id);
    if (!existing) throw new Error(`Cannot update status: id '${id}' not found.`);

    const current = existing.status;
    const allowed = ALLOWED_STATUS_TRANSITIONS[current] ?? [];
    if (!allowed.includes(next)) {
      throw new Error(
        `Illegal status transition: '${current}' -> '${next}'.`,
      );
    }

    const updated: OpportunityRecommendation = { ...existing, status: next };
    this.byId.set(id, updated);
  }

  public remove(id: string): void {
    this.byId.delete(id);
  }
}
