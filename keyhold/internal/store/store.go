// Package store keeps one encrypted vault on disk.
//
// The store never sees plaintext: it holds the encrypted envelope produced by the
// web client, plus a revision number used for optimistic concurrency. Every save
// is atomic (write to a temporary file, flush, rename) and the previous version is
// kept in a backups folder, so a crash, a full disk or a bad save can never leave
// the user without a readable vault.
package store

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"
)

// MaxVaultBytes limits the size of one encrypted vault (32 MiB).
const MaxVaultBytes = 32 << 20

// FileName is the name of the current vault file inside the store folder.
const FileName = "vault.keyhold"

var (
	ErrNotFound = errors.New("no vault saved yet")
	ErrInvalid  = errors.New("not a valid Keyhold vault")
)

// ConflictError is returned when the caller's revision is not the current one.
type ConflictError struct{ Current int64 }

func (e *ConflictError) Error() string {
	return fmt.Sprintf("vault changed elsewhere (current revision %d)", e.Current)
}

// Record is what is written to disk.
type Record struct {
	Rev     int64           `json:"rev"`
	SavedAt time.Time       `json:"savedAt"`
	Meta    json.RawMessage `json:"meta,omitempty"`
	Vault   json.RawMessage `json:"vault"`
}

// BackupInfo describes one kept previous version.
type BackupInfo struct {
	Name    string    `json:"name"`
	Rev     int64     `json:"rev"`
	SavedAt time.Time `json:"savedAt"`
	Size    int64     `json:"size"`
}

// Store is safe for concurrent use within one process.
type Store struct {
	dir  string
	keep int
	mu   sync.Mutex
}

// Open creates the folder if needed. keep is how many previous versions to retain.
func Open(dir string, keep int) (*Store, error) {
	if keep < 1 {
		keep = 1
	}
	if err := os.MkdirAll(filepath.Join(dir, "backups"), 0o700); err != nil {
		return nil, err
	}
	return &Store{dir: dir, keep: keep}, nil
}

// Dir returns the store folder.
func (s *Store) Dir() string { return s.dir }

func (s *Store) path() string { return filepath.Join(s.dir, FileName) }

// ValidateVault checks the shape of an encrypted envelope without decrypting it.
func ValidateVault(raw []byte) error {
	if len(raw) == 0 || len(raw) > MaxVaultBytes {
		return ErrInvalid
	}
	var v struct {
		Format string `json:"format"`
		V      int    `json:"v"`
		ID     string `json:"id"`
		KDF    struct {
			Name       string `json:"name"`
			Iterations int    `json:"iterations"`
			Salt       string `json:"salt"`
		} `json:"kdf"`
		Keys struct {
			Password *struct {
				IV string `json:"iv"`
				CT string `json:"ct"`
			} `json:"password"`
		} `json:"keys"`
		Data struct {
			IV string `json:"iv"`
			CT string `json:"ct"`
		} `json:"data"`
	}
	if err := json.Unmarshal(raw, &v); err != nil {
		return ErrInvalid
	}
	if v.Format != "keyhold-vault" || v.V != 1 || v.ID == "" ||
		v.KDF.Name == "" || v.KDF.Iterations <= 0 || v.KDF.Salt == "" ||
		v.Keys.Password == nil || v.Keys.Password.CT == "" ||
		v.Data.IV == "" || v.Data.CT == "" {
		return ErrInvalid
	}
	return nil
}

// Load returns the current record.
func (s *Store) Load() (*Record, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.load()
}

func (s *Store) load() (*Record, error) {
	b, err := os.ReadFile(s.path())
	if errors.Is(err, os.ErrNotExist) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	var r Record
	if err := json.Unmarshal(b, &r); err != nil {
		return nil, fmt.Errorf("vault file is damaged: %w", err)
	}
	return &r, nil
}

// Save writes a new version if expectedRev matches the current revision
// (0 means "no vault yet"). The previous version is moved to backups first.
func (s *Store) Save(expectedRev int64, vault, meta json.RawMessage) (*Record, error) {
	if err := ValidateVault(vault); err != nil {
		return nil, err
	}
	if len(meta) > 0 && (len(meta) > 64<<10 || !json.Valid(meta)) {
		return nil, ErrInvalid
	}
	s.mu.Lock()
	defer s.mu.Unlock()

	cur, err := s.load()
	var curRev int64
	switch {
	case err == nil:
		curRev = cur.Rev
	case errors.Is(err, ErrNotFound):
	default:
		return nil, err
	}
	if expectedRev != curRev {
		return nil, &ConflictError{Current: curRev}
	}
	if cur != nil {
		old, err := os.ReadFile(s.path())
		if err != nil {
			return nil, err
		}
		name := fmt.Sprintf("vault-r%08d-%s.keyhold", cur.Rev, cur.SavedAt.UTC().Format("20060102T150405Z"))
		if err := WriteFileAtomic(filepath.Join(s.dir, "backups", name), old, 0o600); err != nil {
			return nil, fmt.Errorf("could not keep the previous version: %w", err)
		}
	}
	rec := &Record{Rev: curRev + 1, SavedAt: time.Now().UTC().Truncate(time.Millisecond), Meta: meta, Vault: vault}
	b, err := json.Marshal(rec)
	if err != nil {
		return nil, err
	}
	if err := WriteFileAtomic(s.path(), b, 0o600); err != nil {
		return nil, err
	}
	s.prune()
	return rec, nil
}

var backupName = regexp.MustCompile(`^vault-r(\d{8})-(\d{8}T\d{6}Z)\.keyhold$`)

// Backups lists kept versions, newest first.
func (s *Store) Backups() ([]BackupInfo, error) {
	entries, err := os.ReadDir(filepath.Join(s.dir, "backups"))
	if err != nil {
		return nil, err
	}
	var out []BackupInfo
	for _, e := range entries {
		m := backupName.FindStringSubmatch(e.Name())
		if m == nil {
			continue
		}
		var rev int64
		fmt.Sscan(strings.TrimLeft(m[1], "0"), &rev)
		t, _ := time.Parse("20060102T150405Z", m[2])
		info, err := e.Info()
		if err != nil {
			continue
		}
		out = append(out, BackupInfo{Name: e.Name(), Rev: rev, SavedAt: t, Size: info.Size()})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Rev > out[j].Rev })
	return out, nil
}

// ReadBackup returns a kept version. Only names produced by Backups are accepted.
func (s *Store) ReadBackup(name string) (*Record, error) {
	if !backupName.MatchString(name) {
		return nil, ErrNotFound
	}
	b, err := os.ReadFile(filepath.Join(s.dir, "backups", name))
	if errors.Is(err, os.ErrNotExist) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	var r Record
	if err := json.Unmarshal(b, &r); err != nil {
		return nil, err
	}
	return &r, nil
}

func (s *Store) prune() {
	list, err := s.Backups()
	if err != nil || len(list) <= s.keep {
		return
	}
	for _, b := range list[s.keep:] {
		os.Remove(filepath.Join(s.dir, "backups", b.Name))
	}
}

// WriteFileAtomic writes data so that path holds either the old or the new
// content, never a partial file.
func WriteFileAtomic(path string, data []byte, perm os.FileMode) error {
	dir := filepath.Dir(path)
	f, err := os.CreateTemp(dir, ".tmp-*")
	if err != nil {
		return err
	}
	tmp := f.Name()
	ok := false
	defer func() {
		if !ok {
			f.Close()
			os.Remove(tmp)
		}
	}()
	if _, err := f.Write(data); err != nil {
		return err
	}
	if err := f.Sync(); err != nil {
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	if err := os.Chmod(tmp, perm); err != nil && runtime.GOOS != "windows" {
		return err
	}
	if err := os.Rename(tmp, path); err != nil {
		return err
	}
	ok = true
	if runtime.GOOS != "windows" {
		if d, err := os.Open(dir); err == nil {
			d.Sync()
			d.Close()
		}
	}
	return nil
}
