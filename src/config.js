const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '..', 'data', 'config.json');
const EXAMPLE_PATH = path.join(__dirname, '..', 'config.example.json');

let _config = null;
let _modelIndex = new Map(); // model -> [{channel, actualModel}]
let _aliasReverse = new Map(); // variant -> canonical

function load() {
  if (!fs.existsSync(CONFIG_PATH)) {
    const dir = path.dirname(CONFIG_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (fs.existsSync(EXAMPLE_PATH)) {
      fs.copyFileSync(EXAMPLE_PATH, CONFIG_PATH);
      console.log('[config] Created config.json from example');
    } else {
      throw new Error('No config.json or config.example.json found');
    }
  }
  const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
  _config = JSON.parse(raw);
  _validateConfig(_config);
  _buildModelIndex();
  console.log(`[config] Loaded ${_config.channels.length} channels, ${_modelIndex.size} models`);
  return _config;
}

function _validateConfig(c) {
  if (!c.server) throw new Error('config: missing "server"');
  if (!c.server.port) c.server.port = 3000;
  if (!c.server.adminToken) throw new Error('config: missing "server.adminToken"');
  if (!Array.isArray(c.server.apiKeys) || !c.server.apiKeys.length) throw new Error('config: missing "server.apiKeys"');
  if (!c.relay) c.relay = {};
  c.relay.timeout = c.relay.timeout || 60000;
  c.relay.retryTimes = c.relay.retryTimes ?? 2;
  c.relay.retryOnStatusCodes = c.relay.retryOnStatusCodes || [429, 500, 502, 503];
  if (!c.detect) c.detect = { mode: 'quick', autoOnAdd: true };
  if (!c.modelAliases) c.modelAliases = {};
  if (!Array.isArray(c.channels)) c.channels = [];
  let maxId = 0;
  for (const ch of c.channels) {
    if (!ch.id) throw new Error(`config: channel missing "id"`);
    if (!ch.endpoint) throw new Error(`config: channel ${ch.id} missing "endpoint"`);
    if (!Array.isArray(ch.keys) || !ch.keys.length) throw new Error(`config: channel ${ch.id} missing "keys"`);
    if (!Array.isArray(ch.models)) ch.models = [];
    ch.type = ch.type || 'openai';
    ch.weight = ch.weight ?? 10;
    ch.priority = ch.priority ?? 0;
    ch.status = ch.status || 'enabled';
    ch.modelMapping = ch.modelMapping || {};
    if (!Array.isArray(ch.disabledModels)) ch.disabledModels = [];
    ch._keyIndex = 0;
    if (ch.id > maxId) maxId = ch.id;
  }
  c._nextId = maxId + 1;
}

function _buildAliasReverse() {
  _aliasReverse.clear();
  const aliases = _config.modelAliases || {};
  for (const [canonical, variants] of Object.entries(aliases)) {
    for (const v of variants) {
      _aliasReverse.set(v, canonical);
    }
  }
}

function _buildModelIndex() {
  _modelIndex.clear();
  _buildAliasReverse();
  for (const ch of _config.channels) {
    if (ch.status !== 'enabled') continue;
    const disabled = new Set(ch.disabledModels || []);
    for (const model of ch.models) {
      // Resolve to canonical name via alias
      const canonical = _aliasReverse.get(model) || model;
      if (disabled.has(canonical) || disabled.has(model)) continue;
      if (!_modelIndex.has(canonical)) _modelIndex.set(canonical, []);
      const list = _modelIndex.get(canonical);
      if (!list.includes(ch)) list.push(ch);
    }
    // Also index reverse model mappings (external name -> channel)
    for (const [externalName] of Object.entries(ch.modelMapping)) {
      const canonical = _aliasReverse.get(externalName) || externalName;
      if (disabled.has(canonical) || disabled.has(externalName)) continue;
      if (!_modelIndex.has(canonical)) _modelIndex.set(canonical, []);
      const existing = _modelIndex.get(canonical);
      if (!existing.includes(ch)) existing.push(ch);
    }
  }
}

function get() { return _config; }
function getModelIndex() { return _modelIndex; }

function save() {
  const dir = path.dirname(CONFIG_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const toSave = JSON.parse(JSON.stringify(_config));
  // Strip runtime fields
  for (const ch of toSave.channels) { delete ch._keyIndex; }
  delete toSave._nextId;
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(toSave, null, 2), 'utf8');
}

function addChannel(ch) {
  ch.id = _config._nextId++;
  ch.type = ch.type || 'openai';
  ch.weight = ch.weight ?? 10;
  ch.priority = ch.priority ?? 0;
  ch.status = ch.status || 'enabled';
  ch.modelMapping = ch.modelMapping || {};
  if (!Array.isArray(ch.disabledModels)) ch.disabledModels = [];
  ch._keyIndex = 0;
  _config.channels.push(ch);
  _buildModelIndex();
  save();
  return ch;
}

function updateChannel(id, updates) {
  const ch = _config.channels.find(c => c.id === id);
  if (!ch) return null;
  Object.assign(ch, updates);
  ch.id = id; // prevent id overwrite
  _buildModelIndex();
  save();
  return ch;
}

function deleteChannel(id) {
  const idx = _config.channels.findIndex(c => c.id === id);
  if (idx === -1) return false;
  _config.channels.splice(idx, 1);
  _buildModelIndex();
  save();
  return true;
}

function getChannel(id) {
  return _config.channels.find(c => c.id === id) || null;
}

function getAllChannels() {
  return _config.channels;
}

function getAllModels() {
  return [..._modelIndex.keys()].sort();
}

function getAliasReverse() { return _aliasReverse; }

module.exports = { load, get, save, getModelIndex, getAliasReverse, addChannel, updateChannel, deleteChannel, getChannel, getAllChannels, getAllModels };
