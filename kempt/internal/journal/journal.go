// Package journal keeps a record of everything Kempt changed, newest last,
// in a JSON Lines file. Startup and privacy changes record how to undo them.
package journal

import (
	"bufio"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/ZenZeiTen/synthapps/kempt/internal/i18n"
)

// Undo says how to reverse an entry.
type Undo struct {
	Kind  string `json:"kind"` // "startup" or "privacy"
	ID    string `json:"id"`
	Value bool   `json:"value"` // the state to go back to
}

// Entry is one thing Kempt did.
type Entry struct {
	ID      string    `json:"id"`
	Time    time.Time `json:"time"`
	Kind    string    `json:"kind"` // clean, recycle, startup, privacy, update, schedule, repair, undo
	Summary string    `json:"summary"`
	Bytes   int64     `json:"bytes,omitempty"`
	Auto    bool      `json:"auto,omitempty"` // done by automatic care
	Details []string  `json:"details,omitempty"`
	Undo    *Undo     `json:"undo,omitempty"`
	// Msg and Lines are Summary and Details as message keys, so the entry
	// can be shown in whichever language is chosen when it is read.
	// Summary and Details keep the English text for older readers.
	Msg    *i18n.Msg  `json:"msg,omitempty"`
	Lines  []i18n.Msg `json:"lines,omitempty"`
	Undoes string     `json:"undoes,omitempty"` // for kind "undo": the entry reversed
	Undone bool       `json:"undone,omitempty"` // filled in by List
}

// Journal is the file.
type Journal struct {
	mu   sync.Mutex
	path string
}

// Open uses dir/journal.jsonl.
func Open(dir string) *Journal { return &Journal{path: filepath.Join(dir, "journal.jsonl")} }

// Add appends an entry and returns it with its id and time set.
func (j *Journal) Add(e Entry) (Entry, error) {
	j.mu.Lock()
	defer j.mu.Unlock()
	if e.ID == "" {
		b := make([]byte, 6)
		rand.Read(b)
		e.ID = hex.EncodeToString(b)
	}
	if e.Time.IsZero() {
		e.Time = time.Now().UTC()
	}
	if len(e.Details) > 50 {
		e.Details = append(e.Details[:50], "…")
	}
	if len(e.Lines) > 50 {
		e.Lines = e.Lines[:50]
	}
	if e.Msg != nil && e.Summary == "" {
		e.Summary = i18n.Render("en", *e.Msg)
	}
	if len(e.Lines) > 0 && len(e.Details) == 0 {
		for _, l := range e.Lines {
			e.Details = append(e.Details, i18n.Render("en", l))
		}
	}
	b, err := json.Marshal(e)
	if err != nil {
		return e, err
	}
	if err := os.MkdirAll(filepath.Dir(j.path), 0o700); err != nil {
		return e, err
	}
	f, err := os.OpenFile(j.path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return e, err
	}
	defer f.Close()
	// If a crash left half a line, end it so this entry starts on its own line.
	if fi, err := f.Stat(); err == nil && fi.Size() > 0 {
		if r, err := os.Open(j.path); err == nil {
			last := make([]byte, 1)
			if _, err := r.ReadAt(last, fi.Size()-1); err == nil && last[0] != '\n' {
				b = append([]byte{'\n'}, b...)
			}
			r.Close()
		}
	}
	_, err = f.Write(append(b, '\n'))
	return e, err
}

// List returns up to limit entries, newest first, marking undone ones, in
// English.
func (j *Journal) List(limit int) ([]Entry, error) { return j.ListIn(limit, "en") }

// ListIn is List with summaries and details in a language.
func (j *Journal) ListIn(limit int, lang string) ([]Entry, error) {
	j.mu.Lock()
	defer j.mu.Unlock()
	f, err := os.Open(j.path)
	if os.IsNotExist(err) {
		return []Entry{}, nil
	}
	if err != nil {
		return nil, err
	}
	defer f.Close()
	var all []Entry
	undone := map[string]bool{}
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 64<<10), 4<<20)
	for sc.Scan() {
		var e Entry
		if json.Unmarshal(sc.Bytes(), &e) != nil {
			continue // a torn last line after a crash
		}
		if e.Undoes != "" {
			undone[e.Undoes] = true
		}
		all = append(all, e)
	}
	summary := map[string]string{}
	for i := range all {
		e := &all[i]
		if e.Msg != nil {
			e.Summary = i18n.Render(lang, *e.Msg)
		}
		if e.Kind == "undo" && e.Undoes != "" {
			if what, ok := summary[e.Undoes]; ok {
				e.Summary = i18n.T(lang, "journal.undo", "what", what)
			}
		}
		if len(e.Lines) > 0 {
			e.Details = e.Details[:0:0]
			for _, l := range e.Lines {
				e.Details = append(e.Details, i18n.Render(lang, l))
			}
		}
		summary[e.ID] = e.Summary
	}
	out := make([]Entry, 0, limit)
	for i := len(all) - 1; i >= 0 && len(out) < limit; i-- {
		e := all[i]
		e.Undone = undone[e.ID]
		out = append(out, e)
	}
	return out, nil
}

// Find returns the entry with this id.
func (j *Journal) Find(id string) (Entry, bool) {
	list, _ := j.List(1 << 20)
	for _, e := range list {
		if e.ID == id {
			return e, true
		}
	}
	return Entry{}, false
}
