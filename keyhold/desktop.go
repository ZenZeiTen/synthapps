package main

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"sync/atomic"
	"time"

	"github.com/ZenZeiTen/synthapps/keyhold/internal/api"
	"github.com/ZenZeiTen/synthapps/keyhold/internal/store"
)

// DefaultPort is fixed so the app's address (and so its browser storage)
// stays the same between launches.
const DefaultPort = 47811

type instanceInfo struct {
	PID   int    `json:"pid"`
	Port  int    `json:"port"`
	Token string `json:"token"`
}

func runDesktop(args []string) error {
	fl := flag.NewFlagSet("desktop", flag.ContinueOnError)
	data := fl.String("data", "", "folder for the vault (default: %APPDATA%\\Keyhold or ~/.config/keyhold)")
	port := fl.Int("port", DefaultPort, "loopback port")
	noBrowser := fl.Bool("no-browser", false, "do not open a window; print the address")
	stayOpen := fl.Bool("stay-open", false, "keep running after the app window closes")
	if err := fl.Parse(args); err != nil {
		return err
	}
	dir, err := dataDir(*data)
	if err != nil {
		return err
	}
	st, err := store.Open(dir, 30)
	if err != nil {
		return fmt.Errorf("cannot use the data folder %s: %w", dir, err)
	}
	instPath := filepath.Join(dir, "instance.json")

	// Already running? Then just show its window.
	if inst, ok := runningInstance(instPath); ok {
		url := appURL(inst.Port, inst.Token)
		if *noBrowser {
			fmt.Println(url)
			return nil
		}
		return openApp(url)
	}

	ln, err := net.Listen("tcp", net.JoinHostPort("127.0.0.1", strconv.Itoa(*port)))
	if err != nil {
		ln, err = net.Listen("tcp", "127.0.0.1:0")
		if err != nil {
			return err
		}
	}
	p := ln.Addr().(*net.TCPAddr).Port
	tok := randomToken()
	b, _ := json.Marshal(instanceInfo{PID: os.Getpid(), Port: p, Token: tok})
	if err := store.WriteFileAtomic(instPath, b, 0o600); err != nil {
		return err
	}
	defer os.Remove(instPath)

	static, err := api.NewStatic(webFS())
	if err != nil {
		return err
	}
	var last atomic.Int64
	last.Store(time.Now().Unix())
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	h := api.NewDesktop(api.DesktopConfig{
		Store:    st,
		Token:    tok,
		Hosts:    []string{fmt.Sprintf("127.0.0.1:%d", p), fmt.Sprintf("localhost:%d", p)},
		Static:   static,
		Activity: func() { last.Store(time.Now().Unix()) },
		Quit:     func() { time.Sleep(200 * time.Millisecond); cancel() },
	})
	hs := &http.Server{Handler: h, ReadHeaderTimeout: 10 * time.Second, IdleTimeout: 120 * time.Second}
	errc := make(chan error, 1)
	go func() { errc <- hs.Serve(ln) }()

	url := appURL(p, tok)
	if *noBrowser {
		fmt.Printf("Keyhold is running at %s\nVault folder: %s\nPress Ctrl+C to stop.\n", url, dir)
	} else if err := openApp(url); err != nil {
		showError("Keyhold", "Could not open a browser window. Open this address yourself:\n\n"+url)
	}

	// The app window sends a heartbeat; when it has been quiet for a while the
	// window is gone and this process ends. Background tabs are throttled to
	// about one timer per minute, so the limit is generous.
	if !*stayOpen && !*noBrowser {
		go func() {
			for {
				select {
				case <-ctx.Done():
					return
				case <-time.After(15 * time.Second):
					if time.Since(time.Unix(last.Load(), 0)) > 4*time.Minute {
						cancel()
						return
					}
				}
			}
		}()
	}
	select {
	case err := <-errc:
		if !errors.Is(err, http.ErrServerClosed) {
			return err
		}
	case <-ctx.Done():
	case <-interrupted():
	}
	sctx, c2 := context.WithTimeout(context.Background(), 3*time.Second)
	defer c2()
	return hs.Shutdown(sctx)
}

func appURL(port int, token string) string {
	return fmt.Sprintf("http://127.0.0.1:%d/#t=%s", port, token)
}

func randomToken() string {
	b := make([]byte, 24)
	rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}

func runningInstance(path string) (instanceInfo, bool) {
	var inst instanceInfo
	b, err := os.ReadFile(path)
	if err != nil || json.Unmarshal(b, &inst) != nil || inst.Port == 0 {
		return inst, false
	}
	req, _ := http.NewRequest("POST", fmt.Sprintf("http://127.0.0.1:%d/api/local/heartbeat", inst.Port), nil)
	req.Header.Set("Authorization", "Bearer "+inst.Token)
	cl := &http.Client{Timeout: 2 * time.Second}
	resp, err := cl.Do(req)
	if err != nil {
		return inst, false
	}
	resp.Body.Close()
	return inst, resp.StatusCode == 200
}
