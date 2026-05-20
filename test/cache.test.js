const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const cache = require('../src/cache');

describe('Cache', () => {

  beforeEach(() => {
    cache.clear();
    cache.configure({ enabled: true, maxSize: 100, ttlSeconds: 60 });
  });

  describe('basic get/set', () => {
    it('returns null for cache miss', () => {
      const result = cache.get('gpt-4o', [{ role: 'user', content: 'hi' }], {});
      assert.equal(result, null);
    });

    it('returns cached data on hit', () => {
      const messages = [{ role: 'user', content: 'hello' }];
      const params = { temperature: 0.7 };
      const data = { choices: [{ message: { content: 'world' } }] };

      cache.set('gpt-4o', messages, params, data);
      const result = cache.get('gpt-4o', messages, params);
      assert.deepEqual(result, data);
    });

    it('differentiates by model', () => {
      const messages = [{ role: 'user', content: 'hi' }];
      cache.set('gpt-4o', messages, {}, { model: 'gpt-4o' });
      cache.set('claude-3', messages, {}, { model: 'claude-3' });

      const r1 = cache.get('gpt-4o', messages, {});
      assert.equal(r1.model, 'gpt-4o');
      const r2 = cache.get('claude-3', messages, {});
      assert.equal(r2.model, 'claude-3');
    });

    it('differentiates by params', () => {
      const messages = [{ role: 'user', content: 'hi' }];
      cache.set('gpt-4o', messages, { temperature: 0.5 }, { t: 0.5 });
      cache.set('gpt-4o', messages, { temperature: 1.0 }, { t: 1.0 });

      assert.equal(cache.get('gpt-4o', messages, { temperature: 0.5 }).t, 0.5);
      assert.equal(cache.get('gpt-4o', messages, { temperature: 1.0 }).t, 1.0);
    });
  });

  describe('disabled', () => {
    it('returns null when disabled', () => {
      cache.configure({ enabled: false });
      const messages = [{ role: 'user', content: 'hi' }];
      cache.set('gpt-4o', messages, {}, { data: 1 });
      assert.equal(cache.get('gpt-4o', messages, {}), null);
    });
  });

  describe('TTL expiry', () => {
    it('expires entries after TTL', () => {
      cache.configure({ enabled: true, ttlSeconds: 0 }); // 0 second TTL = immediate expiry
      const messages = [{ role: 'user', content: 'hi' }];
      cache.set('gpt-4o', messages, {}, { data: 1 });
      // Should be expired immediately
      const result = cache.get('gpt-4o', messages, {});
      assert.equal(result, null);
    });
  });

  describe('LRU eviction', () => {
    it('evicts oldest entry when full', () => {
      cache.configure({ enabled: true, maxSize: 2, ttlSeconds: 300 });
      const m1 = [{ role: 'user', content: 'a' }];
      const m2 = [{ role: 'user', content: 'b' }];
      const m3 = [{ role: 'user', content: 'c' }];

      cache.set('gpt-4o', m1, {}, { id: 1 });
      cache.set('gpt-4o', m2, {}, { id: 2 });
      cache.set('gpt-4o', m3, {}, { id: 3 }); // should evict m1

      assert.equal(cache.get('gpt-4o', m1, {}), null);
      assert.deepEqual(cache.get('gpt-4o', m2, {}), { id: 2 });
      assert.deepEqual(cache.get('gpt-4o', m3, {}), { id: 3 });
    });
  });

  describe('stats', () => {
    it('reports correct stats', () => {
      const messages = [{ role: 'user', content: 'hi' }];
      cache.set('gpt-4o', messages, {}, { data: 1 });
      cache.get('gpt-4o', messages, {}); // hit
      cache.get('gpt-4o', messages, {}); // hit

      const s = cache.stats();
      assert.equal(s.enabled, true);
      assert.equal(s.size, 1);
      assert.equal(s.totalHits, 2);
    });
  });

  describe('clear', () => {
    it('removes all entries', () => {
      const messages = [{ role: 'user', content: 'hi' }];
      cache.set('gpt-4o', messages, {}, { data: 1 });
      const cleared = cache.clear();
      assert.equal(cleared, 1);
      assert.equal(cache.stats().size, 0);
    });
  });
});
