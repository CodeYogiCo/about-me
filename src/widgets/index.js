import NDCGCalculator from './NDCGCalculator.jsx'
import MRRCalculator from './MRRCalculator.jsx'
import PrecisionRecallCalculator from './PrecisionRecallCalculator.jsx'
import KVCacheCalculator from './KVCacheCalculator.jsx'

export const widgets = {
  'ndcg-calc': NDCGCalculator,
  'mrr-calc': MRRCalculator,
  'precision-recall-calc': PrecisionRecallCalculator,
  'kv-cache-calc': KVCacheCalculator,
}
