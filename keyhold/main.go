// Command keyhold is a password manager.
//
//	keyhold                 open your vault on this computer (offline)
//	keyhold serve [flags]   run a sync server so your vault is available online
//	keyhold version
//
// All encryption happens in the Keyhold app window. This program stores and
// serves encrypted data only; it never sees a master password or a secret.
package main

import (
	"embed"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/ZenZeiTen/synthapps/keyhold/internal/api"
)

//go:embed all:web
var webFiles embed.FS

// Set with -ldflags "-X main.version=... -X main.guiBuild=1".
var (
	version  = "1.0.0"
	guiBuild = "0"
)

func main() {
	api.Version = version
	args := os.Args[1:]
	cmd := "desktop"
	if len(args) > 0 && !strings.HasPrefix(args[0], "-") {
		cmd, args = args[0], args[1:]
	}
	var err error
	switch cmd {
	case "desktop", "open":
		err = runDesktop(args)
	case "serve", "server":
		err = runServe(args)
	case "version", "--version":
		fmt.Println("Keyhold", version)
	case "help", "-h", "--help":
		usage()
	default:
		usage()
		os.Exit(2)
	}
	if err != nil {
		fatal(err)
	}
}

func usage() {
	fmt.Fprint(os.Stderr, `Keyhold `+version+` - a password manager

Usage:
  keyhold [desktop] [--data DIR] [--port N] [--no-browser] [--stay-open]
        Open your vault on this computer. Works fully offline.
  keyhold serve --data DIR [--addr :8443] [--tls-cert F --tls-key F]
                [--open-signup | --invite-code CODE] [--cors-origins LIST] [--trust-proxy]
        Run a sync server: your devices and any browser can reach your vault.
  keyhold version
`)
}

func fatal(err error) {
	if guiBuild == "1" {
		showError("Keyhold", err.Error())
	} else {
		fmt.Fprintln(os.Stderr, "keyhold:", err)
	}
	os.Exit(1)
}

func webFS() fs.FS {
	sub, err := fs.Sub(webFiles, "web")
	if err != nil {
		panic(err)
	}
	return sub
}

// dataDir picks the folder for the desktop vault.
func dataDir(flagVal string) (string, error) {
	if flagVal != "" {
		return filepath.Abs(flagVal)
	}
	if v := os.Getenv("KEYHOLD_HOME"); v != "" {
		return filepath.Abs(v)
	}
	if runtime.GOOS == "windows" {
		if a := os.Getenv("APPDATA"); a != "" {
			return filepath.Join(a, "Keyhold"), nil
		}
	}
	base, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(base, "keyhold"), nil
}

func runServe(args []string) error {
	fl := flag.NewFlagSet("serve", flag.ContinueOnError)
	addr := fl.String("addr", ":8443", "address to listen on")
	data := fl.String("data", "", "folder for accounts and vaults (required)")
	cert := fl.String("tls-cert", "", "TLS certificate file (PEM)")
	key := fl.String("tls-key", "", "TLS key file (PEM)")
	open := fl.Bool("open-signup", false, "let anyone create an account")
	invite := fl.String("invite-code", "", "require this code to create an account")
	cors := fl.String("cors-origins", "", "comma-separated origins allowed to call the API (default: desktop apps on loopback)")
	proxy := fl.Bool("trust-proxy", false, "behind a reverse proxy: use X-Forwarded-For for rate limits")
	keep := fl.Int("history", 50, "previous versions kept per vault")
	if err := fl.Parse(args); err != nil {
		return err
	}
	if *data == "" {
		return fmt.Errorf("serve needs --data DIR (where accounts are stored)")
	}
	if (*cert == "") != (*key == "") {
		return fmt.Errorf("give both --tls-cert and --tls-key")
	}
	logger := log.New(os.Stderr, "keyhold ", log.LstdFlags)
	if guiBuild == "1" {
		os.MkdirAll(*data, 0o700)
		if f, err := os.OpenFile(filepath.Join(*data, "keyhold-server.log"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600); err == nil {
			logger.SetOutput(io.MultiWriter(f))
		}
	}
	static, err := api.NewStatic(webFS())
	if err != nil {
		return err
	}
	var origins []string
	for _, o := range strings.Split(*cors, ",") {
		if o = strings.TrimSpace(o); o != "" {
			origins = append(origins, o)
		}
	}
	srv, err := api.NewSync(api.SyncConfig{
		DataDir: *data, Static: static, OpenSignup: *open, InviteCode: *invite,
		CORSOrigins: origins, TrustProxy: *proxy, HTTPS: *cert != "", KeepHistory: *keep, Logger: logger,
	})
	if err != nil {
		return err
	}
	hs := &http.Server{
		Addr: *addr, Handler: srv.Handler(),
		ReadHeaderTimeout: 10 * time.Second, ReadTimeout: 60 * time.Second,
		WriteTimeout: 60 * time.Second, IdleTimeout: 120 * time.Second, MaxHeaderBytes: 64 << 10,
	}
	mode := map[bool]string{true: "open", false: "closed"}[*open]
	if *invite != "" {
		mode = "invite code"
	}
	if *cert != "" {
		logger.Printf("sync server on https://%s (signup: %s, data: %s)", *addr, mode, *data)
		return hs.ListenAndServeTLS(*cert, *key)
	}
	if !isLoopbackAddr(*addr) && !*proxy {
		logger.Printf("WARNING: no TLS. Put this server behind an HTTPS reverse proxy (and pass --trust-proxy), or give --tls-cert/--tls-key. Browsers only allow the app's encryption on HTTPS or localhost.")
	}
	logger.Printf("sync server on http://%s (signup: %s, data: %s)", *addr, mode, *data)
	return hs.ListenAndServe()
}

func isLoopbackAddr(a string) bool {
	return strings.HasPrefix(a, "127.") || strings.HasPrefix(a, "localhost:") || strings.HasPrefix(a, "[::1]")
}
