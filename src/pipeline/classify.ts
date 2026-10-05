/**
 * Rule-based task classification.
 *
 * Keyword patterns decide most tasks for free. Only when the rules are
 * ambiguous does the caller fall back to a cheap LLM (see llm.ts), and that
 * answer is cached by content hash.
 */

import { CATEGORIES, type Category, type Classification } from "./types.js";

const RULES: Record<Category, RegExp[]> = {
  coding: [
    /\bbug(s|fix)?\b/i, /\bfix(es|ing)?\b/i, /\bpull request\b|\bPR\b/, /\brepo(sitory)?\b/i,
    /\b(unit|regression|e2e) tests?\b/i, /\brefactor/i, /\b(typescript|javascript|python|rust|golang|solidity|kotlin|swift|c\+\+|c99)\b/i,
    /\bimplement(ation)?\b/i, /\bcompile|\bbuild (fails|error)/i, /\bSDK\b/, /\bstack trace|exception\b/i,
    /\bgithub issue\b/i, /\bwasm\b/i, /\bsmart contract\b/i,
  ],
  data: [
    /\bcsv\b/i, /\bjson\b/i, /\bdataset\b/i, /\bclean(ing)? (the )?data\b/i, /\bnormaliz/i, /\bdedup/i,
    /\bETL\b/, /\bspreadsheet|excel\b/i, /\bparse|parsing\b/i, /\btransform(ation)?\b/i, /\bSQL\b/,
    /\bschema\b/i, /\bextract(ion)? (data|fields|records)\b/i, /\blabel(l)?ing\b/i,
  ],
  research: [
    /\bresearch\b/i, /\bfind (one|a|the|all)?\b/i, /\bcompile a list\b/i, /\bsources?\b/i, /\bcite|citation/i,
    /\bmarket (analysis|research)\b/i, /\bcompetitor/i, /\bgather(ing)?\b/i, /\breport\b/i,
    /\bverify|verified\b/i, /\blookup|look up\b/i, /\bpart number\b/i, /\bopportunit(y|ies)\b/i,
  ],
  automation: [
    /\bautomat(e|ion|ed)\b/i, /\bintegrat(e|ion)\b/i, /\bwebhook/i, /\bAPI\b/, /\bcron\b/i, /\bpipeline\b/i,
    /\bscraper|scraping\b/i, /\bbot\b/i, /\bworkflow\b/i, /\bzapier|n8n|make\.com\b/i, /\bCI\b|\bgithub actions\b/i,
    /\bdocker|compose|self-host/i, /\bMCP\b/, /\bx402\b/i, /\bendpoint\b/i,
  ],
  content: [
    /\bquest\b/i, /\bwrite (a|an|the)\b/i, /\barticle|blog( post)?\b/i, /\bthread\b/i, /\bcopy(writing)?\b/i,
    /\btranslat(e|ion)\b/i, /\bdocs?\b|\bdocumentation\b/i, /\bsummar(y|ize)\b/i, /\breview\b/i,
    /\bchallenge\b/i, /\bshow (the|that|how)\b/i, /\btutorial|guide\b/i, /\bnewsletter\b/i,
  ],
};

/** Work we do not take: visual/media creation, physical tasks, identity-bound tasks. */
const OUT_OF_SCOPE: RegExp[] = [
  /\blogo\b/i, /\billustrat/i, /\bdrawing\b/i, /\bpaint/i, /\bimage generation|generate (an )?image\b/i,
  /\bvideo\b/i, /\banimation\b/i, /\bvoice ?over|podcast\b/i, /\bphoto(graph)?\b/i, /\bmockup\b/i,
  /\bphysical(ly)?\b/i, /\bin person\b/i, /\bphone call\b/i, /\bKYC\b/, /\bselfie\b/i,
  /\b(followers|upvotes|likes|reviews) for\b/i, /\bfake (reviews|accounts)\b/i,
];

export interface RuleClassification {
  category: Classification;
  /** 0..1, how much the winner beats the runner-up. */
  confidence: number;
  scores: Record<Category, number>;
  outOfScopeHits: number;
}

export function classifyByRules(text: string): RuleClassification {
  const scores = Object.fromEntries(
    CATEGORIES.map((c) => [c, RULES[c].reduce((n, re) => n + (re.test(text) ? 1 : 0), 0)]),
  ) as Record<Category, number>;
  const outOfScopeHits = OUT_OF_SCOPE.reduce((n, re) => n + (re.test(text) ? 1 : 0), 0);

  const ranked = [...CATEGORIES].sort((a, b) => scores[b] - scores[a]);
  const [top, second] = [scores[ranked[0]], scores[ranked[1]]];

  // Visual/physical work dominates unless the task is clearly something else.
  if (outOfScopeHits > 0 && outOfScopeHits >= top) {
    return { category: "other", confidence: Math.min(1, 0.5 + 0.25 * outOfScopeHits), scores, outOfScopeHits };
  }
  if (top === 0) {
    return { category: "other", confidence: 0, scores, outOfScopeHits };
  }
  return {
    category: ranked[0],
    confidence: (top - second) / (top + 1),
    scores,
    outOfScopeHits,
  };
}

/** Rules are trusted when they found a clear winner (or a clear out-of-scope). */
export function isConfident(result: RuleClassification): boolean {
  if (result.category === "other") return result.outOfScopeHits > 0;
  const top = result.scores[result.category];
  return top >= 2 && result.confidence >= 0.25;
}
