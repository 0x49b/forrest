package analyzer

import (
	"context"
	"fmt"
	"forrest/backend/pkg/cache"
	"forrest/backend/pkg/models"
	"forrest/backend/pkg/npm"
	"time"
)

// WorkerPool manages concurrent package fetching
type WorkerPool struct {
	workers   int
	semaphore chan struct{}
	npmClient *npm.Client
	cache     cache.Cache
}

// NewWorkerPool creates a new worker pool
func NewWorkerPool(workers int, client *npm.Client, cache cache.Cache) *WorkerPool {
	return &WorkerPool{
		workers:   workers,
		semaphore: make(chan struct{}, workers),
		npmClient: client,
		cache:     cache,
	}
}

// FetchPackage fetches a package with concurrency control
func (wp *WorkerPool) FetchPackage(ctx context.Context, name, version string) (*models.DependencyNode, error) {
	// Acquire semaphore
	select {
	case wp.semaphore <- struct{}{}:
		defer func() { <-wp.semaphore }()
	case <-ctx.Done():
		return nil, ctx.Err()
	}

	// Check cache
	cacheKey := fmt.Sprintf("npm:%s:%s", name, version)
	if cached, ok := wp.cache.Get(cacheKey); ok {
		return cached, nil
	}

	// Fetch from NPM
	node, err := wp.npmClient.FetchPackage(ctx, name, version)
	if err != nil {
		return nil, err
	}

	// Cache result
	wp.cache.Set(cacheKey, node, 1*time.Hour)

	return node, nil
}
