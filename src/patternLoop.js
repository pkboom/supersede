export async function runPatternLoop(items, operations, options = {}) {
  const maxValidationAttempts = options.maxValidationAttempts ?? 3;
  const pending = [...items];
  const processed = [];
  const reviews = [];
  const patterns = [];
  const events = [];
  const attempts = new Map();
  const failedPatterns = new Map();

  while (pending.length) {
    const seed = pending[0];
    let discovered = null;
    for (let index = 1; index < pending.length; index += 1) {
      const candidate = pending[index];
      const previousFailure = failedPatterns.get(seed.id);
      const comparison = await operations.compare(seed, candidate, previousFailure);
      events.push({ type: "compared", seed: seed.id, candidate: candidate.id, status: comparison.status });
      if (comparison.status === "pattern") {
        if (previousFailure?.pattern.id === comparison.pattern.id) {
          events.push({ type: "repeated_failed_pattern", file: seed.id, pattern: comparison.pattern.id });
          continue;
        }
        discovered = { ...comparison, candidate };
        break;
      }
      if (comparison.status !== "no_pattern") {
        events.push({ type: "comparison_review", seed: seed.id, candidate: candidate.id });
      }
    }

    if (!discovered) {
      if (failedPatterns.has(seed.id)) {
        reviews.push({
          item: seed,
          validation: { status: "review", concerns: ["No second file established a replacement visual pattern."] },
          pattern: failedPatterns.get(seed.id).pattern,
          reason: "failed_pattern_has_no_partner",
        });
        pending.shift();
        events.push({ type: "review_required", file: seed.id });
        continue;
      }
      const applied = await operations.applySingle(seed);
      if (applied.status === "review") {
        reviews.push({ item: seed, validation: { status: "review", concerns: applied.warnings ?? [] }, reason: "single_review" });
        pending.shift();
        events.push({ type: "review_required", file: seed.id });
        continue;
      }
      const validation = await operations.validate(seed, applied, failedPatterns.get(seed.id)?.pattern ?? null);
      const count = (attempts.get(seed.id) ?? 0) + 1;
      attempts.set(seed.id, count);
      if (validation.status === "pass") {
        processed.push({ item: seed, applied, validation, pattern: null });
        failedPatterns.delete(seed.id);
        pending.shift();
        events.push({ type: "single_validated", file: seed.id });
      } else if (count >= maxValidationAttempts) {
        reviews.push({ item: seed, validation, reason: "single_validation_failed" });
        pending.shift();
        events.push({ type: "review_required", file: seed.id });
      } else {
        pending.push(pending.shift());
        events.push({ type: "validation_failed", file: seed.id, attempt: count });
      }
      continue;
    }

    const pattern = discovered.pattern;
    patterns.push(pattern);
    const knownMatches = new Map([
      [seed.id, discovered.seedMatch],
      [discovered.candidate.id, discovered.candidateMatch],
    ]);
    const batch = [];
    for (const item of pending) {
      if (knownMatches.has(item.id)) {
        batch.push({ item, match: knownMatches.get(item.id) });
        continue;
      }
      const result = await operations.match(pattern, item);
      if (result.matched) batch.push({ item, match: result.match });
    }
    events.push({ type: "pattern_discovered", pattern: pattern.id, files: batch.map(({ item }) => item.id) });

    let progressed = false;
    for (const { item, match } of batch) {
      const applied = await operations.apply(pattern, item, match);
      const validation = await operations.validate(item, applied, pattern);
      const count = (attempts.get(item.id) ?? 0) + 1;
      attempts.set(item.id, count);
      if (validation.status === "pass") {
        processed.push({ item, applied, validation, pattern });
        failedPatterns.delete(item.id);
        pending.splice(pending.indexOf(item), 1);
        progressed = true;
        events.push({ type: "pattern_validated", pattern: pattern.id, file: item.id });
      } else {
        failedPatterns.set(item.id, { pattern, validation });
        events.push({ type: "validation_failed", pattern: pattern.id, file: item.id, attempt: count });
        if (count >= maxValidationAttempts) {
          reviews.push({ item, validation, pattern, reason: "pattern_validation_failed" });
          pending.splice(pending.indexOf(item), 1);
          progressed = true;
          events.push({ type: "review_required", file: item.id });
        }
      }
    }
    if (!progressed && batch.length) {
      const first = pending.shift();
      pending.push(first);
    }
  }

  return { processed, reviews, patterns, events };
}
