package journal

import (
	"os"
	"testing"
)

func TestJournal(t *testing.T) {
	dir := t.TempDir()
	j := Open(dir)
	if l, _ := j.List(10); len(l) != 0 {
		t.Fatal("not empty")
	}
	a, _ := j.Add(Entry{Kind: "clean", Summary: "Freed 1 GB", Bytes: 1 << 30})
	b, _ := j.Add(Entry{Kind: "startup", Summary: "Turned off Steam", Undo: &Undo{Kind: "startup", ID: "run-user:Steam", Value: true}})
	// A torn line must not hide the rest.
	f, _ := os.OpenFile(dir+"/journal.jsonl", os.O_APPEND|os.O_WRONLY, 0)
	f.WriteString("{\"id\":\"tor")
	f.Close()
	j.Add(Entry{Kind: "undo", Summary: "Undid", Undoes: b.ID})
	l, _ := j.List(10)
	if len(l) != 3 || l[0].Kind != "undo" || l[2].ID != a.ID {
		t.Fatalf("list %+v", l)
	}
	if !l[1].Undone || l[2].Undone {
		t.Fatal("undone flags")
	}
	if e, ok := j.Find(b.ID); !ok || e.Undo.ID != "run-user:Steam" {
		t.Fatal("find")
	}
	if l, _ := j.List(1); len(l) != 1 {
		t.Fatal("limit")
	}
}
