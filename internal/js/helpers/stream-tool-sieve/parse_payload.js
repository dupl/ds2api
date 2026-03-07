'use strict';

const TOOL_CALL_PATTERN = /\{\s*["']tool_calls["']\s*:\s*\[(.*?)\]\s*\}/s;
const TOOL_CALL_MARKUP_BLOCK_PATTERN = /<(?:[a-z0-9_:-]+:)?(tool_call|function_call|invoke)\b([^>]*)>([\s\S]*?)<\/(?:[a-z0-9_:-]+:)?\1>/gi;
const TOOL_CALL_MARKUP_SELFCLOSE_PATTERN = /<(?:[a-z0-9_:-]+:)?invoke\b([^>]*)\/>/gi;
const TOOL_CALL_MARKUP_NAME_TAG_PATTERN = /<(?:[a-z0-9_:-]+:)?(name|function)\b[^>]*>([\s\S]*?)<\/(?:[a-z0-9_:-]+:)?\1>/i;
const TOOL_CALL_MARKUP_ARGS_TAG_PATTERN = /<(?:[a-z0-9_:-]+:)?(input|arguments|argument|parameters|parameter|args|params)\b[^>]*>([\s\S]*?)<\/(?:[a-z0-9_:-]+:)?\1>/i;
const TOOL_CALL_MARKUP_KV_PATTERN = /<(?:[a-z0-9_:-]+:)?([a-z0-9_.-]+)\b[^>]*>([\s\S]*?)<\/(?:[a-z0-9_:-]+:)?\1>/gi;
const TOOL_CALL_MARKUP_ATTR_PATTERN = /(name|function|tool)\s*=\s*"([^"]+)"/i;

const {
  toStringSafe,
} = require('./state');
const {
  extractJSONObjectFrom,
} = require('./jsonscan');

function stripFencedCodeBlocks(text) {
  const t = typeof text === 'string' ? text : '';
  if (!t) {
    return '';
  }
  return t.replace(/```[\s\S]*?```/g, ' ');
}

function buildToolCallCandidates(text) {
  const trimmed = toStringSafe(text);
  const candidates = [trimmed];

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/gi) || [];
  for (const block of fenced) {
    const m = block.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (m && m[1]) {
      candidates.push(toStringSafe(m[1]));
    }
  }

  for (const candidate of extractToolCallObjects(trimmed)) {
    candidates.push(toStringSafe(candidate));
  }

  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first >= 0 && last > first) {
    candidates.push(toStringSafe(trimmed.slice(first, last + 1)));
  }

  const m = trimmed.match(TOOL_CALL_PATTERN);
  if (m && m[1]) {
    candidates.push(`{"tool_calls":[${m[1]}]}`);
  }

  return [...new Set(candidates.filter(Boolean))];
}

function extractToolCallObjects(text) {
  const raw = toStringSafe(text);
  if (!raw) {
    return [];
  }
  const lower = raw.toLowerCase();
  const out = [];
  let offset = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    let idx = lower.indexOf('tool_calls', offset);
    if (idx < 0) {
      break;
    }
    let start = raw.slice(0, idx).lastIndexOf('{');
    while (start >= 0) {
      const obj = extractJSONObjectFrom(raw, start);
      if (obj.ok) {
        out.push(raw.slice(start, obj.end).trim());
        offset = obj.end;
        idx = -1;
        break;
      }
      start = raw.slice(0, start).lastIndexOf('{');
    }
    if (idx >= 0) {
      offset = idx + 'tool_calls'.length;
    }
  }

  return out;
}

function parseToolCallsPayload(payload) {
  let decoded;
  try {
    decoded = JSON.parse(payload);
  } catch (_err) {
    return [];
  }

  if (Array.isArray(decoded)) {
    return parseToolCallList(decoded);
  }
  if (!decoded || typeof decoded !== 'object') {
    return [];
  }
  if (decoded.tool_calls) {
    return parseToolCallList(decoded.tool_calls);
  }

  const one = parseToolCallItem(decoded);
  return one ? [one] : [];
}

function parseMarkupToolCalls(text) {
  const raw = toStringSafe(text).trim();
  if (!raw) {
    return [];
  }
  const out = [];
  for (const m of raw.matchAll(TOOL_CALL_MARKUP_BLOCK_PATTERN)) {
    const parsed = parseMarkupSingleToolCall(toStringSafe(m[2]).trim(), toStringSafe(m[3]).trim());
    if (parsed) {
      out.push(parsed);
    }
  }
  for (const m of raw.matchAll(TOOL_CALL_MARKUP_SELFCLOSE_PATTERN)) {
    const parsed = parseMarkupSingleToolCall(toStringSafe(m[1]).trim(), '');
    if (parsed) {
      out.push(parsed);
    }
  }
  return out;
}

function parseMarkupSingleToolCall(attrs, inner) {
  const embedded = parseToolCallsPayload(inner);
  if (embedded.length > 0) {
    return embedded[0];
  }
  let name = '';
  const attrMatch = attrs.match(TOOL_CALL_MARKUP_ATTR_PATTERN);
  if (attrMatch && attrMatch[2]) {
    name = toStringSafe(attrMatch[2]).trim();
  }
  if (!name) {
    const m = inner.match(TOOL_CALL_MARKUP_NAME_TAG_PATTERN);
    if (m && m[2]) {
      name = stripTagText(m[2]);
    }
  }
  if (!name) {
    return null;
  }

  let input = {};
  const argsMatch = inner.match(TOOL_CALL_MARKUP_ARGS_TAG_PATTERN);
  if (argsMatch && argsMatch[2]) {
    input = parseMarkupInput(argsMatch[2]);
  } else {
    const kv = parseMarkupKVObject(inner);
    if (Object.keys(kv).length > 0) {
      input = kv;
    }
  }
  return { name, input };
}

function parseMarkupInput(raw) {
  const s = toStringSafe(raw).trim();
  if (!s) {
    return {};
  }
  const parsed = parseToolCallInput(s);
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && Object.keys(parsed).length > 0) {
    return parsed;
  }
  const kv = parseMarkupKVObject(s);
  if (Object.keys(kv).length > 0) {
    return kv;
  }
  return { _raw: stripTagText(s) };
}

function parseMarkupKVObject(text) {
  const raw = toStringSafe(text).trim();
  if (!raw) {
    return {};
  }
  const out = {};
  for (const m of raw.matchAll(TOOL_CALL_MARKUP_KV_PATTERN)) {
    const key = toStringSafe(m[1]).trim();
    if (!key) {
      continue;
    }
    const valueRaw = stripTagText(m[2]);
    if (!valueRaw) {
      continue;
    }
    try {
      out[key] = JSON.parse(valueRaw);
    } catch (_err) {
      out[key] = valueRaw;
    }
  }
  return out;
}

function stripTagText(text) {
  return toStringSafe(text).replace(/<[^>]+>/g, ' ').trim();
}

function parseToolCallList(v) {
  if (!Array.isArray(v)) {
    return [];
  }
  const out = [];
  for (const item of v) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const one = parseToolCallItem(item);
    if (one) {
      out.push(one);
    }
  }
  return out;
}

function parseToolCallItem(m) {
  let name = toStringSafe(m.name);
  let inputRaw = m.input;
  let hasInput = Object.prototype.hasOwnProperty.call(m, 'input');
  const fn = m.function && typeof m.function === 'object' ? m.function : null;

  if (fn) {
    if (!name) {
      name = toStringSafe(fn.name);
    }
    if (!hasInput && Object.prototype.hasOwnProperty.call(fn, 'arguments')) {
      inputRaw = fn.arguments;
      hasInput = true;
    }
  }

  if (!hasInput) {
    for (const k of ['arguments', 'args', 'parameters', 'params']) {
      if (Object.prototype.hasOwnProperty.call(m, k)) {
        inputRaw = m[k];
        hasInput = true;
        break;
      }
    }
  }

  if (!name) {
    return null;
  }

  return {
    name,
    input: parseToolCallInput(inputRaw),
  };
}

function parseToolCallInput(v) {
  if (v == null) {
    return {};
  }
  if (typeof v === 'string') {
    const raw = toStringSafe(v);
    if (!raw) {
      return {};
    }
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed;
      }
      return { _raw: raw };
    } catch (_err) {
      return { _raw: raw };
    }
  }
  if (typeof v === 'object' && !Array.isArray(v)) {
    return v;
  }
  try {
    const parsed = JSON.parse(JSON.stringify(v));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed;
    }
  } catch (_err) {
    return {};
  }
  return {};
}

module.exports = {
  stripFencedCodeBlocks,
  buildToolCallCandidates,
  parseToolCallsPayload,
  parseMarkupToolCalls,
};
