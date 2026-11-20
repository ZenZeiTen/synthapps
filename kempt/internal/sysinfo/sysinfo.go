// Package sysinfo reads basic facts about the computer: drives and free
// space, memory, uptime and whether Kempt runs as administrator.
package sysinfo

// Drive is one fixed drive or mounted file system.
type Drive struct {
	Path  string `json:"path"`
	Label string `json:"label,omitempty"`
	Total int64  `json:"total"`
	Free  int64  `json:"free"`
}

// Memory is physical memory in bytes.
type Memory struct {
	Total     int64 `json:"total"`
	Available int64 `json:"available"`
}
