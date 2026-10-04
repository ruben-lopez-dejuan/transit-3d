import assert from 'node:assert/strict';
import test from 'node:test';
import { CACHE_CONTROL, networkCacheControl } from './httpCache';

test('stable catalogues are cacheable while partial or failed catalogues revalidate', () => {
  assert.equal(networkCacheControl([{ status: 'ok' }, { status: 'degraded' }]), CACHE_CONTROL.catalog);
  assert.equal(networkCacheControl([{ status: 'ok', loading: true }]), CACHE_CONTROL.preparing);
  assert.equal(networkCacheControl([{ status: 'unavailable' }]), CACHE_CONTROL.preparing);
  assert.match(CACHE_CONTROL.manifest, /stale-while-revalidate/);
  assert.equal(CACHE_CONTROL.live, 'no-store');
});
