package analyzer

import (
	"context"
	"forrest/backend/pkg/models"
	"log"
	"sync"
	"time"
)

// Analyzer coordinates dependency analysis.
type Analyzer struct {
	workerPool *WorkerPool
}

// NewAnalyzer creates a new analyzer.
func NewAnalyzer(workerPool *WorkerPool) *Analyzer {
	return &Analyzer{workerPool: workerPool}
}

// FetchNode fetches a single package and names the node after the
// requested dependency key, so npm aliases stay addressable by the name
// used in the parent's dependency map.
func (a *Analyzer) FetchNode(ctx context.Context, name, spec string) (*models.DependencyNode, error) {
	node, err := a.workerPool.FetchPackage(ctx, name, spec)
	if err != nil {
		return nil, err
	}
	if node.Name == name {
		return node, nil
	}
	renamed := *node
	renamed.Name = name
	return &renamed, nil
}

// Analyze performs dependency analysis and streams events on the
// returned channel. The channel is closed when analysis finishes or
// when the supplied context is cancelled.
//
// Packages are fetched as soon as their parent resolves instead of
// level by level, so one slow package never stalls the next level.
func (a *Analyzer) Analyze(ctx context.Context, req models.AnalyzeRequest) <-chan models.Event {
	events := make(chan models.Event, 256)

	go func() {
		defer close(events)

		log.Printf("[ANALYZER] Starting analysis for %s (depth=%d)", req.PackageJSON.Name, req.MaxDepth)
		startTime := time.Now()

		var (
			mu sync.Mutex
			// level holds the shortest known distance from the root per
			// package. A package can first be reached through a longer
			// path because fetches complete in any order; when a shorter
			// path shows up later, its children are expanded again.
			level     = map[string]int{req.PackageJSON.Name: 0}
			fetched   = map[string]*models.DependencyNode{}
			total     int
			completed int
			processed int
			maxLevel  int
			wg        sync.WaitGroup
		)

		// progress must be called with mu held.
		progress := func(pkg string) models.Event {
			return models.Event{
				Type: models.EventTypeProgress,
				Data: models.ProgressData{
					Current:        completed,
					Total:          total,
					Level:          maxLevel,
					CurrentPackage: pkg,
				},
			}
		}

		var enqueue func(deps map[string]string, depth int)
		var expand func(node *models.DependencyNode, depth int)
		var process func(name, spec string)

		// enqueue must be called with mu held.
		enqueue = func(deps map[string]string, depth int) {
			for name, spec := range deps {
				known, seen := level[name]
				if seen && known <= depth {
					continue
				}
				level[name] = depth
				if depth > maxLevel {
					maxLevel = depth
				}
				if !seen {
					total++
					wg.Add(1)
					go process(name, spec)
					continue
				}
				// Reached through a shorter path. If it is still being
				// fetched, process picks up the new level.
				if node, ok := fetched[name]; ok {
					expand(node, depth)
				}
			}
		}

		// expand must be called with mu held.
		expand = func(node *models.DependencyNode, depth int) {
			if depth >= req.MaxDepth {
				return
			}
			enqueue(node.Dependencies, depth+1)
			if req.IncludeDevDependencies {
				enqueue(node.DevDependencies, depth+1)
			}
		}

		process = func(name, spec string) {
			defer wg.Done()

			node, err := a.FetchNode(ctx, name, spec)
			if ctx.Err() != nil {
				return
			}

			mu.Lock()
			completed++
			var batch []models.Event
			if err != nil {
				log.Printf("[ANALYZER] error fetching %s@%s: %v", name, spec, err)
				batch = append(batch, models.Event{
					Type: models.EventTypePackageError,
					Data: models.ErrorData{Package: name, Error: err.Error()},
				})
			} else {
				processed++
				fetched[name] = node
				batch = append(batch, models.Event{Type: models.EventTypeNode, Data: node})
				expand(node, level[name])
			}
			batch = append(batch, progress(name))
			mu.Unlock()

			for _, ev := range batch {
				if !sendEvent(ctx, events, ev) {
					return
				}
			}
		}

		mu.Lock()
		enqueue(req.PackageJSON.Dependencies, 1)
		if req.IncludeDevDependencies {
			enqueue(req.PackageJSON.DevDependencies, 1)
		}
		start := progress("Loading dependencies...")
		mu.Unlock()

		if !sendEvent(ctx, events, start) {
			return
		}

		wg.Wait()
		if ctx.Err() != nil {
			return
		}

		duration := time.Since(startTime)
		log.Printf("[ANALYZER] Done: processed=%d duration=%s", processed, duration)
		sendEvent(ctx, events, models.Event{
			Type: models.EventTypeComplete,
			Data: models.CompleteData{
				TotalProcessed: processed,
				Duration:       duration.Round(time.Millisecond).String(),
			},
		})
	}()

	return events
}

// sendEvent sends an event respecting context cancellation. Returns
// false if the context was cancelled before the event could be sent.
func sendEvent(ctx context.Context, events chan<- models.Event, event models.Event) bool {
	select {
	case events <- event:
		return true
	case <-ctx.Done():
		return false
	}
}
