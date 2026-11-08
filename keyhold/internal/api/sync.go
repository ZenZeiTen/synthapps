package api

import (
	"crypto/hmac"
	"crypto/pbkdf2"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/ZenZeiTen/synthapps/keyhold/internal/store"
)

// SyncConfig configures the online sync server.
type SyncConfig struct {
	DataDir     string
	Static      http.Handler
	OpenSignup  bool
	InviteCode  string   // when set, signup needs this code
	CORSOrigins []string // "*" or exact origins; empty means loopback origins only
	TrustProxy  bool     // use X-Forwarded-For for rate limiting
	HTTPS       bool     // send HSTS
	KeepHistory int
	SessionTTL  time.Duration
	Logger      *log.Logger
}

const serverHashIterations = 10000

type account struct {
	Username     string          `json:"username"`
	KDF          json.RawMessage `json:"kdf"`
	Salt         string          `json:"salt"`
	AuthHash     string          `json:"authHash"`
	RecoverySalt string          `json:"recoverySalt,omitempty"`
	RecoveryHash string          `json:"recoveryHash,omitempty"`
	CreatedAt    time.Time       `json:"createdAt"`
	KeysChanged  time.Time       `json:"keysChanged"`
}

type session struct {
	user    string
	expires time.Time
}

// SyncServer holds accounts and their encrypted vaults.
type SyncServer struct {
	c        SyncConfig
	secret   []byte
	mu       sync.Mutex
	userLock map[string]*sync.Mutex
	sessions map[string]session // key: sha256(token) hex
	ipLimit  *limiter
	failures map[string]*failState
}

type failState struct {
	n     int
	until time.Time
}

var usernameRe = regexp.MustCompile(`^[a-z0-9][a-z0-9._@+-]{2,63}$`)

// NewSync opens (or initialises) the data folder.
func NewSync(c SyncConfig) (*SyncServer, error) {
	if c.KeepHistory <= 0 {
		c.KeepHistory = 50
	}
	if c.SessionTTL <= 0 {
		c.SessionTTL = 12 * time.Hour
	}
	if c.Logger == nil {
		c.Logger = log.Default()
	}
	if err := os.MkdirAll(filepath.Join(c.DataDir, "users"), 0o700); err != nil {
		return nil, err
	}
	keyPath := filepath.Join(c.DataDir, "server.key")
	secret, err := os.ReadFile(keyPath)
	if errors.Is(err, os.ErrNotExist) {
		secret = make([]byte, 32)
		rand.Read(secret)
		if err := store.WriteFileAtomic(keyPath, secret, 0o600); err != nil {
			return nil, err
		}
	} else if err != nil {
		return nil, err
	}
	s := &SyncServer{
		c: c, secret: secret,
		userLock: map[string]*sync.Mutex{},
		sessions: map[string]session{},
		ipLimit:  newLimiter(30, 10*time.Minute),
		failures: map[string]*failState{},
	}
	go s.janitor()
	return s, nil
}

func (s *SyncServer) janitor() {
	for range time.Tick(5 * time.Minute) {
		now := time.Now()
		s.mu.Lock()
		for k, v := range s.sessions {
			if now.After(v.expires) {
				delete(s.sessions, k)
			}
		}
		for k, v := range s.failures {
			if now.After(v.until.Add(time.Hour)) {
				delete(s.failures, k)
			}
		}
		s.mu.Unlock()
		s.ipLimit.cleanup()
	}
}

func (s *SyncServer) userDir(u string) string {
	sum := sha256.Sum256([]byte(u))
	return filepath.Join(s.c.DataDir, "users", hex.EncodeToString(sum[:16]))
}

func (s *SyncServer) lockUser(u string) func() {
	s.mu.Lock()
	m, ok := s.userLock[u]
	if !ok {
		m = &sync.Mutex{}
		s.userLock[u] = m
	}
	s.mu.Unlock()
	m.Lock()
	return m.Unlock
}

func (s *SyncServer) loadAccount(u string) (*account, error) {
	b, err := os.ReadFile(filepath.Join(s.userDir(u), "account.json"))
	if err != nil {
		return nil, err
	}
	var a account
	if err := json.Unmarshal(b, &a); err != nil {
		return nil, err
	}
	return &a, nil
}

func (s *SyncServer) saveAccount(a *account) error {
	b, _ := json.MarshalIndent(a, "", "  ")
	return store.WriteFileAtomic(filepath.Join(s.userDir(a.Username), "account.json"), b, 0o600)
}

func (s *SyncServer) vaultStore(u string) (*store.Store, error) {
	return store.Open(filepath.Join(s.userDir(u), "vault"), s.c.KeepHistory)
}

func hashAuth(authKeyB64, saltB64 string) (string, error) {
	key, err := base64.StdEncoding.DecodeString(authKeyB64)
	if err != nil || len(key) != 32 {
		return "", errors.New("bad key")
	}
	salt, err := base64.StdEncoding.DecodeString(saltB64)
	if err != nil {
		return "", err
	}
	h, err := pbkdf2.Key(sha256.New, string(key), salt, serverHashIterations, 32)
	if err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(h), nil
}

func newSalt() string {
	b := make([]byte, 16)
	rand.Read(b)
	return base64.StdEncoding.EncodeToString(b)
}

func checkHash(authKey, salt, want string) bool {
	if want == "" {
		return false
	}
	got, err := hashAuth(authKey, salt)
	if err != nil {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(got), []byte(want)) == 1
}

func normUser(u string) string { return strings.ToLower(strings.TrimSpace(u)) }

func validKDF(raw json.RawMessage) bool {
	var k struct {
		Name       string `json:"name"`
		Iterations int    `json:"iterations"`
		Salt       string `json:"salt"`
	}
	if json.Unmarshal(raw, &k) != nil {
		return false
	}
	salt, err := base64.StdEncoding.DecodeString(k.Salt)
	return k.Name == "PBKDF2-SHA256" && k.Iterations >= 100000 && k.Iterations <= 10000000 && err == nil && len(salt) >= 16
}

// fakeKDF gives unknown usernames stable, believable parameters so that the
// prelogin answer does not reveal whether an account exists.
func (s *SyncServer) fakeKDF(u string) json.RawMessage {
	m := hmac.New(sha256.New, s.secret)
	m.Write([]byte("prelogin:" + u))
	salt := base64.StdEncoding.EncodeToString(m.Sum(nil)[:16])
	return json.RawMessage(fmt.Sprintf(`{"name":"PBKDF2-SHA256","iterations":600000,"salt":%q}`, salt))
}

func (s *SyncServer) clientIP(r *http.Request) string {
	if s.c.TrustProxy {
		if xf := r.Header.Get("X-Forwarded-For"); xf != "" {
			parts := strings.Split(xf, ",")
			return strings.TrimSpace(parts[len(parts)-1])
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

func (s *SyncServer) newSession(u string) (string, time.Time) {
	b := make([]byte, 32)
	rand.Read(b)
	tok := base64.RawURLEncoding.EncodeToString(b)
	sum := sha256.Sum256([]byte(tok))
	exp := time.Now().Add(s.c.SessionTTL)
	s.mu.Lock()
	// keep at most 20 sessions per user
	n := 0
	for k, v := range s.sessions {
		if v.user == u {
			n++
			if n >= 20 {
				delete(s.sessions, k)
			}
		}
	}
	s.sessions[hex.EncodeToString(sum[:])] = session{user: u, expires: exp}
	s.mu.Unlock()
	return tok, exp
}

func (s *SyncServer) sessionUser(r *http.Request) (string, string) {
	t := bearer(r)
	if t == "" {
		return "", ""
	}
	sum := sha256.Sum256([]byte(t))
	k := hex.EncodeToString(sum[:])
	s.mu.Lock()
	defer s.mu.Unlock()
	v, ok := s.sessions[k]
	if !ok || time.Now().After(v.expires) {
		delete(s.sessions, k)
		return "", ""
	}
	return v.user, k
}

func (s *SyncServer) dropSessions(u, except string) {
	s.mu.Lock()
	for k, v := range s.sessions {
		if v.user == u && k != except {
			delete(s.sessions, k)
		}
	}
	s.mu.Unlock()
}

// loginAllowed applies a growing delay after failed sign-ins for one account.
func (s *SyncServer) loginAllowed(u string) (bool, time.Duration) {
	s.mu.Lock()
	defer s.mu.Unlock()
	f := s.failures[u]
	if f == nil || time.Now().After(f.until) {
		return true, 0
	}
	return false, time.Until(f.until)
}

func (s *SyncServer) loginFailed(u string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	f := s.failures[u]
	if f == nil {
		f = &failState{}
		s.failures[u] = f
	}
	f.n++
	if f.n >= 5 {
		d := time.Duration(1<<min(f.n-5, 10)) * time.Second
		if d > 15*time.Minute {
			d = 15 * time.Minute
		}
		f.until = time.Now().Add(d)
	}
}

func (s *SyncServer) loginOK(u string) {
	s.mu.Lock()
	delete(s.failures, u)
	s.mu.Unlock()
}

func (s *SyncServer) signupMode() string {
	switch {
	case s.c.OpenSignup:
		return "open"
	case s.c.InviteCode != "":
		return "invite"
	}
	return "closed"
}

// Handler returns the full HTTP handler (web app + API).
func (s *SyncServer) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/mode", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, map[string]any{"mode": "server", "version": Version, "signup": s.signupMode()})
	})
	limited := func(h http.HandlerFunc) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			if !s.ipLimit.allow(s.clientIP(r)) {
				w.Header().Set("Retry-After", "60")
				writeErr(w, 429, "rate_limited", "Too many attempts. Wait a few minutes and try again.")
				return
			}
			h(w, r)
		}
	}
	authed := func(h func(w http.ResponseWriter, r *http.Request, user, sess string)) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			u, k := s.sessionUser(r)
			if u == "" {
				writeErr(w, 401, "unauthorized", "Please sign in again.")
				return
			}
			h(w, r, u, k)
		}
	}

	mux.HandleFunc("POST /api/v1/prelogin", limited(func(w http.ResponseWriter, r *http.Request) {
		var in struct {
			Username string `json:"username"`
		}
		if readJSON(w, r, &in) != nil {
			writeErr(w, 400, "bad_request", "Invalid request.")
			return
		}
		u := normUser(in.Username)
		a, err := s.loadAccount(u)
		if err != nil {
			writeJSON(w, 200, map[string]any{"kdf": s.fakeKDF(u)})
			return
		}
		writeJSON(w, 200, map[string]any{"kdf": a.KDF})
	}))

	mux.HandleFunc("POST /api/v1/register", limited(func(w http.ResponseWriter, r *http.Request) {
		var in struct {
			Username        string          `json:"username"`
			AuthKey         string          `json:"authKey"`
			RecoveryAuthKey string          `json:"recoveryAuthKey"`
			KDF             json.RawMessage `json:"kdf"`
			Vault           json.RawMessage `json:"vault"`
			Invite          string          `json:"invite"`
		}
		if readJSON(w, r, &in) != nil {
			writeErr(w, 400, "bad_request", "Invalid request.")
			return
		}
		switch s.signupMode() {
		case "closed":
			writeErr(w, 403, "signup_closed", "This server does not accept new accounts.")
			return
		case "invite":
			if subtle.ConstantTimeCompare([]byte(in.Invite), []byte(s.c.InviteCode)) != 1 {
				writeErr(w, 403, "bad_invite", "The invite code is not correct.")
				return
			}
		}
		u := normUser(in.Username)
		if !usernameRe.MatchString(u) {
			writeErr(w, 400, "bad_username", "Use 3 to 64 characters: letters, digits and . _ @ + -")
			return
		}
		if !validKDF(in.KDF) || store.ValidateVault(in.Vault) != nil {
			writeErr(w, 400, "bad_vault", "The vault data is not valid.")
			return
		}
		unlock := s.lockUser(u)
		defer unlock()
		if _, err := s.loadAccount(u); err == nil {
			writeErr(w, 409, "taken", "That username is already in use.")
			return
		}
		a := &account{Username: u, KDF: in.KDF, Salt: newSalt(), CreatedAt: time.Now().UTC(), KeysChanged: time.Now().UTC()}
		var err error
		if a.AuthHash, err = hashAuth(in.AuthKey, a.Salt); err != nil {
			writeErr(w, 400, "bad_key", "Invalid key.")
			return
		}
		if in.RecoveryAuthKey != "" {
			a.RecoverySalt = newSalt()
			if a.RecoveryHash, err = hashAuth(in.RecoveryAuthKey, a.RecoverySalt); err != nil {
				writeErr(w, 400, "bad_key", "Invalid recovery key.")
				return
			}
		}
		st, err := s.vaultStore(u)
		if err != nil {
			writeErr(w, 500, "write_failed", "Could not create the account.")
			return
		}
		rec, err := st.Save(0, in.Vault, nil)
		if err != nil {
			writeErr(w, 500, "write_failed", "Could not create the account.")
			return
		}
		if err := s.saveAccount(a); err != nil {
			writeErr(w, 500, "write_failed", "Could not create the account.")
			return
		}
		s.c.Logger.Printf("account created: %s", u)
		tok, exp := s.newSession(u)
		writeJSON(w, 201, map[string]any{"token": tok, "expiresAt": exp, "rev": rec.Rev})
	}))

	mux.HandleFunc("POST /api/v1/login", limited(func(w http.ResponseWriter, r *http.Request) {
		var in struct {
			Username        string `json:"username"`
			AuthKey         string `json:"authKey"`
			RecoveryAuthKey string `json:"recoveryAuthKey"`
		}
		if readJSON(w, r, &in) != nil {
			writeErr(w, 400, "bad_request", "Invalid request.")
			return
		}
		u := normUser(in.Username)
		if ok, wait := s.loginAllowed(u); !ok {
			w.Header().Set("Retry-After", fmt.Sprint(int(wait.Seconds())+1))
			writeErr(w, 429, "locked", fmt.Sprintf("Too many wrong attempts. Try again in %d seconds.", int(wait.Seconds())+1))
			return
		}
		a, err := s.loadAccount(u)
		ok := false
		if err == nil {
			if in.RecoveryAuthKey != "" {
				ok = checkHash(in.RecoveryAuthKey, a.RecoverySalt, a.RecoveryHash)
			} else {
				ok = checkHash(in.AuthKey, a.Salt, a.AuthHash)
			}
		} else {
			hashAuth(in.AuthKey, newSalt()) // same work either way
		}
		if !ok {
			s.loginFailed(u)
			writeErr(w, 401, "wrong_credentials", "Wrong username or master password.")
			return
		}
		s.loginOK(u)
		tok, exp := s.newSession(u)
		writeJSON(w, 200, map[string]any{"token": tok, "expiresAt": exp})
	}))

	mux.HandleFunc("POST /api/v1/logout", authed(func(w http.ResponseWriter, r *http.Request, u, k string) {
		s.mu.Lock()
		delete(s.sessions, k)
		s.mu.Unlock()
		writeJSON(w, 200, map[string]any{"ok": true})
	}))

	mux.HandleFunc("GET /api/v1/vault", authed(func(w http.ResponseWriter, r *http.Request, u, _ string) {
		st, err := s.vaultStore(u)
		if err == nil {
			var rec *store.Record
			if rec, err = st.Load(); err == nil {
				writeJSON(w, 200, map[string]any{"rev": rec.Rev, "savedAt": rec.SavedAt, "vault": rec.Vault})
				return
			}
		}
		writeErr(w, 500, "read_failed", "Could not read the vault.")
	}))

	mux.HandleFunc("PUT /api/v1/vault", authed(func(w http.ResponseWriter, r *http.Request, u, _ string) {
		var in struct {
			Rev   int64           `json:"rev"`
			Vault json.RawMessage `json:"vault"`
		}
		if readJSON(w, r, &in) != nil {
			writeErr(w, 400, "bad_request", "Invalid request.")
			return
		}
		unlock := s.lockUser(u)
		defer unlock()
		s.putVault(w, u, in.Rev, in.Vault)
	}))

	mux.HandleFunc("POST /api/v1/account/keys", authed(func(w http.ResponseWriter, r *http.Request, u, k string) {
		var in struct {
			AuthKey         string          `json:"authKey"`
			KDF             json.RawMessage `json:"kdf"`
			RecoveryAuthKey *string         `json:"recoveryAuthKey"`
			Rev             int64           `json:"rev"`
			Vault           json.RawMessage `json:"vault"`
		}
		if readJSON(w, r, &in) != nil {
			writeErr(w, 400, "bad_request", "Invalid request.")
			return
		}
		unlock := s.lockUser(u)
		defer unlock()
		a, err := s.loadAccount(u)
		if err != nil {
			writeErr(w, 500, "read_failed", "Could not read the account.")
			return
		}
		next := *a
		if in.AuthKey != "" {
			if !validKDF(in.KDF) {
				writeErr(w, 400, "bad_kdf", "Invalid key settings.")
				return
			}
			next.KDF, next.Salt = in.KDF, newSalt()
			if next.AuthHash, err = hashAuth(in.AuthKey, next.Salt); err != nil {
				writeErr(w, 400, "bad_key", "Invalid key.")
				return
			}
		}
		if in.RecoveryAuthKey != nil {
			if *in.RecoveryAuthKey == "" {
				next.RecoverySalt, next.RecoveryHash = "", ""
			} else {
				next.RecoverySalt = newSalt()
				if next.RecoveryHash, err = hashAuth(*in.RecoveryAuthKey, next.RecoverySalt); err != nil {
					writeErr(w, 400, "bad_key", "Invalid recovery key.")
					return
				}
			}
		}
		st, err := s.vaultStore(u)
		if err != nil {
			writeErr(w, 500, "write_failed", "Could not save.")
			return
		}
		rec, err := st.Save(in.Rev, in.Vault, nil)
		var ce *store.ConflictError
		if errors.As(err, &ce) {
			writeJSON(w, 409, map[string]any{"error": "conflict", "rev": ce.Current})
			return
		}
		if err != nil {
			writeErr(w, 400, "bad_vault", "The vault data is not valid.")
			return
		}
		next.KeysChanged = time.Now().UTC()
		if err := s.saveAccount(&next); err != nil {
			writeErr(w, 500, "write_failed", "Saved the vault but not the new keys. Sign in with your old password and try again.")
			return
		}
		if in.AuthKey != "" {
			s.dropSessions(u, k) // other devices must sign in with the new password
		}
		writeJSON(w, 200, map[string]any{"rev": rec.Rev})
	}))

	mux.HandleFunc("GET /api/v1/vault/history", authed(func(w http.ResponseWriter, r *http.Request, u, _ string) {
		st, err := s.vaultStore(u)
		if err != nil {
			writeErr(w, 500, "read_failed", "Could not read history.")
			return
		}
		list, err := st.Backups()
		if err != nil {
			writeErr(w, 500, "read_failed", "Could not read history.")
			return
		}
		if list == nil {
			list = []store.BackupInfo{}
		}
		writeJSON(w, 200, map[string]any{"backups": list})
	}))

	mux.HandleFunc("GET /api/v1/vault/history/{name}", authed(func(w http.ResponseWriter, r *http.Request, u, _ string) {
		st, err := s.vaultStore(u)
		if err != nil {
			writeErr(w, 500, "read_failed", "Could not read history.")
			return
		}
		rec, err := st.ReadBackup(r.PathValue("name"))
		if err != nil {
			writeErr(w, 404, "not_found", "Version not found.")
			return
		}
		writeJSON(w, 200, rec)
	}))

	mux.HandleFunc("POST /api/v1/account/delete", authed(func(w http.ResponseWriter, r *http.Request, u, _ string) {
		var in struct {
			AuthKey string `json:"authKey"`
		}
		if readJSON(w, r, &in) != nil {
			writeErr(w, 400, "bad_request", "Invalid request.")
			return
		}
		unlock := s.lockUser(u)
		defer unlock()
		a, err := s.loadAccount(u)
		if err != nil || !checkHash(in.AuthKey, a.Salt, a.AuthHash) {
			writeErr(w, 401, "wrong_credentials", "Wrong master password.")
			return
		}
		if err := os.RemoveAll(s.userDir(u)); err != nil {
			writeErr(w, 500, "delete_failed", "Could not delete the account.")
			return
		}
		s.dropSessions(u, "")
		s.c.Logger.Printf("account deleted: %s", u)
		writeJSON(w, 200, map[string]any{"ok": true})
	}))

	mux.Handle("/", s.c.Static)
	return securityHeaders(s.cors(mux), "'self' https://api.pwnedpasswords.com", s.c.HTTPS)
}

func (s *SyncServer) putVault(w http.ResponseWriter, u string, rev int64, vault json.RawMessage) {
	st, err := s.vaultStore(u)
	if err != nil {
		writeErr(w, 500, "write_failed", "Could not save.")
		return
	}
	rec, err := st.Save(rev, vault, nil)
	var ce *store.ConflictError
	switch {
	case errors.As(err, &ce):
		writeJSON(w, 409, map[string]any{"error": "conflict", "rev": ce.Current})
	case errors.Is(err, store.ErrInvalid):
		writeErr(w, 400, "invalid_vault", "The vault data is not valid.")
	case err != nil:
		writeErr(w, 500, "write_failed", "Could not save.")
	default:
		writeJSON(w, 200, map[string]any{"rev": rec.Rev, "savedAt": rec.SavedAt})
	}
}

var loopbackOrigin = regexp.MustCompile(`^http://(127\.0\.0\.1|localhost)(:\d{1,5})?$`)

// cors lets the desktop app (served from a loopback origin) sync with this
// server. Requests are authorised with bearer tokens, never cookies.
func (s *SyncServer) cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		o := r.Header.Get("Origin")
		if o != "" && strings.HasPrefix(r.URL.Path, "/api/") && s.originAllowed(o) {
			h := w.Header()
			h.Set("Access-Control-Allow-Origin", o)
			h.Set("Vary", "Origin")
			h.Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
			h.Set("Access-Control-Allow-Methods", "GET, POST, PUT")
			h.Set("Access-Control-Max-Age", "600")
			if r.Method == http.MethodOptions {
				w.WriteHeader(http.StatusNoContent)
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

func (s *SyncServer) originAllowed(o string) bool {
	if len(s.c.CORSOrigins) == 0 {
		return loopbackOrigin.MatchString(o)
	}
	for _, a := range s.c.CORSOrigins {
		if a == "*" || strings.EqualFold(a, o) {
			return true
		}
	}
	return false
}

// limiter is a fixed-window counter per key.
type limiter struct {
	mu     sync.Mutex
	max    int
	window time.Duration
	m      map[string]*window
}

type window struct {
	start time.Time
	n     int
}

func newLimiter(max int, w time.Duration) *limiter {
	return &limiter{max: max, window: w, m: map[string]*window{}}
}

func (l *limiter) allow(key string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := time.Now()
	w := l.m[key]
	if w == nil || now.Sub(w.start) > l.window {
		w = &window{start: now}
		l.m[key] = w
	}
	w.n++
	return w.n <= l.max
}

func (l *limiter) cleanup() {
	l.mu.Lock()
	defer l.mu.Unlock()
	for k, w := range l.m {
		if time.Since(w.start) > l.window {
			delete(l.m, k)
		}
	}
}
