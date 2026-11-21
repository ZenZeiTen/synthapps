package i18n

import (
	"encoding/json"
	"regexp"
	"sort"
	"strings"
	"testing"
)

func catalog(t *testing.T, lang string) map[string]string {
	t.Helper()
	b, ok := Catalog(lang)
	if !ok {
		t.Fatalf("no catalog for %s", lang)
	}
	m := map[string]string{}
	if err := json.Unmarshal(b, &m); err != nil {
		t.Fatalf("%s: %v", lang, err)
	}
	return m
}

var placeholder = regexp.MustCompile(`\{\{\w+\}\}`)

func holders(s string) []string {
	p := placeholder.FindAllString(s, -1)
	sort.Strings(p)
	return p
}

// Every English message has an Indonesian one with the same placeholders,
// and Indonesian has no keys English lacks. Indonesian has one plural form
// (CLDR), so key_one may be absent when key_other is there.
func TestCatalogsMatch(t *testing.T) {
	en, id := catalog(t, "en"), catalog(t, "id")
	for k, v := range en {
		tr, ok := id[k]
		if !ok {
			if strings.HasSuffix(k, "_one") {
				if _, other := id[strings.TrimSuffix(k, "_one")+"_other"]; other {
					continue
				}
			}
			t.Errorf("id.json lacks %q", k)
			continue
		}
		if strings.Join(holders(v), ",") != strings.Join(holders(tr), ",") {
			t.Errorf("%s: placeholders differ: en %v, id %v", k, holders(v), holders(tr))
		}
		if strings.TrimSpace(tr) == "" {
			t.Errorf("%s: empty translation", k)
		}
	}
	for k := range id {
		if _, ok := en[k]; !ok {
			t.Errorf("id.json has %q, which en.json lacks", k)
		}
		if strings.HasSuffix(k, "_one") {
			t.Errorf("%s: Indonesian has no 'one' plural form", k)
		}
	}
}

func TestFormatting(t *testing.T) {
	cases := []struct{ got, want string }{
		{Bytes("en", 1536<<20), "1.5 GB"},
		{Bytes("id", 1536<<20), "1,5 GB"},
		{Bytes("id", 300<<20), "300 MB"},
		{Bytes("id", 2048<<20*1000), "2,0 TB"},
		{Number("en", 1234567), "1,234,567"},
		{Number("id", 1234567), "1.234.567"},
		{N("en", "unit.day", 1), "1 day"},
		{N("en", "unit.day", 3), "3 days"},
		{N("id", "unit.day", 1), "1 hari"},
		{N("id", "unit.day", 3), "3 hari"},
		{List("en", []string{"a", "b", "c"}), "a, b and c"},
		{List("id", []string{"a", "b", "c"}), "a, b, dan c"},
		{List("id", []string{"a", "b"}), "a dan b"},
		{T("id", "no.such.key"), "no.such.key"},
	}
	for _, c := range cases {
		if c.got != c.want {
			t.Errorf("got %q, want %q", c.got, c.want)
		}
	}
}

func TestNormalize(t *testing.T) {
	for in, want := range map[string]string{"id-ID": "id", "in": "id", "ID": "id", "en-GB": "en", "": "en", "fr-FR": "en"} {
		if got := Normalize(in); got != want {
			t.Errorf("Normalize(%q) = %q, want %q", in, got, want)
		}
	}
	for in, want := range map[string]string{
		"id-ID,id;q=0.9,en-US;q=0.8": "id", "en-US,en;q=0.9,id;q=0.8": "en", "fr-FR,id;q=0.5": "id", "": "en",
	} {
		if got := FromAcceptLanguage(in); got != want {
			t.Errorf("FromAcceptLanguage(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestStoredMessages(t *testing.T) {
	m := MN("journal.recycle", 3, "size", SizeArg(1536<<20), "bin", Ref("word.recycleBin"))
	if got := Render("en", m); got != "Moved 3 files (1.5 GB) to the Recycle Bin" {
		t.Errorf("en: %q", got)
	}
	if got := Render("id", m); got != "3 file (1,5 GB) dipindahkan ke Keranjang Sampah" {
		t.Errorf("id: %q", got)
	}
	if got := Render("en", MN("journal.recycle", 1, "size", SizeArg(1<<20), "bin", Ref("word.trash"))); got != "Moved 1 file (1 MB) to the trash" {
		t.Errorf("en one: %q", got)
	}
}

// A stored argument can be a message with its own placeholders ("Cache
// {{browser}}"); it must be filled whatever order the arguments come in.
func TestStoredMessageWithNestedPlaceholder(t *testing.T) {
	m := MN("journal.clean.line", 1, "name", Ref("cat.browser.name"), "size", SizeArg(8<<20), "browser", "Firefox")
	for i := 0; i < 200; i++ { // map order is random: try many times
		if got := Render("id", m); got != "Cache Firefox: 8 MB, 1 file" {
			t.Fatalf("id: %q", got)
		}
		if got := Render("en", m); got != "Firefox cache: 8 MB, 1 file" {
			t.Fatalf("en: %q", got)
		}
	}
}

// A value containing {{...}} must not be filled in again.
func TestFillIsSinglePass(t *testing.T) {
	if got := T("en", "startup.willStart", "name", "{{name}}"); got != "{{name}} will start when you sign in." {
		t.Fatalf("%q", got)
	}
}
