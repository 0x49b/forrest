package analyzer

import (
	"context"
	"fmt"
	"forrest/backend/pkg/models"
	"log"
	"sync"
	"sync/atomic"
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

// Analyze performs dependency analysis and streams events on the
// returned channel. The channel is closed when analysis finishes or
// when the supplied context is cancelled.
func (a *Analyzer) Analyze(ctx context.Context, req models.AnalyzeRequest) <-chan models.Event {
	events := make(chan models.Event, 256)

	go func() {
		defer close(events)

		log.Printf("[ANALYZER] Starting analysis for %s", req.PackageJSON.Name)
		startTime := time.Now()
		var totalProcessed int64

		rootDeps := make(map[string]string)
		for k, v := range req.PackageJSON.Dependencies {
			rootDeps[k] = v
		}
		if req.IncludeDevDependencies {
			for k, v := range req.PackageJSON.DevDependencies {
				rootDeps[k] = v
			}
		}

		log.Printf("[ANALYZER] Root deps: %d (includeDevDeps=%v)", len(rootDeps), req.IncludeDevDependencies)

		// Track packages we've already enqueued across all levels so we
		// never fetch the same package twice (avoids work and
		// duplicate node events).
		seen := make(map[string]struct{})
		for name := range rootDeps {
			seen[name] = struct{}{}
		}

		levelDeps := map[int]map[string]string{1: rootDeps}

		for level := 1; level <= req.MaxDepth; level++ {
			deps := levelDeps[level]
			if len(deps) == 0 {
				log.Printf("[ANALYZER] Level %d: nothing to process, stopping", level)
				break
			}

			log.Printf("[ANALYZER] Level %d: processing %d deps", level, len(deps))

			if !sendEvent(ctx, events, models.Event{
				Type: models.EventTypeProgress,
				Data: models.ProgressData{
					Current:        0,
					Total:          len(deps),
					Level:          level,
					CurrentPackage: fmt.Sprintf("Loading level %d dependencies...", level),
				},
			}) {
				return
			}

			nextLevelDeps := make(map[string]string)
			var nextMu sync.Mutex
			var completed int64
			var wg sync.WaitGroup

			for depName, depVersion := range deps {
				select {
				case <-ctx.Done():
					return
				default:
				}

				wg.Add(1)
				go func(name, version string) {
					defer wg.Done()

					node, err := a.workerPool.FetchPackage(ctx, name, version)
					if err != nil {
						if ctx.Err() != nil {
							return
						}
						log.Printf("[ANALYZER] Level %d: error fetching %s@%s: %v", level, name, version, err)
						sendEvent(ctx, events, models.Event{
							Type: models.EventTypeError,
							Data: models.ErrorData{
								Package: name,
								Error:   err.Error(),
							},
						})
						// Still count as completed for progress purposes
						c := atomic.AddInt64(&completed, 1)
						sendEvent(ctx, events, models.Event{
							Type: models.EventTypeProgress,
							Data: models.ProgressData{
								Current:        int(c),
								Total:          len(deps),
								Level:          level,
								CurrentPackage: name,
							},
						})
						return
					}

					atomic.AddInt64(&totalProcessed, 1)

					if !sendEvent(ctx, events, models.Event{
						Type:  models.EventTypeNode,
						Data:  node,
						Level: level,
					}) {
						return
					}

					c := atomic.AddInt64(&completed, 1)
					if !sendEvent(ctx, events, models.Event{
						Type: models.EventTypeProgress,
						Data: models.ProgressData{
							Current:        int(c),
							Total:          len(deps),
							Level:          level,
							CurrentPackage: name,
						},
					}) {
						return
					}

					if level < req.MaxDepth {
						nextMu.Lock()
						for nextName, nextVer := range node.Dependencies {
							if _, ok := seen[nextName]; !ok {
								seen[nextName] = struct{}{}
								nextLevelDeps[nextName] = nextVer
							}
						}
						if req.IncludeDevDependencies {
							for nextName, nextVer := range node.DevDependencies {
								if _, ok := seen[nextName]; !ok {
									seen[nextName] = struct{}{}
									nextLevelDeps[nextName] = nextVer
								}
							}
						}
						nextMu.Unlock()
					}
				}(depName, depVersion)
			}

			wg.Wait()

			if ctx.Err() != nil {
				return
			}

			log.Printf("[ANALYZER] Level %d: done, found %d deps for next level", level, len(nextLevelDeps))
			if len(nextLevelDeps) > 0 {
				levelDeps[level+1] = nextLevelDeps
			}
		}

		duration := time.Since(startTime)
		log.Printf("[ANALYZER] Done: processed=%d duration=%s", atomic.LoadInt64(&totalProcessed), duration)
		sendEvent(ctx, events, models.Event{
			Type: models.EventTypeComplete,
			Data: models.CompleteData{
				TotalProcessed: int(atomic.LoadInt64(&totalProcessed)),
				Duration:       duration.String(),
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
