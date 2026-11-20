// Package jobs runs long tasks (scans, cleaning, searches, updates) in the
// background so the window can show progress and stay responsive.
package jobs

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"sync"
	"time"
)

// View is what the window sees of a job.
type View struct {
	ID       string  `json:"id"`
	Kind     string  `json:"kind"`
	State    string  `json:"state"` // running, done, failed, stopped
	Progress any     `json:"progress,omitempty"`
	Result   any     `json:"result,omitempty"`
	Error    string  `json:"error,omitempty"`
	Seconds  float64 `json:"seconds"`
}

type job struct {
	View
	started  time.Time
	ended    time.Time
	progress func() any
	cancel   context.CancelFunc
}

// Manager keeps the running and recent jobs.
type Manager struct {
	mu    sync.Mutex
	jobs  map[string]*job
	order []string
}

// New returns an empty manager.
func New() *Manager { return &Manager{jobs: map[string]*job{}} }

// Start runs fn in the background. Only one job of each kind runs at a time:
// starting a kind that is already running returns the running job's id.
func (m *Manager) Start(kind string, progress func() any, fn func(ctx context.Context) (any, error)) string {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, id := range m.order {
		if j := m.jobs[id]; j.Kind == kind && j.State == "running" {
			return id
		}
	}
	b := make([]byte, 8)
	rand.Read(b)
	id := hex.EncodeToString(b)
	ctx, cancel := context.WithCancel(context.Background())
	j := &job{View: View{ID: id, Kind: kind, State: "running"}, started: time.Now(), progress: progress, cancel: cancel}
	m.jobs[id] = j
	m.order = append(m.order, id)
	m.trim()
	go func() {
		var res any
		var err error
		func() {
			defer func() {
				if r := recover(); r != nil {
					err = fmt.Errorf("internal error: %v", r)
				}
			}()
			res, err = fn(ctx)
		}()
		m.mu.Lock()
		defer m.mu.Unlock()
		j.Result, j.ended = res, time.Now()
		switch {
		case ctx.Err() != nil:
			j.State = "stopped"
		case err != nil:
			j.State, j.Error = "failed", err.Error()
		default:
			j.State = "done"
		}
		cancel()
	}()
	return id
}

// trim forgets old finished jobs; the caller holds the lock.
func (m *Manager) trim() {
	for len(m.order) > 30 {
		id := m.order[0]
		if m.jobs[id].State == "running" {
			return
		}
		delete(m.jobs, id)
		m.order = m.order[1:]
	}
}

// Get returns a job's current state.
func (m *Manager) Get(id string) (View, bool) {
	m.mu.Lock()
	j, ok := m.jobs[id]
	if !ok {
		m.mu.Unlock()
		return View{}, false
	}
	v := j.View
	end := j.ended
	prog := j.progress
	if end.IsZero() {
		end = time.Now()
	}
	v.Seconds = end.Sub(j.started).Seconds()
	m.mu.Unlock()
	if prog != nil {
		v.Progress = prog()
	}
	return v, true
}

// Cancel asks a job to stop.
func (m *Manager) Cancel(id string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	j, ok := m.jobs[id]
	if !ok {
		return errors.New("no such job")
	}
	j.cancel()
	return nil
}

// Wait blocks until the job ends (for the command line and tests).
func (m *Manager) Wait(id string) View {
	for {
		v, ok := m.Get(id)
		if !ok || v.State != "running" {
			return v
		}
		time.Sleep(20 * time.Millisecond)
	}
}
