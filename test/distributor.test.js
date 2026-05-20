const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// Mock config module before requiring distributor
const path = require('path');
const configPath = path.resolve(__dirname, '..', 'src', 'config');

// We need to set up a minimal config mock
const _channels = [];
const _modelIndex = new Map();

const mockConfig = {
  load() {},
  get() { return { channels: _channels, server: { apiKeys: [], adminToken: 'test' }, relay: { retryTimes: 2, retryOnStatusCodes: [502, 503] }, modelAliases: {} }; },
  getModelIndex() { return _modelIndex; },
  getAllChannels() { return _channels; },
  getAllModels() { return [..._modelIndex.keys()]; },
  getChannel(id) { return _channels.find(c => c.id === id); },
  addChannel(ch) { _channels.push(ch); return ch; },
  updateChannel() {},
  deleteChannel() {},
  save() {},
  getAliasReverse() { return {}; },
};

// Replace config in require cache
require.cache[require.resolve(configPath)] = { id: configPath, filename: configPath, loaded: true, exports: mockConfig };

const distributor = require('../src/relay/distributor');

function setupChannels(channels) {
  _channels.length = 0;
  _modelIndex.clear();
  for (const ch of channels) {
    ch._keyIndex = 0;
    ch.status = ch.status || 'enabled';
    ch.weight = ch.weight ?? 10;
    ch.priority = ch.priority ?? 0;
    ch.keys = ch.keys || ['sk-test'];
    ch.models = ch.models || [];
    ch.modelMapping = ch.modelMapping || {};
    ch.disabledModels = ch.disabledModels || [];
    _channels.push(ch);
    for (const m of ch.models) {
      if (!_modelIndex.has(m)) _modelIndex.set(m, []);
      _modelIndex.get(m).push(ch);
    }
  }
}

describe('Distributor', () => {

  beforeEach(() => {
    _channels.length = 0;
    _modelIndex.clear();
  });

  describe('selectChannel', () => {
    it('returns null when no channels exist', () => {
      const ch = distributor.selectChannel('gpt-4o');
      assert.equal(ch, null);
    });

    it('selects a channel for a known model', () => {
      setupChannels([
        { id: 1, name: 'ch1', models: ['gpt-4o'], endpoint: 'http://a' },
      ]);
      const ch = distributor.selectChannel('gpt-4o');
      assert.notEqual(ch, null);
      assert.equal(ch.id, 1);
    });

    it('respects priority ordering', () => {
      setupChannels([
        { id: 1, name: 'low', models: ['gpt-4o'], priority: 0, endpoint: 'http://a' },
        { id: 2, name: 'high', models: ['gpt-4o'], priority: 10, endpoint: 'http://b' },
      ]);
      // High priority should always be selected
      const results = new Set();
      for (let i = 0; i < 20; i++) {
        results.add(distributor.selectChannel('gpt-4o').id);
      }
      assert.equal(results.has(2), true);
      // Channel 1 should not be selected when channel 2 is available
      assert.equal(results.has(1), false);
    });

    it('skips disabled channels', () => {
      setupChannels([
        { id: 1, name: 'off', models: ['gpt-4o'], status: 'disabled', endpoint: 'http://a' },
        { id: 2, name: 'on', models: ['gpt-4o'], status: 'enabled', endpoint: 'http://b' },
      ]);
      const ch = distributor.selectChannel('gpt-4o');
      assert.equal(ch.id, 2);
    });
  });

  describe('selectChannelWithRetry', () => {
    it('excludes specified channel IDs', () => {
      setupChannels([
        { id: 1, name: 'a', models: ['gpt-4o'], endpoint: 'http://a' },
        { id: 2, name: 'b', models: ['gpt-4o'], endpoint: 'http://b' },
      ]);
      const ch = distributor.selectChannelWithRetry('gpt-4o', [1]);
      assert.notEqual(ch, null);
      assert.equal(ch.id, 2);
    });

    it('returns null when all excluded', () => {
      setupChannels([
        { id: 1, name: 'a', models: ['gpt-4o'], endpoint: 'http://a' },
      ]);
      const ch = distributor.selectChannelWithRetry('gpt-4o', [1]);
      assert.equal(ch, null);
    });
  });

  describe('nextKey', () => {
    it('round-robins through keys', () => {
      const ch = { keys: ['k1', 'k2', 'k3'], _keyIndex: 0 };
      assert.equal(distributor.nextKey(ch), 'k1');
      assert.equal(distributor.nextKey(ch), 'k2');
      assert.equal(distributor.nextKey(ch), 'k3');
      assert.equal(distributor.nextKey(ch), 'k1');
    });
  });

  describe('resolveModel', () => {
    it('uses modelMapping if present', () => {
      const ch = { models: ['gpt-4o'], modelMapping: { 'gpt-4': 'gpt-4o' } };
      assert.equal(distributor.resolveModel('gpt-4', ch), 'gpt-4o');
    });

    it('returns model directly if channel has it', () => {
      const ch = { models: ['claude-3-opus'], modelMapping: {} };
      assert.equal(distributor.resolveModel('claude-3-opus', ch), 'claude-3-opus');
    });
  });

  describe('429 rate limiting', () => {
    it('tracks and checks rate limits', () => {
      assert.equal(distributor.isRateLimited(99), false);
      distributor.record429(99);
      assert.equal(distributor.isRateLimited(99), true);
      distributor.clear429(99);
      assert.equal(distributor.isRateLimited(99), false);
    });
  });

  describe('latency tracking', () => {
    it('records and retrieves latency', () => {
      distributor.recordLatency(88, 500);
      distributor.recordLatency(88, 1000);
      const avg = distributor.getLatency(88);
      assert.equal(avg, 750);
    });
  });

  describe('getRoutingStats', () => {
    it('returns stats object', () => {
      const stats = distributor.getRoutingStats();
      assert.ok('latencies' in stats);
      assert.ok('rateLimits' in stats);
      assert.ok('stickySessions' in stats);
    });
  });
});
