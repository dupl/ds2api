package toolcall

import (
	"strings"
	"unicode/utf8"
)

func normalizeDSMLToolCallMarkup(text string) (string, bool) {
	if text == "" {
		return "", true
	}
	hasAliasLikeMarkup, _ := ContainsToolMarkupSyntaxOutsideIgnored(text)
	if !hasAliasLikeMarkup {
		return text, true
	}
	return rewriteDSMLToolMarkupOutsideIgnored(text), true
}

func rewriteDSMLToolMarkupOutsideIgnored(text string) string {
	if text == "" {
		return ""
	}
	var b strings.Builder
	b.Grow(len(text))
	for i := 0; i < len(text); {
		next, advanced, blocked := skipXMLIgnoredSection(text, i)
		if blocked {
			b.WriteString(text[i:])
			break
		}
		if advanced {
			b.WriteString(text[i:next])
			i = next
			continue
		}
		tag, ok := scanToolMarkupTagAt(text, i)
		if !ok {
			b.WriteByte(text[i])
			i++
			continue
		}
		if tag.DSMLLike {
			b.WriteByte('<')
			if tag.Closing {
				b.WriteByte('/')
			}
			b.WriteString(tag.Name)
			tail := normalizeToolMarkupTagTailForXML(text[tag.NameEnd : tag.End+1])
			b.WriteString(tail)
			if !strings.HasSuffix(tail, ">") {
				b.WriteByte('>')
			}
			i = tag.End + 1
			continue
		}
		b.WriteString(text[tag.Start : tag.End+1])
		i = tag.End + 1
	}
	return b.String()
}

func normalizeToolMarkupTagTailForXML(tail string) string {
	if tail == "" {
		return ""
	}
	var b strings.Builder
	b.Grow(len(tail))
	quote := rune(0)
	for i := 0; i < len(tail); {
		r, size := utf8.DecodeRuneInString(tail[i:])
		if r == utf8.RuneError && size == 1 {
			b.WriteByte(tail[i])
			i++
			continue
		}
		ch := normalizeFullwidthASCII(r)
		if quote != 0 {
			b.WriteRune(ch)
			if ch == quote {
				quote = 0
			}
			i += size
			continue
		}
		switch ch {
		case '"', '\'':
			quote = ch
			b.WriteRune(ch)
		case '|':
			j := i + size
			for j < len(tail) {
				next, nextSize := utf8.DecodeRuneInString(tail[j:])
				if nextSize <= 0 {
					break
				}
				if next == ' ' || next == '\t' || next == '\r' || next == '\n' {
					j += nextSize
					continue
				}
				break
			}
			next, _ := normalizedASCIIAt(tail, j)
			if next != '>' {
				b.WriteRune(ch)
			}
		case '>', '/', '=':
			b.WriteRune(ch)
		default:
			b.WriteString(tail[i : i+size])
		}
		i += size
	}
	return b.String()
}
