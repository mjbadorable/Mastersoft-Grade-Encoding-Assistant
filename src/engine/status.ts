// Student statuses per term (D23).
import { rules, type Status, type Term } from './rules';
import { TERMS } from './compute';

export type TermStatuses = Partial<Record<Term, Status>>;

/** DRP and WP carry forward to every later term; other statuses stay in their own term. */
export function withCarryForward(statuses: TermStatuses): TermStatuses {
  const result: TermStatuses = {};
  let carried: Status | undefined;
  for (const term of TERMS) {
    const own = statuses[term];
    const status = carried ?? own;
    if (status) result[term] = status;
    if (!carried && own && rules.carryForwardStatuses.includes(own)) carried = own;
  }
  return result;
}

/** The status the Final Rating shows: the most serious one in any term, or undefined. */
export function finalRatingStatus(statuses: TermStatuses): Status | undefined {
  const present = new Set(Object.values(withCarryForward(statuses)));
  return rules.statusPriority.find((s) => present.has(s));
}
