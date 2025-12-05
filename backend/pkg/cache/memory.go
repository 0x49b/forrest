package cache

import (
	"forrest/backend/pkg/models"
	"sync"
	"time"
)

type cacheEntry struct {
	node      *models.DependencyNode
	expiresAt time.Time
}

// MemoryCache implements an in-memory cache
type MemoryCache struct {
	data            map[string]*cacheEntry
	mu              sync.RWMutex
	maxSize         int
	cleanupInterval time.Duration
}

// NewMemoryCache creates a new memory cache
func NewMemoryCache(maxSize int, cleanupInterval time.Duration) *MemoryCache {
	cache := &MemoryCache{
		data:            make(map[string]*cacheEntry),
		maxSize:         maxSize,
		cleanupInterval: cleanupInterval,
	}

	// Start cleanup goroutine
	go cache.cleanup()

	return cache
}

// Get retrieves a value from cache
func (c *MemoryCache) Get(key string) (*models.DependencyNode, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()

	entry, exists := c.data[key]
	if !exists {
		return nil, false
	}

	// Check if expired
	if time.Now().After(entry.expiresAt) {
		return nil, false
	}

	return entry.node, true
}

// Set stores a value in cache
func (c *MemoryCache) Set(key string, node *models.DependencyNode, ttl time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()

	// Simple eviction: if cache is full, remove oldest entries
	if len(c.data) >= c.maxSize {
		c.evictOldest()
	}

	c.data[key] = &cacheEntry{
		node:      node,
		expiresAt: time.Now().Add(ttl),
	}
}

// evictOldest removes the oldest entry
func (c *MemoryCache) evictOldest() {
	var oldestKey string
	var oldestTime time.Time

	for key, entry := range c.data {
		if oldestKey == "" || entry.expiresAt.Before(oldestTime) {
			oldestKey = key
			oldestTime = entry.expiresAt
		}
	}

	if oldestKey != "" {
		delete(c.data, oldestKey)
	}
}

// cleanup periodically removes expired entries
func (c *MemoryCache) cleanup() {
	ticker := time.NewTicker(c.cleanupInterval)
	defer ticker.Stop()

	for range ticker.C {
		c.mu.Lock()
		now := time.Now()
		for key, entry := range c.data {
			if now.After(entry.expiresAt) {
				delete(c.data, key)
			}
		}
		c.mu.Unlock()
	}
}
