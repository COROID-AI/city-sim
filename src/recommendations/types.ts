export type RecommendationCategory =
  | 'performance'
  | 'reliability'
  | 'ux'
  | 'cost'
  | 'security'
  | 'testability'
  | 'accessibility'
  | 'documentation';

export type RecommendationStatus =
  | 'proposed'
  | 'under-review'
  | 'accepted'
  | 'rejected'
  | 'deferred';

export type OpportunityScore = {
  value: number;
  components: readonly {
    key: string;
    weight: number;
    contribution: number;
  }[];
};

export type OpportunityConfidence = {
  value: number;
  basis:
    | 'evidence-strength'
    | 'historical-precedent'
    | 'analyst-judgment'
    | 'mixed';
};

export type OpportunityEvidence =
  | {
      readonly id: string;
      readonly kind: 'metric';
      readonly path: string;
      readonly observed: number;
      readonly expected: number;
    }
  | {
      readonly id: string;
      readonly kind: 'file';
      readonly path: string;
      readonly lines: readonly number[];
      readonly excerpt: string;
    }
  | {
      readonly id: string;
      readonly kind: 'event';
      readonly system: string;
      readonly payloadRef: string;
    }
  | {
      readonly id: string;
      readonly kind: 'comparison';
      readonly baselineId: string;
      readonly candidateId: string;
    };

export type ImplementationSurface =
  | {
      readonly kind: 'code-path';
      readonly ref: string;
    }
  | {
      readonly kind: 'module';
      readonly modulePath: string;
      readonly symbol?: string;
    }
  | {
      readonly kind: 'config';
      readonly configPath: string;
      readonly key?: string;
    }
  | {
      readonly kind: 'doc';
      readonly docPath: string;
      readonly anchor?: string;
    };

export type OpportunityRecommendation = {
  readonly id: string;
  title: string;
  summary: string;
  category: RecommendationCategory;
  evidence: readonly OpportunityEvidence[];
  score: OpportunityScore;
  confidence: OpportunityConfidence;
  surfaces: readonly ImplementationSurface[];
  status: RecommendationStatus;
  readonly createdAt: string;
  rationale: string;
  tags: readonly string[];
};
