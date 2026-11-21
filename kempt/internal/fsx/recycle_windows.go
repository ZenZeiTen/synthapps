//go:build windows

package fsx

import (
	"errors"
	"fmt"
	"syscall"
	"unsafe"
)

var (
	shell32               = syscall.NewLazyDLL("shell32.dll")
	procSHFileOperationW  = shell32.NewProc("SHFileOperationW")
	procSHQueryRecycleBin = shell32.NewProc("SHQueryRecycleBinW")
	procSHEmptyRecycleBin = shell32.NewProc("SHEmptyRecycleBinW")
)

// shFileOpStruct is SHFILEOPSTRUCTW. On 64-bit Windows the header packs it
// with 8-byte alignment, which matches Go's natural layout.
type shFileOpStruct struct {
	hwnd          uintptr
	wFunc         uint32
	pFrom         *uint16
	pTo           *uint16
	fFlags        uint16
	anyAborted    int32
	nameMappings  uintptr
	progressTitle *uint16
}

const (
	foDelete          = 3
	fofSilent         = 0x0004
	fofNoConfirmation = 0x0010
	fofAllowUndo      = 0x0040
	fofNoErrorUI      = 0x0400
)

// Recycle moves one file to the Recycle Bin.
func Recycle(path string) error {
	if err := checkRecyclable(path); err != nil {
		return err
	}
	// pFrom is a list of names ending with an extra NUL.
	u, err := syscall.UTF16FromString(path)
	if err != nil {
		return err
	}
	u = append(u, 0)
	op := shFileOpStruct{
		wFunc:  foDelete,
		pFrom:  &u[0],
		fFlags: fofAllowUndo | fofNoConfirmation | fofSilent | fofNoErrorUI,
	}
	r, _, _ := procSHFileOperationW.Call(uintptr(unsafe.Pointer(&op)))
	if r != 0 {
		return fmt.Errorf("Windows could not move it to the Recycle Bin (code 0x%x)", r)
	}
	if op.anyAborted != 0 {
		return errors.New("cancelled")
	}
	return nil
}

type shQueryRBInfo struct {
	cbSize   uint32
	_        uint32
	size     int64
	numItems int64
}

// RecycleBinSize returns the bytes and items in the Recycle Bins of all drives.
func RecycleBinSize() (bytes int64, items int64, err error) {
	info := shQueryRBInfo{cbSize: uint32(unsafe.Sizeof(shQueryRBInfo{}))}
	r, _, _ := procSHQueryRecycleBin.Call(0, uintptr(unsafe.Pointer(&info)))
	if r != 0 {
		return 0, 0, fmt.Errorf("could not read the Recycle Bin (code 0x%x)", r)
	}
	return info.size, info.numItems, nil
}

const (
	sherbNoConfirmation = 0x1
	sherbNoProgressUI   = 0x2
	sherbNoSound        = 0x4
)

// EmptyRecycleBin empties the Recycle Bins of all drives.
func EmptyRecycleBin() error {
	r, _, _ := procSHEmptyRecycleBin.Call(0, 0, sherbNoConfirmation|sherbNoProgressUI|sherbNoSound)
	// S_OK, or E_UNEXPECTED (0x8000FFFF) when it is already empty.
	if r != 0 && r != 0x8000FFFF {
		return fmt.Errorf("could not empty the Recycle Bin (code 0x%x)", r)
	}
	return nil
}
