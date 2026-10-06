package analyzer

import (
	"context"
	"encoding/json"
	"forrest/backend/pkg/cache"
	"forrest/backend/pkg/models"
	"forrest/backend/pkg/npm"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// fakeRegistry serves packages with a single version 1.0.0.
func fakeRegistry(t *testing.T, deps map[string]map[string]string) (*httptest.Server, *int64) {
	t.Helper()
	var requests int64
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt64(&requests, 1)
		path, _ := url.PathUnescape(strings.TrimPrefix(r.URL.EscapedPath(), "/"))
		name, version := path, ""
		if i := strings.LastIndex(path, "/"); i > 0 {
			name, version = path[:i], path[i+1:]
		}
		d, ok := deps[name]
		if !ok {
			http.NotFound(w, r)
			return
		}
		if version == "" {
			json.NewEncoder(w).Encode(map[string]interface{}{
				"dist-tags": map[string]string{"latest": "1.0.0"},
				"versions":  map[string]interface{}{"1.0.0": map[string]string{}},
			})
			return
		}
		json.NewEncoder(w).Encode(map[string]interface{}{
			"name":         name,
			"version":      "1.0.0",
			"dependencies": d,
			"repository":   "github:example/" + name,
			"license":      map[string]string{"type": "MIT"},
		})
	}))
	t.Cleanup(srv.Close)
	return srv, &requests
}

func newTestAnalyzer(registryURL string) *Analyzer {
	client := npm.NewClient(npm.Config{RegistryURL: registryURL, Timeout: 5 * time.Second})
	pool := NewWorkerPool(4, client, cache.NewLRU[*models.DependencyNode](100, time.Minute))
	return NewAnalyzer(pool)
}

func TestAnalyzeDedupesAndRespectsDepth(t *testing.T) {
	srv, _ := fakeRegistry(t, map[string]map[string]string{
		"a":      {"shared": "^1.0.0", "c": "^1.0.0"},
		"b":      {"shared": "~1.0.0", "alias": "npm:a@^1.0.0"},
		"shared": {"deep": "^1.0.0"},
		"c":      {},
		"deep":   {"deeper": "^1.0.0"},
		"deeper": {},
	})
	a := newTestAnalyzer(srv.URL)

	events := a.Analyze(context.Background(), models.AnalyzeRequest{
		PackageJSON: models.PackageJSON{
			Name:         "root",
			Dependencies: map[string]string{"a": "^1.0.0", "b": "^1.0.0", "missing": "^1.0.0"},
		},
		MaxDepth: 3,
	})

	nodes := map[string]*models.DependencyNode{}
	var errs int
	var last models.ProgressData
	var completed bool
	for ev := range events {
		switch ev.Type {
		case models.EventTypeNode:
			n := ev.Data.(*models.DependencyNode)
			if _, dup := nodes[n.Name]; dup {
				t.Errorf("duplicate node %s", n.Name)
			}
			nodes[n.Name] = n
		case models.EventTypePackageError:
			errs++
		case models.EventTypeProgress:
			last = ev.Data.(models.ProgressData)
		case models.EventTypeComplete:
			completed = true
		}
	}

	if !completed {
		t.Fatal("no complete event")
	}
	for _, name := range []string{"a", "b", "shared", "c", "alias", "deep"} {
		if _, ok := nodes[name]; !ok {
			t.Errorf("missing node %s", name)
		}
	}
	if _, ok := nodes["deeper"]; ok {
		t.Error("deeper is beyond max depth and must not be loaded")
	}
	if errs != 1 {
		t.Errorf("expected 1 package error, got %d", errs)
	}
	if last.Current != last.Total || last.Total != 7 {
		t.Errorf("unexpected final progress %+v", last)
	}
	if n := nodes["a"]; n.License != "MIT" || n.Repository == nil || n.Repository.URL != "github:example/a" {
		t.Errorf("license/repository not normalized: %+v", n)
	}
}

// A package first reached through a long path must still be expanded
// when a shorter path shows up later.
func TestAnalyzeUsesShortestPath(t *testing.T) {
	srv, _ := fakeRegistry(t, map[string]map[string]string{
		"fast1":  {"fast2": "^1.0.0"},
		"fast2":  {"shared": "^1.0.0"},
		"slow":   {"shared": "^1.0.0"},
		"shared": {"leaf": "^1.0.0"},
		"leaf":   {},
	})
	a := newTestAnalyzer(srv.URL)

	// Warm the cache so the long path through fast1 completes first.
	for _, name := range []string{"fast1", "fast2", "shared"} {
		if _, err := a.FetchNode(context.Background(), name, "^1.0.0"); err != nil {
			t.Fatal(err)
		}
	}

	for i := 0; i < 20; i++ {
		events := a.Analyze(context.Background(), models.AnalyzeRequest{
			PackageJSON: models.PackageJSON{
				Name:         "root",
				Dependencies: map[string]string{"fast1": "^1.0.0", "slow": "^1.0.0"},
			},
			MaxDepth: 3,
		})
		found := false
		for ev := range events {
			if n, ok := ev.Data.(*models.DependencyNode); ok && n.Name == "leaf" {
				found = true
			}
		}
		if !found {
			t.Fatalf("run %d: leaf is at depth 3 via slow/shared and must be loaded", i)
		}
	}
}

func TestFetchSharesConcurrentRequests(t *testing.T) {
	srv, requests := fakeRegistry(t, map[string]map[string]string{"a": {}})
	a := newTestAnalyzer(srv.URL)

	done := make(chan struct{})
	for i := 0; i < 20; i++ {
		go func() {
			defer func() { done <- struct{}{} }()
			if _, err := a.FetchNode(context.Background(), "a", "^1.0.0"); err != nil {
				t.Error(err)
			}
		}()
	}
	for i := 0; i < 20; i++ {
		<-done
	}
	// One index request plus one manifest request.
	if got := atomic.LoadInt64(requests); got != 2 {
		t.Errorf("expected 2 registry requests, got %d", got)
	}
}
