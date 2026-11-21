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

	"github.com/ZenZeiTen/synthapps/kempt/internal/api"
	"github.com/ZenZeiTen/synthapps/kempt/internal/autostart"
	"github.com/ZenZeiTen/synthapps/kempt/internal/clean"
	"github.com/ZenZeiTen/synthapps/kempt/internal/jobs"
	"github.com/ZenZeiTen/synthapps/kempt/internal/journal"
	"github.com/ZenZeiTen/synthapps/kempt/internal/startup"
	"github.com/ZenZeiTen/synthapps/kempt/internal/sysinfo"
)

// DefaultPort is fixed so the window's address stays the same between launches.
const DefaultPort = 47831

type instanceInfo struct {
	PID   int    `json:"pid"`
	Port  int    `json:"port"`
	Token string `json:"token"`
}

func runDesktop(args []string) error {
	fl := flag.NewFlagSet("desktop", flag.ContinueOnError)
	data := fl.String("data", "", "folder for Kempt's settings and journal (default: %LOCALAPPDATA%\\Kempt or ~/.config/kempt)")
	port := fl.Int("port", DefaultPort, "loopback port")
	noBrowser := fl.Bool("no-browser", false, "do not open a window; print the address")
	stayOpen := fl.Bool("stay-open", false, "keep running after the window closes")
	atStartup := fl.Bool("startup", false, "Kempt was started by signing in (set by \"Start at Windows startup\")")
	afterRestart := fl.Bool("after-restart", false, "wait for the previous Kempt to close (used when restarting as administrator)")
	if err := fl.Parse(args); err != nil {
		return err
	}
	dir, err := dataDir(*data)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return fmt.Errorf("cannot use the data folder %s: %w", dir, err)
	}
	instPath := filepath.Join(dir, "instance.json")

	if *afterRestart {
		for i := 0; i < 40; i++ {
			if _, ok := runningInstance(instPath); !ok {
				break
			}
			time.Sleep(250 * time.Millisecond)
		}
	} else if inst, ok := runningInstance(instPath); ok {
		// Already running: show its window.
		url := appURL(inst.Port, inst.Token)
		if *noBrowser {
			fmt.Println(url)
			return nil
		}
		return openApp(url, dir, false)
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
	if err := writeFileAtomic(instPath, b); err != nil {
		return err
	}
	defer os.Remove(instPath)

	static, err := api.NewStatic(webFS())
	if err != nil {
		return err
	}
	exe, _ := os.Executable()
	elevated := sysinfo.Elevated()
	var last atomic.Int64
	last.Store(time.Now().Unix())
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	h := api.NewDesktop(api.Config{
		DataDir: dir, Token: tok, Static: static, Elevated: elevated, Exe: guiExe(exe),
		Hosts:     []string{fmt.Sprintf("127.0.0.1:%d", p), fmt.Sprintf("localhost:%d", p)},
		Engine:    clean.NewEngine(elevated),
		Startup:   startup.New(elevated),
		Journal:   journal.Open(dir),
		Jobs:      jobs.New(),
		Activity:  func() { last.Store(time.Now().Unix()) },
		Quit:      func() { time.Sleep(200 * time.Millisecond); cancel() },
		Elevate:   func() error { return elevate(exe, []string{"desktop", "--after-restart", "--data", dir}) },
		Autostart: autostart.New(), CanMinimize: canMinimize,
		Open:   openTarget,
		Reveal: reveal,
	})
	hs := &http.Server{Handler: h, ReadHeaderTimeout: 10 * time.Second, IdleTimeout: 120 * time.Second}
	errc := make(chan error, 1)
	go func() { errc <- hs.Serve(ln) }()

	url := appURL(p, tok)
	if *noBrowser {
		fmt.Printf("Kempt is running at %s\nData folder: %s\nPress Ctrl+C to stop.\n", url, dir)
	} else if err := openApp(url, dir, *atStartup && api.LoadSettings(dir).StartMinimized); err != nil {
		showError("Kempt", "Could not open a window. Open this address in your browser:\n\n"+url)
	}

	// The window sends a heartbeat; when it has been quiet for a while it is
	// gone and Kempt ends. Background tabs are throttled, so the limit is generous.
	if !*stayOpen && !*noBrowser {
		go func() {
			for {
				select {
				case <-ctx.Done():
					return
				case <-time.After(15 * time.Second):
					if time.Since(time.Unix(last.Load(), 0)) > 3*time.Minute {
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

func writeFileAtomic(path string, b []byte) error {
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, path)
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

// guiExe is the program the scheduled task starts. When this is the command
// line build next to Kempt.exe, the task uses Kempt.exe so no console
// window flashes up.
func guiExe(exe string) string {
	if filepath.Base(exe) == "kempt-cli.exe" {
		g := filepath.Join(filepath.Dir(exe), "Kempt.exe")
		if _, err := os.Stat(g); err == nil {
			return g
		}
	}
	return exe
}
