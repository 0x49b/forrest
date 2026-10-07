package analyzer

import (
	"context"
	"errors"
	"forrest/backend/pkg/cache"
	"forrest/backend/pkg/models"
	"forrest/backend/pkg/npm"

	"golang.org/x/sync/singleflight"
)

// WorkerPool bounds concurrent registry requests and deduplicates them
// through a shared cache.
type WorkerPool struct {
	semaphore chan struct{}
	npmClient *npm.Client
	cache     *cache.LRU[*models.DependencyNode]
	group     singleflight.Group
}

// NewWorkerPool creates a new worker pool
func NewWorkerPool(workers int, client *npm.Client, cache *cache.LRU[*models.DependencyNode]) *WorkerPool {
	return &WorkerPool{
		semaphore: make(chan struct{}, workers),
		npmClient: client,
		cache:     cache,
	}
}

// FetchPackage returns the node for name@spec. Cache hits bypass the
// concurrency limit and concurrent requests for the same key share a
// single fetch. The returned node is shared and must not be mutated.
func (wp *WorkerPool) FetchPackage(ctx context.Context, name, spec string) (*models.DependencyNode, error) {
	key := name + "@" + spec
	if cached, ok := wp.cache.Get(key); ok {
		return cached, nil
	}

	for {
		ch := wp.group.DoChan(key, func() (interface{}, error) {
			// Waiting for a slot honours the cancellation of the caller
			// that started the fetch, so abandoned sessions do not keep
			// the pool busy.
			select {
			case wp.semaphore <- struct{}{}:
				defer func() { <-wp.semaphore }()
			case <-ctx.Done():
				return nil, ctx.Err()
			}

			if cached, ok := wp.cache.Get(key); ok {
				return cached, nil
			}
			// Once started, the request is shared with other callers, so
			// it is detached from this caller; the HTTP client timeout
			// bounds it.
			node, err := wp.npmClient.FetchPackage(context.WithoutCancel(ctx), name, spec)
			if err != nil {
				return nil, err
			}
			wp.cache.Set(key, node)
			return node, nil
		})

		select {
		case res := <-ch:
			if res.Err == nil {
				return res.Val.(*models.DependencyNode), nil
			}
			// The fetch was abandoned by the caller that started it, not
			// by us: try again.
			if errors.Is(res.Err, context.Canceled) && ctx.Err() == nil {
				continue
			}
			return nil, res.Err
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}
}
