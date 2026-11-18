/**
 * Link recommendations to experiment lifecycle states.
 * OBSERVE → DIAGNOSE → EXPERIMENT → VERIFY: a recommendation linked to an
 * experiment carries that experiment's state; only 'verified-improvement'
 * represents an experimentally proven improvement.
 */
import type { Recommendation, RecommendationState } from '../core/types.ts';
import { listExperiments, loadExperiment } from './store.ts';
import { compareExperiment } from './compare.ts';

export function linkRecommendationStates(recommendations: Recommendation[]): void {
  let listed;
  try {
    listed = listExperiments();
  } catch {
    return;
  }
  const linked = listed.filter((e) => e.status !== 'corrupted');
  if (linked.length === 0) return;
  for (const entry of linked) {
    let record;
    try {
      record = loadExperiment(entry.id);
    } catch {
      continue;
    }
    if (record.recommendationIds.length === 0) continue;
    let state: RecommendationState;
    if (record.status === 'running') state = 'experiment-running';
    else if (record.trials.length === 0) state = 'ready-for-testing';
    else if (record.status === 'completed') state = compareExperiment(record).verdict.recommendationState;
    else state = 'inconclusive';
    for (const rec of recommendations) {
      if (record.recommendationIds.includes(rec.id)) {
        rec.state = state;
        rec.experimentId = record.id;
      }
    }
  }
}
