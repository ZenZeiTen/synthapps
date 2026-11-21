// Package clean finds and removes files that programs keep only as a
// cache or a leftover: temporary files, browser caches, crash dumps, error
// reports, thumbnail caches and the Recycle Bin. Each kind is a Category
// with a plain explanation of what it is, why removing it is safe, and what
// the cost is.
package clean

import (
	"os"
	"path/filepath"
	"runtime"
	"time"

	"github.com/ZenZeiTen/synthapps/kempt/internal/i18n"
)

// Category is one kind of removable file.
type Category struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Group string `json:"group"` // "system", "browsers", "bin"
	// What it is, why removing it is safe, and what you give up.
	What string `json:"what"`
	Safe string `json:"safe"`
	Cost string `json:"cost,omitempty"`
	// Roots are folders searched for files. Patterns are expanded with
	// filepath.Glob when the category is scanned.
	Roots []string `json:"-"`
	// Match, if set, limits files to these base-name patterns.
	Match []string `json:"-"`
	// MinAge leaves recent files alone: a program may still be using them.
	MinAge     time.Duration `json:"-"`
	MinAgeDays int           `json:"minAgeDays"`
	Admin      bool          `json:"admin"`
	// Locks are files that exist only while the owning program runs
	// (relative to each root's glob match parent, see lockPaths).
	Locks []string `json:"-"`
	App   string   `json:"app,omitempty"` // program to close first
	// Default categories are included in one-click and automatic care.
	Default bool `json:"default"`
	// Kind "bin" is the Recycle Bin (or trash), emptied as a whole.
	Kind string `json:"kind"`
	// text is the catalog key stem (cat.<text>.name ...); default the ID.
	text string
}

// Env is where the catalog looks up folders. Tests replace it.
type Env struct {
	GOOS   string
	Home   string
	Getenv func(string) string
}

// SystemEnv is the real environment.
func SystemEnv() Env {
	h, _ := os.UserHomeDir()
	return Env{GOOS: runtime.GOOS, Home: h, Getenv: os.Getenv}
}

const day = 24 * time.Hour

// TextKey is the catalog key stem of a category's text (cat.<stem>.name).
func TextKey(c Category) string {
	if c.text != "" {
		return c.text
	}
	return c.ID
}

// Catalog lists the categories that exist on this kind of system, in English.
func Catalog(env Env) []Category { return CatalogIn(env, "en") }

// CatalogIn lists the categories with their text in a language.
func CatalogIn(env Env, lang string) []Category {
	var cs []Category
	if env.GOOS == "windows" {
		cs = windowsCatalog(env)
	} else {
		cs = unixCatalog(env)
	}
	for i := range cs {
		c := &cs[i]
		tk, browser := c.text, c.App
		if tk == "" {
			tk = c.ID
		}
		c.Name = i18n.T(lang, "cat."+tk+".name", "browser", browser)
		c.What = i18n.T(lang, "cat."+tk+".what", "browser", browser)
		c.Safe = i18n.T(lang, "cat."+tk+".safe", "browser", browser)
		if k := "cat." + tk + ".cost"; i18n.Has(k) {
			c.Cost = i18n.T(lang, k, "browser", browser)
		}
		cs[i].MinAgeDays = int(cs[i].MinAge / day)
		if cs[i].Kind == "" {
			cs[i].Kind = "files"
		}
	}
	return cs
}

// chromium returns the cache folders of a Chromium-based browser whose
// "User Data" folder is base, for every profile.
func chromium(base string) []string {
	var r []string
	for _, prof := range []string{"Default", "Profile *", "Guest Profile"} {
		for _, sub := range []string{
			filepath.Join("Cache", "Cache_Data"),
			"Code Cache",
			"GPUCache",
			filepath.Join("Service Worker", "CacheStorage"),
		} {
			r = append(r, filepath.Join(base, prof, sub))
		}
	}
	return append(r, filepath.Join(base, "ShaderCache"), filepath.Join(base, "GrShaderCache"))
}

func windowsCatalog(env Env) []Category {
	local := env.Getenv("LOCALAPPDATA")
	if local == "" {
		local = filepath.Join(env.Home, "AppData", "Local")
	}
	temp := env.Getenv("TEMP")
	if temp == "" {
		temp = filepath.Join(local, "Temp")
	}
	sysroot := env.Getenv("SystemRoot")
	if sysroot == "" {
		sysroot = `C:\Windows`
	}
	progdata := env.Getenv("ProgramData")
	if progdata == "" {
		progdata = `C:\ProgramData`
	}
	return []Category{
		{
			ID: "user-temp", Group: "system", Default: true,
			Roots: []string{temp}, MinAge: 2 * day,
		},
		{
			ID: "windows-temp", Group: "system", Default: true, Admin: true,
			Roots: []string{filepath.Join(sysroot, "Temp")}, MinAge: 2 * day,
		},
		{
			ID: "crash-dumps", Group: "system", Default: true,
			Roots: []string{filepath.Join(local, "CrashDumps")}, MinAge: 7 * day,
		},
		{
			ID: "error-reports", Group: "system", Default: true,
			Roots: []string{
				filepath.Join(local, "Microsoft", "Windows", "WER", "ReportArchive"),
				filepath.Join(local, "Microsoft", "Windows", "WER", "ReportQueue"),
			}, MinAge: 7 * day,
		},
		{
			ID: "error-reports-all", Group: "system", Default: true, Admin: true,
			Roots: []string{
				filepath.Join(progdata, "Microsoft", "Windows", "WER", "ReportArchive"),
				filepath.Join(progdata, "Microsoft", "Windows", "WER", "ReportQueue"),
			}, MinAge: 7 * day,
		},
		{
			ID: "thumbnails", text: "thumbnails-win", Group: "system",
			Roots: []string{filepath.Join(local, "Microsoft", "Windows", "Explorer")},
			Match: []string{"thumbcache_*.db", "iconcache_*.db"},
		},
		{
			ID: "chrome", text: "browser", Group: "browsers", Default: true, App: "Google Chrome",
			Roots: chromium(filepath.Join(local, "Google", "Chrome", "User Data")),
			Locks: []string{filepath.Join(local, "Google", "Chrome", "User Data", "lockfile")},
		},
		{
			ID: "edge", text: "browser", Group: "browsers", Default: true, App: "Microsoft Edge",
			Roots: chromium(filepath.Join(local, "Microsoft", "Edge", "User Data")),
			Locks: []string{filepath.Join(local, "Microsoft", "Edge", "User Data", "lockfile")},
		},
		{
			ID: "brave", text: "browser", Group: "browsers", Default: true, App: "Brave",
			Roots: chromium(filepath.Join(local, "BraveSoftware", "Brave-Browser", "User Data")),
			Locks: []string{filepath.Join(local, "BraveSoftware", "Brave-Browser", "User Data", "lockfile")},
		},
		{
			ID: "firefox", text: "browser", Group: "browsers", Default: true, App: "Firefox",
			Roots: []string{filepath.Join(local, "Mozilla", "Firefox", "Profiles", "*", "cache2")},
			Locks: []string{filepath.Join(env.Getenv("APPDATA"), "Mozilla", "Firefox", "Profiles", "*", "parent.lock")},
		},
		{
			ID: "recycle-bin", Group: "bin", Kind: "bin",
		},
	}
}

func unixCatalog(env Env) []Category {
	cache := env.Getenv("XDG_CACHE_HOME")
	if cache == "" {
		cache = filepath.Join(env.Home, ".cache")
	}
	config := env.Getenv("XDG_CONFIG_HOME")
	if config == "" {
		config = filepath.Join(env.Home, ".config")
	}
	chromeLike := func(id, name, dir string) Category {
		return Category{
			ID: id, text: "browser", Group: "browsers", Default: true, App: name,
			Roots: []string{
				filepath.Join(cache, dir, "*", "Cache"),
				filepath.Join(cache, dir, "*", "Code Cache"),
			},
			Locks: []string{filepath.Join(config, dir, "SingletonLock")},
		}
	}
	return []Category{
		{
			ID: "thumbnails", text: "thumbnails-unix", Group: "system", Default: true,
			Roots: []string{filepath.Join(cache, "thumbnails")}, MinAge: 30 * day,
		},
		chromeLike("chrome", "Google Chrome", "google-chrome"),
		chromeLike("chromium", "Chromium", "chromium"),
		{
			ID: "firefox", text: "browser", Group: "browsers", Default: true, App: "Firefox",
			Roots: []string{filepath.Join(cache, "mozilla", "firefox", "*", "cache2")},
			Locks: []string{filepath.Join(env.Home, ".mozilla", "firefox", "*", "lock")},
		},
		{
			ID: "recycle-bin", text: "trash", Group: "bin", Kind: "bin",
		},
	}
}
