package util

import (
	"encoding/json"
	"regexp"
	"strings"
)

var toolCallMarkupTagNames = []string{"tool_call", "function_call", "invoke"}
var toolCallMarkupTagPatternByName = map[string]*regexp.Regexp{
	"tool_call":     regexp.MustCompile(`(?is)<(?:[a-z0-9_:-]+:)?tool_call\b([^>]*)>(.*?)</(?:[a-z0-9_:-]+:)?tool_call>`),
	"function_call": regexp.MustCompile(`(?is)<(?:[a-z0-9_:-]+:)?function_call\b([^>]*)>(.*?)</(?:[a-z0-9_:-]+:)?function_call>`),
	"invoke":        regexp.MustCompile(`(?is)<(?:[a-z0-9_:-]+:)?invoke\b([^>]*)>(.*?)</(?:[a-z0-9_:-]+:)?invoke>`),
}
var toolCallMarkupSelfClosingPattern = regexp.MustCompile(`(?is)<(?:[a-z0-9_:-]+:)?invoke\b([^>]*)/>`)
var toolCallMarkupNameTagPattern = regexp.MustCompile(`(?is)<(?:[a-z0-9_:-]+:)?(?:name|function)\b[^>]*>(.*?)</(?:[a-z0-9_:-]+:)?(?:name|function)>`)
var toolCallMarkupArgsTagPattern = regexp.MustCompile(`(?is)<(?:[a-z0-9_:-]+:)?(?:input|arguments|argument|parameters|parameter|args|params)\b[^>]*>(.*?)</(?:[a-z0-9_:-]+:)?(?:input|arguments|argument|parameters|parameter|args|params)>`)
var toolCallMarkupKVPattern = regexp.MustCompile(`(?is)<(?:[a-z0-9_:-]+:)?([a-z0-9_\-.]+)\b[^>]*>(.*?)</(?:[a-z0-9_:-]+:)?([a-z0-9_\-.]+)>`)
var toolCallMarkupAttrPattern = regexp.MustCompile(`(?is)(name|function|tool)\s*=\s*"([^"]+)"`)
var anyTagPattern = regexp.MustCompile(`(?is)<[^>]+>`)

func parseMarkupToolCalls(text string) []ParsedToolCall {
	trimmed := strings.TrimSpace(text)
	if trimmed == "" {
		return nil
	}

	out := make([]ParsedToolCall, 0)
	for _, tagName := range toolCallMarkupTagNames {
		pattern := toolCallMarkupTagPatternByName[tagName]
		for _, m := range pattern.FindAllStringSubmatch(trimmed, -1) {
			if len(m) < 3 {
				continue
			}
			attrs := strings.TrimSpace(m[1])
			inner := strings.TrimSpace(m[2])
			if parsed := parseMarkupSingleToolCall(attrs, inner); parsed.Name != "" {
				out = append(out, parsed)
			}
		}
	}
	for _, m := range toolCallMarkupSelfClosingPattern.FindAllStringSubmatch(trimmed, -1) {
		if len(m) < 2 {
			continue
		}
		if parsed := parseMarkupSingleToolCall(strings.TrimSpace(m[1]), ""); parsed.Name != "" {
			out = append(out, parsed)
		}
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func parseMarkupSingleToolCall(attrs string, inner string) ParsedToolCall {
	if parsed := parseToolCallsPayload(inner); len(parsed) > 0 {
		return parsed[0]
	}

	name := ""
	if m := toolCallMarkupAttrPattern.FindStringSubmatch(attrs); len(m) >= 3 {
		name = strings.TrimSpace(m[2])
	}
	if name == "" {
		if m := toolCallMarkupNameTagPattern.FindStringSubmatch(inner); len(m) >= 2 {
			name = strings.TrimSpace(stripTagText(m[1]))
		}
	}
	if name == "" {
		return ParsedToolCall{}
	}

	input := map[string]any{}
	if m := toolCallMarkupArgsTagPattern.FindStringSubmatch(inner); len(m) >= 2 {
		input = parseMarkupInput(m[1])
	} else if kv := parseMarkupKVObject(inner); len(kv) > 0 {
		input = kv
	}
	return ParsedToolCall{Name: name, Input: input}
}

func parseMarkupInput(raw string) map[string]any {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return map[string]any{}
	}
	if parsed := parseToolCallInput(raw); len(parsed) > 0 {
		return parsed
	}
	if kv := parseMarkupKVObject(raw); len(kv) > 0 {
		return kv
	}
	return map[string]any{"_raw": stripTagText(raw)}
}

func parseMarkupKVObject(text string) map[string]any {
	matches := toolCallMarkupKVPattern.FindAllStringSubmatch(strings.TrimSpace(text), -1)
	if len(matches) == 0 {
		return nil
	}
	out := map[string]any{}
	for _, m := range matches {
		if len(m) < 4 {
			continue
		}
		key := strings.TrimSpace(m[1])
		endKey := strings.TrimSpace(m[3])
		if key == "" {
			continue
		}
		if !strings.EqualFold(key, endKey) {
			continue
		}
		value := strings.TrimSpace(stripTagText(m[2]))
		if value == "" {
			continue
		}
		var jsonValue any
		if json.Unmarshal([]byte(value), &jsonValue) == nil {
			out[key] = jsonValue
			continue
		}
		out[key] = value
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func stripTagText(text string) string {
	return strings.TrimSpace(anyTagPattern.ReplaceAllString(text, ""))
}
