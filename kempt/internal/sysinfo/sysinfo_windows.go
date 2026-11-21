//go:build windows

package sysinfo

import (
	"syscall"
	"time"
	"unsafe"
)

var (
	kernel32             = syscall.NewLazyDLL("kernel32.dll")
	shell32              = syscall.NewLazyDLL("shell32.dll")
	procGetLogicalDrives = kernel32.NewProc("GetLogicalDrives")
	procGetDriveType     = kernel32.NewProc("GetDriveTypeW")
	procGetDiskFree      = kernel32.NewProc("GetDiskFreeSpaceExW")
	procGetTickCount64   = kernel32.NewProc("GetTickCount64")
	procGlobalMemStatus  = kernel32.NewProc("GlobalMemoryStatusEx")
	procIsUserAnAdmin    = shell32.NewProc("IsUserAnAdmin")
)

const driveFixed = 3

// Drives lists fixed drives (not USB sticks, network or optical drives).
func Drives() []Drive {
	mask, _, _ := procGetLogicalDrives.Call()
	var out []Drive
	for i := 0; i < 26; i++ {
		if mask&(1<<uint(i)) == 0 {
			continue
		}
		root := string(rune('A'+i)) + `:\`
		p, _ := syscall.UTF16PtrFromString(root)
		if t, _, _ := procGetDriveType.Call(uintptr(unsafe.Pointer(p))); t != driveFixed {
			continue
		}
		var free, total, totalFree uint64
		r, _, _ := procGetDiskFree.Call(uintptr(unsafe.Pointer(p)), uintptr(unsafe.Pointer(&free)),
			uintptr(unsafe.Pointer(&total)), uintptr(unsafe.Pointer(&totalFree)))
		if r == 0 {
			continue
		}
		out = append(out, Drive{Path: root, Total: int64(total), Free: int64(free)})
	}
	return out
}

// Uptime is the time since Windows started.
func Uptime() time.Duration {
	ms, _, _ := procGetTickCount64.Call()
	return time.Duration(ms) * time.Millisecond
}

type memoryStatusEx struct {
	length               uint32
	memoryLoad           uint32
	totalPhys            uint64
	availPhys            uint64
	totalPageFile        uint64
	availPageFile        uint64
	totalVirtual         uint64
	availVirtual         uint64
	availExtendedVirtual uint64
}

// Mem reads physical memory.
func Mem() Memory {
	m := memoryStatusEx{length: uint32(unsafe.Sizeof(memoryStatusEx{}))}
	if r, _, _ := procGlobalMemStatus.Call(uintptr(unsafe.Pointer(&m))); r == 0 {
		return Memory{}
	}
	return Memory{Total: int64(m.totalPhys), Available: int64(m.availPhys)}
}

// Elevated reports whether Kempt runs as administrator.
func Elevated() bool {
	r, _, _ := procIsUserAnAdmin.Call()
	return r != 0
}
