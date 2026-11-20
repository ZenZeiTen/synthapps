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

// Catalog lists the categories that exist on this kind of system.
func Catalog(env Env) []Category {
	var cs []Category
	if env.GOOS == "windows" {
		cs = windowsCatalog(env)
	} else {
		cs = unixCatalog(env)
	}
	for i := range cs {
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
	browserSafe := "The browser rebuilds its cache as you browse. History, passwords, cookies, open tabs and sign-ins are not touched."
	browserCost := "Sites you visit often load a little slower the first time afterwards."
	return []Category{
		{
			ID: "user-temp", Name: "Your temporary files", Group: "system", Default: true,
			Roots: []string{temp}, MinAge: 2 * day,
			What: "Files programs and installers leave in your Temp folder.",
			Safe: "Only files untouched for 2 days are removed, and files a program still holds open are skipped.",
		},
		{
			ID: "windows-temp", Name: "Windows temporary files", Group: "system", Default: true, Admin: true,
			Roots: []string{filepath.Join(sysroot, "Temp")}, MinAge: 2 * day,
			What: "Files Windows services and installers leave in the Windows Temp folder.",
			Safe: "Only files untouched for 2 days are removed, and files in use are skipped.",
		},
		{
			ID: "crash-dumps", Name: "Crash dumps", Group: "system", Default: true,
			Roots: []string{filepath.Join(local, "CrashDumps")}, MinAge: 7 * day,
			What: "Memory snapshots saved when a program crashed.",
			Safe: "They are only useful to a developer investigating that crash. Dumps from the last 7 days are kept in case you want to report one.",
		},
		{
			ID: "error-reports", Name: "Windows error reports", Group: "system", Default: true,
			Roots: []string{
				filepath.Join(local, "Microsoft", "Windows", "WER", "ReportArchive"),
				filepath.Join(local, "Microsoft", "Windows", "WER", "ReportQueue"),
			}, MinAge: 7 * day,
			What: "Problem reports Windows collected about programs that stopped working.",
			Safe: "Reports already sent or older than 7 days are not needed again. Reliability Monitor keeps its own summary.",
		},
		{
			ID: "error-reports-all", Name: "Windows error reports (all users)", Group: "system", Default: true, Admin: true,
			Roots: []string{
				filepath.Join(progdata, "Microsoft", "Windows", "WER", "ReportArchive"),
				filepath.Join(progdata, "Microsoft", "Windows", "WER", "ReportQueue"),
			}, MinAge: 7 * day,
			What: "Problem reports collected for services and other users.",
			Safe: "Reports older than 7 days are not needed again.",
		},
		{
			ID: "thumbnails", Name: "Thumbnail cache", Group: "system",
			Roots: []string{filepath.Join(local, "Microsoft", "Windows", "Explorer")},
			Match: []string{"thumbcache_*.db", "iconcache_*.db"},
			What:  "Small previews of pictures and videos that File Explorer saved.",
			Safe:  "File Explorer makes them again when you open a folder. Files it holds open are skipped.",
			Cost:  "Folders full of pictures show blank previews for a moment the next time.",
		},
		{
			ID: "chrome", Name: "Google Chrome cache", Group: "browsers", Default: true, App: "Google Chrome",
			Roots: chromium(filepath.Join(local, "Google", "Chrome", "User Data")),
			Locks: []string{filepath.Join(local, "Google", "Chrome", "User Data", "lockfile")},
			What:  "Copies of pages, images and scripts Chrome saved to load sites faster.", Safe: browserSafe, Cost: browserCost,
		},
		{
			ID: "edge", Name: "Microsoft Edge cache", Group: "browsers", Default: true, App: "Microsoft Edge",
			Roots: chromium(filepath.Join(local, "Microsoft", "Edge", "User Data")),
			Locks: []string{filepath.Join(local, "Microsoft", "Edge", "User Data", "lockfile")},
			What:  "Copies of pages, images and scripts Edge saved to load sites faster.", Safe: browserSafe, Cost: browserCost,
		},
		{
			ID: "brave", Name: "Brave cache", Group: "browsers", Default: true, App: "Brave",
			Roots: chromium(filepath.Join(local, "BraveSoftware", "Brave-Browser", "User Data")),
			Locks: []string{filepath.Join(local, "BraveSoftware", "Brave-Browser", "User Data", "lockfile")},
			What:  "Copies of pages, images and scripts Brave saved to load sites faster.", Safe: browserSafe, Cost: browserCost,
		},
		{
			ID: "firefox", Name: "Firefox cache", Group: "browsers", Default: true, App: "Firefox",
			Roots: []string{filepath.Join(local, "Mozilla", "Firefox", "Profiles", "*", "cache2")},
			Locks: []string{filepath.Join(env.Getenv("APPDATA"), "Mozilla", "Firefox", "Profiles", "*", "parent.lock")},
			What:  "Copies of pages, images and scripts Firefox saved to load sites faster.", Safe: browserSafe, Cost: browserCost,
		},
		{
			ID: "recycle-bin", Name: "Recycle Bin", Group: "bin", Kind: "bin",
			What: "Files you deleted. They stay in the Recycle Bin until it is emptied.",
			Safe: "Only empty it when you are sure you will not want any of them back.",
			Cost: "Files in it can no longer be restored.",
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
	browserSafe := "The browser rebuilds its cache as you browse. History, passwords, cookies, open tabs and sign-ins are not touched."
	browserCost := "Sites you visit often load a little slower the first time afterwards."
	chromeLike := func(id, name, dir string) Category {
		return Category{
			ID: id, Name: name + " cache", Group: "browsers", Default: true, App: name,
			Roots: []string{
				filepath.Join(cache, dir, "*", "Cache"),
				filepath.Join(cache, dir, "*", "Code Cache"),
			},
			Locks: []string{filepath.Join(config, dir, "SingletonLock")},
			What:  "Copies of pages, images and scripts " + name + " saved to load sites faster.", Safe: browserSafe, Cost: browserCost,
		}
	}
	return []Category{
		{
			ID: "thumbnails", Name: "Thumbnail cache", Group: "system", Default: true,
			Roots: []string{filepath.Join(cache, "thumbnails")}, MinAge: 30 * day,
			What: "Small previews of pictures and videos the file manager saved.",
			Safe: "Previews not looked at for 30 days are removed; they are made again when needed.",
		},
		chromeLike("chrome", "Google Chrome", "google-chrome"),
		chromeLike("chromium", "Chromium", "chromium"),
		{
			ID: "firefox", Name: "Firefox cache", Group: "browsers", Default: true, App: "Firefox",
			Roots: []string{filepath.Join(cache, "mozilla", "firefox", "*", "cache2")},
			Locks: []string{filepath.Join(env.Home, ".mozilla", "firefox", "*", "lock")},
			What:  "Copies of pages, images and scripts Firefox saved to load sites faster.", Safe: browserSafe, Cost: browserCost,
		},
		{
			ID: "recycle-bin", Name: "Trash", Group: "bin", Kind: "bin",
			What: "Files you deleted. They stay in the trash until it is emptied.",
			Safe: "Only empty it when you are sure you will not want any of them back.",
			Cost: "Files in it can no longer be restored.",
		},
	}
}
