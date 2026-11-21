// Package i18n holds Kempt's message catalog: one flat JSON file per
// language (locales/en.json, locales/id.json) in i18next v4 style, shared by
// the Go side and the window. Placeholders are {{name}}; plural forms are
// separate keys with the CLDR suffixes _one and _other.
package i18n

import (
	"embed"
	"encoding/json"
	"fmt"
	"io/fs"
	"regexp"
	"strconv"
	"strings"
	"sync"
)

//go:embed locales/*.json
var files embed.FS

// Languages Kempt ships, in menu order. The first is the fallback.
var Languages = []string{"en", "id"}

var (
	once     sync.Once
	catalogs map[string]map[string]string
)

func load() {
	catalogs = map[string]map[string]string{}
	for _, l := range Languages {
		b, err := fs.ReadFile(files, "locales/"+l+".json")
		if err != nil {
			panic(err)
		}
		m := map[string]string{}
		if err := json.Unmarshal(b, &m); err != nil {
			panic(fmt.Sprintf("i18n: locales/%s.json: %v", l, err))
		}
		catalogs[l] = m
	}
}

// Catalog returns the raw JSON of one language, for the window.
func Catalog(lang string) ([]byte, bool) {
	b, err := fs.ReadFile(files, "locales/"+Normalize(lang)+".json")
	return b, err == nil
}

// Normalize maps a language tag (id-ID, in, en-GB, "") to a shipped language.
func Normalize(tag string) string {
	t := strings.ToLower(strings.TrimSpace(tag))
	if i := strings.IndexAny(t, "-_;,"); i >= 0 {
		t = t[:i]
	}
	if t == "in" { // the old ISO code Java and Android still use
		t = "id"
	}
	for _, l := range Languages {
		if l == t {
			return l
		}
	}
	return Languages[0]
}

// FromAcceptLanguage picks a shipped language from an Accept-Language header.
func FromAcceptLanguage(h string) string {
	for _, part := range strings.Split(h, ",") {
		t := strings.TrimSpace(strings.SplitN(part, ";", 2)[0])
		n := Normalize(t)
		if n != Languages[0] || strings.HasPrefix(strings.ToLower(t), Languages[0]) {
			return n
		}
	}
	return Languages[0]
}

// Has reports whether the English catalog defines key.
func Has(key string) bool {
	once.Do(load)
	_, ok := catalogs["en"][key]
	return ok
}

func lookup(lang, key string) string {
	once.Do(load)
	if s, ok := catalogs[Normalize(lang)][key]; ok {
		return s
	}
	if s, ok := catalogs[Languages[0]][key]; ok {
		return s
	}
	return key
}

// T returns the message for key with {{name}} placeholders filled from vars,
// given as name, value pairs.
func T(lang, key string, vars ...any) string {
	return fill(lookup(lang, key), vars)
}

// N is T for a message that depends on a count: it picks key_one or
// key_other for the language and sets {{count}}.
func N(lang, key string, count int64, vars ...any) string {
	suffix := "_other"
	if pluralOne(Normalize(lang), count) {
		suffix = "_one"
	}
	s := lookup(lang, key+suffix)
	if s == key+suffix && suffix == "_one" {
		s = lookup(lang, key+"_other")
	}
	return fill(s, append([]any{"count", Number(lang, count)}, vars...))
}

// pluralOne follows CLDR: English has one/other, Indonesian only other.
func pluralOne(lang string, n int64) bool {
	return lang == "en" && n == 1
}

var holder = regexp.MustCompile(`\{\{(\w+)\}\}`)

// fill replaces each {{name}} once, in a single pass, so a value that itself
// contains {{...}} is never filled in again.
func fill(s string, vars []any) string {
	if !strings.Contains(s, "{{") {
		return s
	}
	vals := map[string]string{}
	for i := 0; i+1 < len(vars); i += 2 {
		if name, ok := vars[i].(string); ok {
			vals[name] = fmt.Sprint(vars[i+1])
		}
	}
	return holder.ReplaceAllStringFunc(s, func(m string) string {
		if v, ok := vals[m[2:len(m)-2]]; ok {
			return v
		}
		return m
	})
}

// Number formats an integer with the language's thousands separator.
func Number(lang string, n int64) string {
	s := strconv.FormatInt(n, 10)
	neg := strings.HasPrefix(s, "-")
	s = strings.TrimPrefix(s, "-")
	sep := ","
	if Normalize(lang) == "id" {
		sep = "."
	}
	var b strings.Builder
	for i, c := range s {
		if i > 0 && (len(s)-i)%3 == 0 {
			b.WriteString(sep)
		}
		b.WriteRune(c)
	}
	if neg {
		return "-" + b.String()
	}
	return b.String()
}

// Bytes formats a size: whole KB and MB, one decimal for GB and TB, with
// the language's decimal mark (1.5 GB, 1,5 GB) and a space before the unit.
func Bytes(lang string, b int64) string {
	units := []struct {
		name string
		size float64
	}{{"TB", 1 << 40}, {"GB", 1 << 30}, {"MB", 1 << 20}, {"KB", 1 << 10}}
	for _, u := range units {
		if float64(b) >= u.size {
			x := float64(b) / u.size
			var s string
			if u.name == "GB" || u.name == "TB" {
				s = strconv.FormatFloat(x, 'f', 1, 64)
				if Normalize(lang) == "id" {
					s = strings.Replace(s, ".", ",", 1)
				}
			} else {
				s = Number(lang, int64(x+0.5))
			}
			return s + " " + u.name
		}
	}
	if b == 0 {
		return "0 MB"
	}
	return "1 KB"
}

// Percent formats a whole percentage (no space, as in both languages).
func Percent(p float64) string { return strconv.Itoa(int(p+0.5)) + "%" }

// List joins items: "a, b and c" / "a, b, dan c".
func List(lang string, items []string) string {
	switch len(items) {
	case 0:
		return ""
	case 1:
		return items[0]
	}
	and := T(lang, "list.and")
	if Normalize(lang) == "id" && len(items) > 2 {
		return strings.Join(items[:len(items)-1], ", ") + ", " + and + " " + items[len(items)-1]
	}
	return strings.Join(items[:len(items)-1], ", ") + " " + and + " " + items[len(items)-1]
}

// Msg is a message stored for later, such as a history entry, so it can be
// shown in whichever language is chosen when it is read.
//
// Arg values are kept as text. A value "@key" is itself a message key and is
// translated when shown; "#bytes:N" is a size; "#n:N" a number.
type Msg struct {
	Key   string            `json:"key"`
	Count *int64            `json:"count,omitempty"`
	Args  map[string]string `json:"args,omitempty"`
}

// M builds a Msg from name, value pairs.
func M(key string, vars ...string) Msg {
	m := Msg{Key: key}
	if len(vars) > 1 {
		m.Args = map[string]string{}
		for i := 0; i+1 < len(vars); i += 2 {
			m.Args[vars[i]] = vars[i+1]
		}
	}
	return m
}

// MN builds a Msg that depends on a count.
func MN(key string, count int64, vars ...string) Msg {
	m := M(key, vars...)
	m.Count = &count
	return m
}

// Ref marks a value as a message key to translate when shown.
func Ref(key string) string { return "@" + key }

// SizeArg marks a value as a size in bytes.
func SizeArg(b int64) string { return "#bytes:" + strconv.FormatInt(b, 10) }

// Render shows a stored message in a language. Plain values are filled in
// first; a value that is itself a message ("@key") is translated with those
// plain values, so "Cache {{browser}}" gets its browser name.
func Render(lang string, m Msg) string {
	var plain, refs []any
	for k, v := range m.Args {
		switch {
		case strings.HasPrefix(v, "@"):
			refs = append(refs, k, v[1:])
		case strings.HasPrefix(v, "#bytes:"):
			n, _ := strconv.ParseInt(v[len("#bytes:"):], 10, 64)
			plain = append(plain, k, Bytes(lang, n))
		case strings.HasPrefix(v, "#n:"):
			n, _ := strconv.ParseInt(v[len("#n:"):], 10, 64)
			plain = append(plain, k, Number(lang, n))
		default:
			plain = append(plain, k, v)
		}
	}
	vars := append([]any{}, plain...)
	for i := 0; i+1 < len(refs); i += 2 {
		vars = append(vars, refs[i], T(lang, refs[i+1].(string), plain...))
	}
	if m.Count != nil {
		return N(lang, m.Key, *m.Count, vars...)
	}
	return T(lang, m.Key, vars...)
}
