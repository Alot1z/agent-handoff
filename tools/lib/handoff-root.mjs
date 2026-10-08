// tools/lib/handoff-root.mjs — ONE definition of where handoffs are stored.
//
// Every tool that writes handoffs (tools/handoff.mjs, tools/agent-handoff.mjs)
// resolves its root through this module, so the precedence below has exactly one
// implementation:
//
//   1. HANDOFFS_ROOT ................... explicit environment override; always wins,
//                                        which is what keeps the test suite hermetic.
//   2. handoff.config.json ............. a project config found by walking up from cwd.
//                                        storage.path beats handoff_dir; a relative
//                                        handoff_dir resolves against the config's own
//                                        directory, so a config is location-independent.
//   3. <dir>/handoffs/ ................. zero-config project-local convention.
//   4. the skill directory ............. the default store. With no env var, no config
//                                        and no handoffs/ directory, this is unreachable
//                                        as a behaviour change: it is what the engine
//                                        did before this module existed.
//
// The walk is bounded and stops at the filesystem root. A config file that is present
// but invalid fails the run (exit 2) rather than being ignored: silently falling back
// would send a session's handoff to a different store than the one the user asked for.
//
// Zero dependency (node:* only, Node 18+).
import fs from 'node:fs';
import path from 'node:path';

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
export const SKILL_ROOT = path.resolve(HERE, '..', '..'); // tools/lib -> tools -> skill root

export const CONFIG_NAME = 'handoff.config.json';
export const SCHEMA_NAME = 'handoff.config.schema.json';
export const DEFAULT_HANDOFF_DIR = 'handoffs';
const MAX_WALK = 10;

export class ConfigError extends Error {
  constructor(message) { super(message); this.name = 'ConfigError'; this.code = 'CONFIG_INVALID'; }
}

export function schemaPath() { return path.join(SKILL_ROOT, SCHEMA_NAME); }

export function loadSchema() {
  const p = schemaPath();
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { throw new ConfigError(SCHEMA_NAME + ' is not valid JSON: ' + e.message); }
}

// A small validator for the keyword set this schema actually uses (type, enum,
// minimum/maximum, minLength, items, properties, additionalProperties, required).
// It is deliberately not a general JSON-Schema engine: it validates exactly the
// shipped schema, and the test suite checks the shipped example against it.
// JSON Schema type names, not JS typeof: `integer` is a number with no fractional part,
// and `object` excludes arrays (which typeof would call "object").
function typeOf(v) {
  if (Array.isArray(v)) return 'array';
  if (v === null) return 'null';
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
  return typeof v; // string | boolean | object
}
function matchesType(v, t) {
  if (t === 'number') return typeof v === 'number';
  if (t === 'object') return v !== null && typeof v === 'object' && !Array.isArray(v);
  return typeOf(v) === t;
}
function validateNode(value, spec, at, errors) {
  if (!spec || typeof spec !== 'object') return;
  const types = spec.type ? (Array.isArray(spec.type) ? spec.type : [spec.type]) : null;
  if (types && !types.some(t => matchesType(value, t))) {
    errors.push(at + ': expected ' + types.join('|') + ', got ' + typeOf(value));
    return;
  }
  if (spec.enum && !spec.enum.includes(value)) errors.push(at + ': must be one of ' + JSON.stringify(spec.enum) + ', got ' + JSON.stringify(value));
  if (typeof value === 'number') {
    if (typeof spec.minimum === 'number' && value < spec.minimum) errors.push(at + ': ' + value + ' is below minimum ' + spec.minimum);
    if (typeof spec.maximum === 'number' && value > spec.maximum) errors.push(at + ': ' + value + ' is above maximum ' + spec.maximum);
  }
  if (typeof value === 'string' && typeof spec.minLength === 'number' && value.length < spec.minLength) {
    errors.push(at + ': must be at least ' + spec.minLength + ' character(s)');
  }
  if (Array.isArray(value) && spec.items) value.forEach((v, i) => validateNode(v, spec.items, at + '[' + i + ']', errors));
  if (typeOf(value) === 'object' && value !== null) {
    const props = spec.properties || {};
    for (const req of Array.isArray(spec.required) ? spec.required : []) {
      if (!(req in value)) errors.push(at + ': missing required key "' + req + '"');
    }
    for (const [k, v] of Object.entries(value)) {
      if (props[k]) validateNode(v, props[k], at + '.' + k, errors);
      else if (spec.additionalProperties === false) errors.push(at + ': unknown key "' + k + '"');
    }
    for (const k of Object.keys(props)) {
      if (!(k in value) && props[k] && props[k].required) errors.push(at + ': missing required key "' + k + '"');
    }
  }
}

export function validateConfig(config, schema) {
  const errors = [];
  if (!schema) return errors;
  validateNode(config, schema, CONFIG_NAME, errors);
  return errors;
}

function readConfig(p) {
  let raw;
  try { raw = JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (e) { throw new ConfigError('cannot parse ' + p + ': ' + e.message); }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new ConfigError(p + ' must contain a JSON object');
  return raw;
}

function declaredDir(config) {
  if (config.storage && typeof config.storage.path === 'string' && config.storage.path) return config.storage.path;
  if (typeof config.handoff_dir === 'string' && config.handoff_dir) return config.handoff_dir;
  return null;
}

// Returns { root, source, configPath, config, schemaPath }.
// source is one of: env | config | discover | default.
export function resolveRoot(opts = {}) {
  const cwd = path.resolve(opts.cwd || process.cwd());

  if (process.env.HANDOFFS_ROOT) {
    return { root: path.resolve(process.env.HANDOFFS_ROOT), source: 'env', configPath: null, config: null, schemaPath: schemaPath() };
  }

  const schema = loadSchema();
  let foundConfig = null;   // a config that pins no directory: still useful for other options
  let foundConfigPath = null;
  let dir = cwd;
  for (let i = 0; i <= MAX_WALK; i++) {
    const cfgPath = path.join(dir, CONFIG_NAME);
    if (fs.existsSync(cfgPath)) {
      const config = readConfig(cfgPath);
      const errors = validateConfig(config, schema);
      if (errors.length) throw new ConfigError(cfgPath + ' is invalid against ' + SCHEMA_NAME + ':\n  - ' + errors.join('\n  - '));
      const declared = declaredDir(config);
      if (declared) return { root: path.resolve(dir, declared), source: 'config', configPath: cfgPath, config, schemaPath: schemaPath() };
      foundConfig = config;
      foundConfigPath = cfgPath;
    }
    const hd = path.join(dir, DEFAULT_HANDOFF_DIR);
    try {
      if (fs.statSync(hd).isDirectory()) {
        return { root: hd, source: 'discover', configPath: foundConfigPath, config: foundConfig, schemaPath: schemaPath() };
      }
    } catch { /* not a directory: keep walking */ }
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return { root: SKILL_ROOT, source: 'default', configPath: foundConfigPath, config: foundConfig, schemaPath: schemaPath() };
}

// HONOURED options, read from whichever config was found (env roots carry none).
export function configProjectName(res) {
  const n = res && res.config && res.config.project_name;
  return typeof n === 'string' && n.trim() ? n.trim() : null;
}
export function linkingEnabled(res) {
  const l = res && res.config && res.config.linking;
  return !(l && l.enabled === false);
}
