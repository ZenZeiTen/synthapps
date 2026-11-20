package jobs

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestJobs(t *testing.T) {
	m := New()
	release := make(chan struct{})
	id := m.Start("scan", func() any { return 7 }, func(ctx context.Context) (any, error) {
		<-release
		return "ok", nil
	})
	if again := m.Start("scan", nil, func(ctx context.Context) (any, error) { return nil, nil }); again != id {
		t.Fatal("second job of the same kind started")
	}
	if v, _ := m.Get(id); v.State != "running" || v.Progress != 7 {
		t.Fatalf("running view %+v", v)
	}
	close(release)
	if v := m.Wait(id); v.State != "done" || v.Result != "ok" {
		t.Fatalf("done view %+v", v)
	}
	f := m.Wait(m.Start("x", nil, func(ctx context.Context) (any, error) { return nil, errors.New("boom") }))
	if f.State != "failed" || f.Error != "boom" {
		t.Fatalf("failed view %+v", f)
	}
	p := m.Wait(m.Start("p", nil, func(ctx context.Context) (any, error) { panic("oops") }))
	if p.State != "failed" {
		t.Fatalf("panic view %+v", p)
	}
	c := m.Start("c", nil, func(ctx context.Context) (any, error) {
		select {
		case <-ctx.Done():
		case <-time.After(5 * time.Second):
		}
		return nil, ctx.Err()
	})
	m.Cancel(c)
	if v := m.Wait(c); v.State != "stopped" {
		t.Fatalf("cancel view %+v", v)
	}
}
