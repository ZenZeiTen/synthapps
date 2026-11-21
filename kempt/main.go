// Command kempt keeps a Windows PC tidy without the snake oil: it removes
// caches and leftovers, finds large and duplicate files, manages startup
// programs, updates apps with winget and checks the computer's health.
//
//	kempt                  open the Kempt window
//	kempt scan             show how much each kind of cache holds
//	kempt clean [--yes]    remove it (without --yes, only shows what would go)
//	kempt care             what automatic care runs: clean the chosen kinds
//	kempt health           run a checkup
//	kempt startup          list startup programs
//	kempt updates          list programs with updates (winget)
//	kempt version
package main

import (
	"context"
	"embed"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io/fs"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"strings"
	"text/tabwriter"

	"github.com/ZenZeiTen/synthapps/kempt/internal/api"
	"github.com/ZenZeiTen/synthapps/kempt/internal/apps"
	"github.com/ZenZeiTen/synthapps/kempt/internal/clean"
	"github.com/ZenZeiTen/synthapps/kempt/internal/fsx"
	"github.com/ZenZeiTen/synthapps/kempt/internal/health"
	"github.com/ZenZeiTen/synthapps/kempt/internal/journal"
	"github.com/ZenZeiTen/synthapps/kempt/internal/startup"
	"github.com/ZenZeiTen/synthapps/kempt/internal/sysinfo"
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
	case "scan":
		err = runScan(args)
	case "clean":
		err = runClean(args)
	case "care":
		err = runCare(args)
	case "health":
		err = runHealth(args)
	case "startup":
		err = runStartup(args)
	case "updates":
		err = runUpdates(args)
	case "recycle":
		err = runRecycle(args)
	case "version", "--version":
		fmt.Println("Kempt", version)
	case "help", "-h", "--help":
		usage()
	default:
		usage()
		os.Exit(2)
	}
	if errors.Is(err, flag.ErrHelp) {
		return
	}
	if err != nil {
		fatal(err)
	}
}

func usage() {
	fmt.Fprint(os.Stderr, `Kempt `+version+` - honest PC care

Usage:
  kempt [desktop] [--data DIR] [--port N] [--no-browser] [--stay-open]
        Open the Kempt window.
  kempt scan [--json]
        Show how much each kind of cache and leftover holds.
  kempt clean [--only ID,ID] [--yes]
        Remove them. Without --yes this only lists what would be removed.
  kempt care [--data DIR]
        Clean the kinds chosen for automatic care (what the scheduled task runs).
  kempt health [--json]      Run a checkup.
  kempt startup [--json]     List startup programs.
  kempt updates [--json]     List programs with a newer version (winget).
  kempt recycle FILE...      Move files to the Recycle Bin.
  kempt version
`)
}

func fatal(err error) {
	if guiBuild == "1" {
		showError("Kempt", err.Error())
	} else {
		fmt.Fprintln(os.Stderr, "kempt:", err)
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

// dataDir picks the folder for Kempt's own files: settings, the journal and
// the browser profile of its window. It holds nothing secret.
func dataDir(flagVal string) (string, error) {
	if flagVal != "" {
		return filepath.Abs(flagVal)
	}
	if v := os.Getenv("KEMPT_HOME"); v != "" {
		return filepath.Abs(v)
	}
	if runtime.GOOS == "windows" {
		if a := os.Getenv("LOCALAPPDATA"); a != "" {
			return filepath.Join(a, "Kempt"), nil
		}
	}
	base, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(base, "kempt"), nil
}

func interruptible() (context.Context, context.CancelFunc) {
	return signal.NotifyContext(context.Background(), os.Interrupt)
}

func printJSON(v any) error {
	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	return enc.Encode(v)
}

func table() *tabwriter.Writer { return tabwriter.NewWriter(os.Stdout, 2, 4, 2, ' ', 0) }

var statusText = map[string]string{
	"ready": "", "empty": "nothing to remove", "in-use": "close the program first",
	"admin": "needs administrator", "missing": "not found",
}

func runScan(args []string) error {
	fl := flag.NewFlagSet("scan", flag.ContinueOnError)
	asJSON := fl.Bool("json", false, "print JSON")
	if err := fl.Parse(args); err != nil {
		return err
	}
	ctx, cancel := interruptible()
	defer cancel()
	e := clean.NewEngine(sysinfo.Elevated())
	scans := e.ScanAll(ctx, nil)
	if *asJSON {
		return printJSON(scans)
	}
	tw := table()
	var total int64
	fmt.Fprintln(tw, "ID\tWHAT\tSIZE\tFILES\tNOTE")
	for _, s := range scans {
		c, _ := e.Find(s.ID)
		fmt.Fprintf(tw, "%s\t%s\t%s\t%d\t%s\n", s.ID, c.Name, health.GB(s.Bytes), s.Files, statusText[s.Status])
		if s.Status == "ready" && c.Kind != "bin" {
			total += s.Bytes
		}
	}
	tw.Flush()
	fmt.Printf("\n%s can be removed now (not counting the Recycle Bin).\n", health.GB(total))
	return nil
}

func runClean(args []string) error {
	fl := flag.NewFlagSet("clean", flag.ContinueOnError)
	only := fl.String("only", "", "comma-separated category ids (default: the usual safe set)")
	yes := fl.Bool("yes", false, "really remove the files")
	data := fl.String("data", "", "Kempt's data folder, for the journal")
	if err := fl.Parse(args); err != nil {
		return err
	}
	e := clean.NewEngine(sysinfo.Elevated())
	ids := e.DefaultIDs()
	if *only != "" {
		ids = strings.Split(*only, ",")
	}
	ctx, cancel := interruptible()
	defer cancel()
	if !*yes {
		fmt.Println("Nothing is removed without --yes. This is what would go:")
		tw := table()
		for _, id := range ids {
			c, ok := e.Find(strings.TrimSpace(id))
			if !ok {
				return fmt.Errorf("unknown category %q (see kempt scan)", id)
			}
			s := e.ScanOne(ctx, c, nil)
			fmt.Fprintf(tw, "%s\t%s\t%d files\t%s\n", c.Name, health.GB(s.Bytes), s.Files, statusText[s.Status])
		}
		return tw.Flush()
	}
	dir, err := dataDir(*data)
	if err != nil {
		return err
	}
	res, err := api.Clean(ctx, e, journal.Open(dir), ids, false, nil)
	for _, r := range res {
		c, _ := e.Find(r.ID)
		fmt.Printf("%-34s %9s  %d removed, %d skipped %s\n", c.Name, health.GB(r.Freed), r.Removed, r.Skipped, statusText[r.Status])
	}
	return err
}

// runCare is what the scheduled task starts. It cleans only the chosen
// kinds, skips anything in use, and writes the result to the journal.
func runCare(args []string) error {
	fl := flag.NewFlagSet("care", flag.ContinueOnError)
	data := fl.String("data", "", "Kempt's data folder")
	if err := fl.Parse(args); err != nil {
		return err
	}
	dir, err := dataDir(*data)
	if err != nil {
		return err
	}
	e := clean.NewEngine(sysinfo.Elevated())
	ids := api.CareIDs(e, api.LoadSettings(dir))
	ctx, cancel := interruptible()
	defer cancel()
	_, err = api.Clean(ctx, e, journal.Open(dir), ids, true, nil)
	return err
}

func runHealth(args []string) error {
	fl := flag.NewFlagSet("health", flag.ContinueOnError)
	asJSON := fl.Bool("json", false, "print JSON")
	if err := fl.Parse(args); err != nil {
		return err
	}
	ctx, cancel := interruptible()
	defer cancel()
	rep := health.Check(ctx, "en")
	if *asJSON {
		return printJSON(rep)
	}
	mark := map[string]string{health.Good: "ok", health.Attention: "!", health.Problem: "!!", health.Info: "i"}
	for _, f := range rep.Findings {
		fmt.Printf("[%s] %s: %s\n", mark[f.Status], f.Title, f.Detail)
		if f.Advice != "" && f.Status != health.Good {
			fmt.Printf("     %s\n", f.Advice)
		}
	}
	return nil
}

func runStartup(args []string) error {
	fl := flag.NewFlagSet("startup", flag.ContinueOnError)
	asJSON := fl.Bool("json", false, "print JSON")
	if err := fl.Parse(args); err != nil {
		return err
	}
	items, err := startup.New(sysinfo.Elevated()).List(context.Background())
	if err != nil {
		return err
	}
	if *asJSON {
		if items == nil {
			items = []startup.Item{}
		}
		return printJSON(items)
	}
	tw := table()
	fmt.Fprintln(tw, "ON\tNAME\tPUBLISHER\tWHERE")
	for _, it := range items {
		on := "no"
		if it.Enabled {
			on = "yes"
		}
		fmt.Fprintf(tw, "%s\t%s\t%s\t%s\n", on, it.Name, it.Publisher, it.Where)
	}
	return tw.Flush()
}

func runUpdates(args []string) error {
	fl := flag.NewFlagSet("updates", flag.ContinueOnError)
	asJSON := fl.Bool("json", false, "print JSON")
	if err := fl.Parse(args); err != nil {
		return err
	}
	ctx, cancel := interruptible()
	defer cancel()
	ups, err := apps.List(ctx)
	if err != nil {
		return err
	}
	if *asJSON {
		if ups == nil {
			ups = []apps.Update{}
		}
		return printJSON(ups)
	}
	tw := table()
	fmt.Fprintln(tw, "NAME\tID\tINSTALLED\tAVAILABLE")
	for _, u := range ups {
		fmt.Fprintf(tw, "%s\t%s\t%s\t%s\n", u.Name, u.ID, u.Version, u.Available)
	}
	return tw.Flush()
}

func runRecycle(args []string) error {
	if len(args) == 0 {
		return errors.New("give the files to move to the Recycle Bin")
	}
	for _, a := range args {
		p, err := filepath.Abs(a)
		if err != nil {
			return err
		}
		if err := fsx.Recycle(p); err != nil {
			return fmt.Errorf("%s: %w", a, err)
		}
		fmt.Println("moved to the Recycle Bin:", p)
	}
	return nil
}
