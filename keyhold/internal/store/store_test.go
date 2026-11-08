package store

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

func vault(n int) json.RawMessage {
	return json.RawMessage(fmt.Sprintf(`{"format":"keyhold-vault","v":1,"id":"abc","kdf":{"name":"PBKDF2-SHA256","iterations":600000,"salt":"c2FsdHNhbHRzYWx0c2FsdA=="},"keys":{"password":{"iv":"aa","ct":"bb"}},"data":{"iv":"cc","ct":"data%d"}}`, n))
}

func TestSaveLoadAndConflict(t *testing.T) {
	s, err := Open(t.TempDir(), 3)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.Load(); !errors.Is(err, ErrNotFound) {
		t.Fatalf("want not found, got %v", err)
	}
	r, err := s.Save(0, vault(1), json.RawMessage(`{"remoteRev":4}`))
	if err != nil || r.Rev != 1 {
		t.Fatalf("first save: %v %v", r, err)
	}
	var ce *ConflictError
	if _, err := s.Save(0, vault(2), nil); !errors.As(err, &ce) || ce.Current != 1 {
		t.Fatalf("want conflict at 1, got %v", err)
	}
	if _, err := s.Save(1, vault(2), nil); err != nil {
		t.Fatal(err)
	}
	got, _ := s.Load()
	if got.Rev != 2 || !strings.Contains(string(got.Vault), "data2") {
		t.Fatalf("unexpected record %+v", got)
	}
}

func TestRejectsInvalidVault(t *testing.T) {
	s, _ := Open(t.TempDir(), 3)
	for _, bad := range []string{`{}`, `not json`, `{"format":"keyhold-vault","v":2}`, `[]`} {
		if _, err := s.Save(0, json.RawMessage(bad), nil); !errors.Is(err, ErrInvalid) {
			t.Errorf("%s: want ErrInvalid, got %v", bad, err)
		}
	}
	if _, err := s.Save(0, vault(1), json.RawMessage(`{bad`)); !errors.Is(err, ErrInvalid) {
		t.Errorf("bad meta accepted")
	}
}

func TestBackupsKeptAndPruned(t *testing.T) {
	dir := t.TempDir()
	s, _ := Open(dir, 3)
	for i := int64(0); i < 6; i++ {
		if _, err := s.Save(i, vault(int(i)), nil); err != nil {
			t.Fatal(err)
		}
	}
	list, err := s.Backups()
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 3 || list[0].Rev != 5 || list[2].Rev != 3 {
		t.Fatalf("unexpected backups %+v", list)
	}
	rec, err := s.ReadBackup(list[0].Name)
	if err != nil || rec.Rev != 5 || !strings.Contains(string(rec.Vault), "data4") {
		t.Fatalf("backup content wrong: %+v %v", rec, err)
	}
	for _, evil := range []string{"../vault.keyhold", "vault.keyhold", `..\x`, list[0].Name + "/../x"} {
		if _, err := s.ReadBackup(evil); err == nil {
			t.Errorf("accepted %q", evil)
		}
	}
	// no temporary files left behind
	entries, _ := os.ReadDir(dir)
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), ".tmp-") {
			t.Errorf("leftover %s", e.Name())
		}
	}
	_ = filepath.Join
}

func TestConcurrentSavesNeverLoseAWrite(t *testing.T) {
	s, _ := Open(t.TempDir(), 50)
	s.Save(0, vault(0), nil)
	var wg sync.WaitGroup
	var mu sync.Mutex
	ok := 0
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			if _, err := s.Save(1, vault(i), nil); err == nil {
				mu.Lock()
				ok++
				mu.Unlock()
			}
		}(i)
	}
	wg.Wait()
	if ok != 1 {
		t.Fatalf("exactly one writer should win, got %d", ok)
	}
}
