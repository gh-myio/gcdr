import { resolveDailyBucketCap, isOverDailyCap } from '../../../src/workers/orchestrator-devices/rulesCap';

describe('resolveDailyBucketCap — daily cap in canonical buckets (fail-open)', () => {
  it('a positive integer ⇒ CONFIGURED with that many buckets', () => {
    expect(resolveDailyBucketCap({ maxDailyBucketsPerDay: 3 })).toEqual({ buckets: 3, reason: 'CONFIGURED' });
    expect(resolveDailyBucketCap({ maxDailyBucketsPerDay: 1 })).toEqual({ buckets: 1, reason: 'CONFIGURED' });
  });

  it('absent (undefined/null/empty config) ⇒ NO_CAP, buckets null (fail-open)', () => {
    expect(resolveDailyBucketCap({ maxDailyBucketsPerDay: undefined })).toEqual({ buckets: null, reason: 'NO_CAP' });
    expect(resolveDailyBucketCap({} as never)).toEqual({ buckets: null, reason: 'NO_CAP' });
    expect(resolveDailyBucketCap(null)).toEqual({ buckets: null, reason: 'NO_CAP' });
    expect(resolveDailyBucketCap(undefined)).toEqual({ buckets: null, reason: 'NO_CAP' });
  });

  it('non-positive / non-integer ⇒ INVALID, buckets null (fail-open, never mute on bad config)', () => {
    expect(resolveDailyBucketCap({ maxDailyBucketsPerDay: 0 })).toEqual({ buckets: null, reason: 'INVALID' });
    expect(resolveDailyBucketCap({ maxDailyBucketsPerDay: -2 })).toEqual({ buckets: null, reason: 'INVALID' });
    expect(resolveDailyBucketCap({ maxDailyBucketsPerDay: 2.5 })).toEqual({ buckets: null, reason: 'INVALID' });
    expect(resolveDailyBucketCap({ maxDailyBucketsPerDay: NaN })).toEqual({ buckets: null, reason: 'INVALID' });
    expect(resolveDailyBucketCap({ maxDailyBucketsPerDay: '3' as unknown as number })).toEqual({ buckets: null, reason: 'INVALID' });
  });
});

describe('isOverDailyCap — mute predicate (buckets, inclusive at the cap)', () => {
  const cap3 = resolveDailyBucketCap({ maxDailyBucketsPerDay: 3 });
  const noCap = resolveDailyBucketCap({ maxDailyBucketsPerDay: undefined });

  it('no cap ⇒ never over, regardless of count (fail-open)', () => {
    expect(isOverDailyCap(0, noCap)).toBe(false);
    expect(isOverDailyCap(999, noCap)).toBe(false);
  });

  it('below the cap ⇒ not over', () => {
    expect(isOverDailyCap(0, cap3)).toBe(false);
    expect(isOverDailyCap(2, cap3)).toBe(false);
  });

  it('at or above the cap ⇒ over (inclusive: 3/3 mutes)', () => {
    expect(isOverDailyCap(3, cap3)).toBe(true);
    expect(isOverDailyCap(4, cap3)).toBe(true);
  });
});
