export type {
  ImplementationSurface,
  OpportunityConfidence,
  OpportunityEvidence,
  OpportunityRecommendation,
  OpportunityScore,
  RecommendationCategory,
  RecommendationStatus,
} from './types';

export { validateRecommendation, assertIsRecommendation } from './validate';

export type { RecommendationFilter, RecommendationRepository } from './repository';
export { InMemoryRecommendationRepository } from './repository';

export { scoreOpportunity } from './scoring';
export type { OpportunityDimensions, ConfidenceBasisInput, ScoreOpportunityInput, ScoreOpportunityOptions } from './scoring';
