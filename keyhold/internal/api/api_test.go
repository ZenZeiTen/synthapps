package api

import (
	"bytes"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/ZenZeiTen/synthapps/keyhold/internal/store"
)

const testVault = `{"format":"keyhold-vault","v":1,"id":"abc","kdf":{"name":"PBKDF2-SHA256","iterations":600000,"salt":"c2FsdHNhbHRzYWx0c2FsdA=="},"keys":{"password":{"iv":"aa","ct":"bb"}},"data":{"iv":"cc","ct":"dd"}}`
const testKDF = `{"name":"PBKDF2-SHA256","iterations":600000,"salt":"c2FsdHNhbHRzYWx0c2FsdA=="}`

func static(t *testing.T) http.Handler {
	s, err := NewStatic(fstest.MapFS{"index.html": {Data: []byte("<!doctype html>app")}, "js/app.js": {Data: []byte("x")}})
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func do(t *testing.T, h http.Handler, method, url, token, body string, hdr ...string) (*httptest.ResponseRecorder, map[string]any) {
	t.Helper()
	req := httptest.NewRequest(method, url, strings.NewReader(body))
	req.Host = "127.0.0.1:47811"
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	for i := 0; i+1 < len(hdr); i += 2 {
		if hdr[i] == "Host" {
			req.Host = hdr[i+1]
		} else {
			req.Header.Set(hdr[i], hdr[i+1])
		}
	}
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	var m map[string]any
	json.Unmarshal(rr.Body.Bytes(), &m)
	return rr, m
}

func desktop(t *testing.T) http.Handler {
	st, _ := store.Open(t.TempDir(), 5)
	return NewDesktop(DesktopConfig{Store: st, Token: "tok", Hosts: []string{"127.0.0.1:47811", "localhost:47811"}, Static: static(t)})
}

func TestDesktopNeedsToken(t *testing.T) {
	h := desktop(t)
	if rr, _ := do(t, h, "GET", "/api/local/vault", "", ""); rr.Code != 401 {
		t.Fatalf("no token: %d", rr.Code)
	}
	if rr, _ := do(t, h, "GET", "/api/local/vault", "wrong", ""); rr.Code != 401 {
		t.Fatalf("bad token: %d", rr.Code)
	}
	if rr, _ := do(t, h, "GET", "/api/local/vault", "tok", ""); rr.Code != 404 {
		t.Fatalf("want 404 before first save: %d", rr.Code)
	}
}

func TestDesktopBlocksRebindingAndCrossOrigin(t *testing.T) {
	h := desktop(t)
	if rr, _ := do(t, h, "GET", "/", "", "", "Host", "evil.example:47811"); rr.Code != http.StatusMisdirectedRequest {
		t.Fatalf("foreign host served: %d", rr.Code)
	}
	if rr, _ := do(t, h, "GET", "/api/local/vault", "tok", "", "Origin", "https://evil.example"); rr.Code != 403 {
		t.Fatalf("cross-origin allowed: %d", rr.Code)
	}
	rr, _ := do(t, h, "GET", "/", "", "")
	if rr.Code != 200 || !strings.Contains(rr.Header().Get("Content-Security-Policy"), "script-src 'self'") {
		t.Fatalf("index/CSP: %d %q", rr.Code, rr.Header().Get("Content-Security-Policy"))
	}
}

func TestDesktopSaveCycle(t *testing.T) {
	h := desktop(t)
	rr, m := do(t, h, "PUT", "/api/local/vault", "tok", `{"rev":0,"vault":`+testVault+`,"meta":{"remoteRev":0}}`)
	if rr.Code != 200 || m["rev"].(float64) != 1 {
		t.Fatalf("save: %d %v", rr.Code, m)
	}
	rr, m = do(t, h, "PUT", "/api/local/vault", "tok", `{"rev":0,"vault":`+testVault+`}`)
	if rr.Code != 409 || m["rev"].(float64) != 1 {
		t.Fatalf("conflict: %d %v", rr.Code, m)
	}
	do(t, h, "PUT", "/api/local/vault", "tok", `{"rev":1,"vault":`+testVault+`}`)
	_, m = do(t, h, "GET", "/api/local/backups", "tok", "")
	list := m["backups"].([]any)
	if len(list) != 1 {
		t.Fatalf("backups: %v", m)
	}
	name := list[0].(map[string]any)["name"].(string)
	if rr, _ := do(t, h, "GET", "/api/local/backups/"+name, "tok", ""); rr.Code != 200 {
		t.Fatalf("read backup: %d", rr.Code)
	}
	if rr, _ := do(t, h, "PUT", "/api/local/vault", "tok", `{"rev":2,"vault":{"format":"other"}}`); rr.Code != 400 {
		t.Fatalf("invalid vault accepted: %d", rr.Code)
	}
}

func key() string {
	b := make([]byte, 32)
	rand.Read(b)
	return base64.StdEncoding.EncodeToString(b)
}

func syncSrv(t *testing.T, cfg SyncConfig) http.Handler {
	cfg.DataDir = t.TempDir()
	cfg.Static = static(t)
	cfg.Logger = log.New(io.Discard, "", 0)
	s, err := NewSync(cfg)
	if err != nil {
		t.Fatal(err)
	}
	return s.Handler()
}

func register(t *testing.T, h http.Handler, user, auth string) string {
	t.Helper()
	b, _ := json.Marshal(map[string]any{"username": user, "authKey": auth, "kdf": json.RawMessage(testKDF), "vault": json.RawMessage(testVault)})
	rr, m := do(t, h, "POST", "/api/v1/register", "", string(b))
	if rr.Code != 201 {
		t.Fatalf("register: %d %v", rr.Code, m)
	}
	return m["token"].(string)
}

func TestSyncSignupModes(t *testing.T) {
	closed := syncSrv(t, SyncConfig{})
	b := `{"username":"amy","authKey":"` + key() + `","kdf":` + testKDF + `,"vault":` + testVault + `}`
	if rr, _ := do(t, closed, "POST", "/api/v1/register", "", b); rr.Code != 403 {
		t.Fatalf("closed signup allowed: %d", rr.Code)
	}
	inv := syncSrv(t, SyncConfig{InviteCode: "s3cret"})
	if rr, _ := do(t, inv, "POST", "/api/v1/register", "", b); rr.Code != 403 {
		t.Fatalf("missing invite allowed: %d", rr.Code)
	}
	b2 := strings.Replace(b, `"username"`, `"invite":"s3cret","username"`, 1)
	if rr, _ := do(t, inv, "POST", "/api/v1/register", "", b2); rr.Code != 201 {
		t.Fatalf("invite rejected: %d", rr.Code)
	}
	if rr, _ := do(t, inv, "POST", "/api/v1/register", "", b2); rr.Code != 409 {
		t.Fatalf("duplicate allowed: %d", rr.Code)
	}
	weak := strings.Replace(b2, `"iterations":600000`, `"iterations":1000`, 1)
	weak = strings.Replace(weak, `"amy"`, `"bob"`, 1)
	if rr, _ := do(t, inv, "POST", "/api/v1/register", "", weak); rr.Code != 400 {
		t.Fatalf("weak kdf accepted: %d", rr.Code)
	}
}

func TestSyncLoginVaultAndRekey(t *testing.T) {
	h := syncSrv(t, SyncConfig{OpenSignup: true})
	auth := key()
	tok := register(t, h, "Amy@Example.com", auth)

	// prelogin returns the stored kdf, and a stable fake one for unknown users
	_, m := do(t, h, "POST", "/api/v1/prelogin", "", `{"username":"amy@example.com"}`)
	if m["kdf"].(map[string]any)["salt"] != "c2FsdHNhbHRzYWx0c2FsdA==" {
		t.Fatalf("prelogin: %v", m)
	}
	_, f1 := do(t, h, "POST", "/api/v1/prelogin", "", `{"username":"nobody"}`)
	_, f2 := do(t, h, "POST", "/api/v1/prelogin", "", `{"username":"nobody"}`)
	if f1["kdf"].(map[string]any)["salt"] != f2["kdf"].(map[string]any)["salt"] {
		t.Fatalf("fake prelogin not stable")
	}

	if rr, _ := do(t, h, "POST", "/api/v1/login", "", `{"username":"amy@example.com","authKey":"`+key()+`"}`); rr.Code != 401 {
		t.Fatalf("wrong key accepted: %d", rr.Code)
	}
	rr, m := do(t, h, "POST", "/api/v1/login", "", `{"username":"AMY@example.com","authKey":"`+auth+`"}`)
	if rr.Code != 200 {
		t.Fatalf("login: %d %v", rr.Code, m)
	}
	tok2 := m["token"].(string)

	_, m = do(t, h, "GET", "/api/v1/vault", tok2, "")
	if m["rev"].(float64) != 1 {
		t.Fatalf("get vault: %v", m)
	}
	if rr, _ := do(t, h, "PUT", "/api/v1/vault", tok2, `{"rev":1,"vault":`+testVault+`}`); rr.Code != 200 {
		t.Fatalf("put: %d", rr.Code)
	}
	if rr, m := do(t, h, "PUT", "/api/v1/vault", tok, `{"rev":1,"vault":`+testVault+`}`); rr.Code != 409 || m["rev"].(float64) != 2 {
		t.Fatalf("stale put: %d %v", rr.Code, m)
	}

	// change password from session tok: other session (tok2) is signed out
	newAuth := key()
	body, _ := json.Marshal(map[string]any{"authKey": newAuth, "kdf": json.RawMessage(testKDF), "rev": 2, "vault": json.RawMessage(testVault)})
	if rr, m := do(t, h, "POST", "/api/v1/account/keys", tok, string(body)); rr.Code != 200 {
		t.Fatalf("rekey: %d %v", rr.Code, m)
	}
	if rr, _ := do(t, h, "GET", "/api/v1/vault", tok2, ""); rr.Code != 401 {
		t.Fatalf("old session still valid: %d", rr.Code)
	}
	if rr, _ := do(t, h, "GET", "/api/v1/vault", tok, ""); rr.Code != 200 {
		t.Fatalf("own session dropped: %d", rr.Code)
	}
	if rr, _ := do(t, h, "POST", "/api/v1/login", "", `{"username":"amy@example.com","authKey":"`+auth+`"}`); rr.Code != 401 {
		t.Fatalf("old password still works")
	}
	if rr, _ := do(t, h, "POST", "/api/v1/login", "", `{"username":"amy@example.com","authKey":"`+newAuth+`"}`); rr.Code != 200 {
		t.Fatalf("new password fails")
	}
	_, m = do(t, h, "GET", "/api/v1/vault/history", tok, "")
	if len(m["backups"].([]any)) != 2 {
		t.Fatalf("history: %v", m)
	}
}

func TestSyncRecoveryLoginAndLockout(t *testing.T) {
	h := syncSrv(t, SyncConfig{OpenSignup: true})
	auth, rec := key(), key()
	b, _ := json.Marshal(map[string]any{"username": "carl", "authKey": auth, "recoveryAuthKey": rec, "kdf": json.RawMessage(testKDF), "vault": json.RawMessage(testVault)})
	if rr, _ := do(t, h, "POST", "/api/v1/register", "", string(b)); rr.Code != 201 {
		t.Fatal("register")
	}
	if rr, _ := do(t, h, "POST", "/api/v1/login", "", `{"username":"carl","recoveryAuthKey":"`+rec+`"}`); rr.Code != 200 {
		t.Fatalf("recovery login failed: %d", rr.Code)
	}
	for i := 0; i < 5; i++ {
		do(t, h, "POST", "/api/v1/login", "", `{"username":"carl","authKey":"`+key()+`"}`)
	}
	if rr, _ := do(t, h, "POST", "/api/v1/login", "", `{"username":"carl","authKey":"`+auth+`"}`); rr.Code != 429 {
		t.Fatalf("no lockout after 5 failures: %d", rr.Code)
	}
}

func TestSyncCORSAndHeaders(t *testing.T) {
	h := syncSrv(t, SyncConfig{OpenSignup: true, HTTPS: true})
	rr, _ := do(t, h, "OPTIONS", "/api/v1/vault", "", "", "Origin", "http://127.0.0.1:47811", "Access-Control-Request-Method", "GET")
	if rr.Code != 204 || rr.Header().Get("Access-Control-Allow-Origin") != "http://127.0.0.1:47811" {
		t.Fatalf("loopback preflight: %d %v", rr.Code, rr.Header())
	}
	rr, _ = do(t, h, "OPTIONS", "/api/v1/vault", "", "", "Origin", "https://evil.example")
	if rr.Header().Get("Access-Control-Allow-Origin") != "" {
		t.Fatalf("foreign origin allowed")
	}
	rr, _ = do(t, h, "GET", "/", "", "")
	if rr.Header().Get("Strict-Transport-Security") == "" || rr.Header().Get("X-Frame-Options") != "DENY" {
		t.Fatalf("headers: %v", rr.Header())
	}
	if rr, _ := do(t, h, "GET", "/api/v1/vault", "made-up", ""); rr.Code != 401 {
		t.Fatalf("made-up token: %d", rr.Code)
	}
	big := bytes.Repeat([]byte("a"), maxBody+10)
	if rr, _ := do(t, h, "POST", "/api/v1/prelogin", "", string(big)); rr.Code != 400 {
		t.Fatalf("oversized body: %d", rr.Code)
	}
}

func TestRateLimit(t *testing.T) {
	h := syncSrv(t, SyncConfig{})
	var last int
	for i := 0; i < 35; i++ {
		rr, _ := do(t, h, "POST", "/api/v1/prelogin", "", `{"username":"x"}`)
		last = rr.Code
	}
	if last != 429 {
		t.Fatalf("no rate limit: %d", last)
	}
}
