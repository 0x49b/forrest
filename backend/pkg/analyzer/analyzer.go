package analyzer

import (
	"context"
	"fmt"
	"forrest/backend/pkg/models"
	"log"
	"sync"
	"time"
)

// Analyzer coordinates dependency analysis
type Analyzer struct {
	workerPool *WorkerPool
}

// NewAnalyzer creates a new analyzer
func NewAnalyzer(workerPool *WorkerPool) *Analyzer {
	return &Analyzer{workerPool: workerPool}
}

// Analyze performs dependency analysis and streams events
func (a *Analyzer) Analyze(ctx context.Context, req models.AnalyzeRequest) <-chan models.Event {
	events := make(chan models.Event, 100)

	go func() {
		defer close(events)

		log.Printf("[ANALYZER] Starting analysis for package: %s", req.PackageJSON.Name)
		startTime := time.Now()
		totalProcessed := 0

		// Prepare root dependencies
		rootDeps := make(map[string]string)
		for k, v := range req.PackageJSON.Dependencies {
			rootDeps[k] = v
		}
		if req.IncludeDevDependencies {
			for k, v := range req.PackageJSON.DevDependencies {
				rootDeps[k] = v
			}
		}

		log.Printf("[ANALYZER] Root dependencies: %d (includeDevDeps: %v)", len(rootDeps), req.IncludeDevDependencies)

		// Track dependencies by level
		levelDeps := make(map[int]map[string]string)
		levelDeps[1] = rootDeps

		// Process each level
		for level := 1; level <= req.MaxDepth; level++ {
			deps := levelDeps[level]
			if len(deps) == 0 {
				log.Printf("[ANALYZER] Level %d: No dependencies to process, stopping", level)
				break
			}

			log.Printf("[ANALYZER] Level %d: Processing %d dependencies", level, len(deps))

			// Send initial progress
			events <- models.Event{
				Type: models.EventTypeProgress,
				Data: models.ProgressData{
					Current:        0,
					Total:          len(deps),
					Level:          level,
					CurrentPackage: fmt.Sprintf("Loading level %d dependencies...", level),
				},
			}

			// Process dependencies in parallel
			nextLevelDeps := make(map[string]string)
			var mu sync.Mutex
			var wg sync.WaitGroup

			current := 0
			for depName, depVersion := range deps {
				wg.Add(1)

				go func(name, version string, idx int) {
					defer wg.Done()

					log.Printf("[ANALYZER] Level %d: Fetching %s@%s", level, name, version)

					// Fetch package
					node, err := a.workerPool.FetchPackage(ctx, name, version)
					if err != nil {
						log.Printf("[ANALYZER] Level %d: ERROR fetching %s@%s: %v", level, name, version, err)
						events <- models.Event{
							Type: models.EventTypeError,
							Data: models.ErrorData{
								Package: name,
								Error:   err.Error(),
							},
						}
						return
					}

					log.Printf("[ANALYZER] Level %d: Successfully fetched %s@%s (deps: %d, devDeps: %d)",
						level, name, node.Version, len(node.Dependencies), len(node.DevDependencies))

					totalProcessed++

					// Send node event
					events <- models.Event{
						Type:  models.EventTypeNode,
						Data:  node,
						Level: level,
					}

					// Send progress update
					mu.Lock()
					events <- models.Event{
						Type: models.EventTypeProgress,
						Data: models.ProgressData{
							Current:        idx + 1,
							Total:          len(deps),
							Level:          level,
							CurrentPackage: name,
						},
					}
					mu.Unlock()

					// Collect next level dependencies
					if level < req.MaxDepth {
						mu.Lock()
						for nextName, nextVer := range node.Dependencies {
							if _, exists := nextLevelDeps[nextName]; !exists {
								// Avoid duplicates and circular deps
								nextLevelDeps[nextName] = nextVer
							}
						}
						if req.IncludeDevDependencies {
							for nextName, nextVer := range node.DevDependencies {
								if _, exists := nextLevelDeps[nextName]; !exists {
									nextLevelDeps[nextName] = nextVer
								}
							}
						}
						mu.Unlock()
					}
				}(depName, depVersion, current)

				current++
			}

			wg.Wait()
			log.Printf("[ANALYZER] Level %d: Completed - processed %d packages", level, len(deps))

			// Store next level deps
			if len(nextLevelDeps) > 0 {
				log.Printf("[ANALYZER] Level %d: Found %d dependencies for next level", level, len(nextLevelDeps))
				levelDeps[level+1] = nextLevelDeps
			}
		}

		// Send complete event
		duration := time.Since(startTime)
		log.Printf("[ANALYZER] Analysis complete - Total processed: %d, Duration: %s", totalProcessed, duration)
		events <- models.Event{
			Type: models.EventTypeComplete,
			Data: models.CompleteData{
				TotalProcessed: totalProcessed,
				Duration:       duration.String(),
			},
		}
	}()

	return events
}
