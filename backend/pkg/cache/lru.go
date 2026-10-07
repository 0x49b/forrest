package cache

import (
	"container/list"
	"sync"
	"time"
)

type entry[V any] struct {
	key       string
	value     V
	expiresAt time.Time
}

// LRU is a size-bounded, thread-safe least-recently-used cache with
// per-entry TTL. Get and Set are O(1).
type LRU[V any] struct {
	mu      sync.Mutex
	maxSize int
	ttl     time.Duration
	ll      *list.List
	items   map[string]*list.Element
}

// NewLRU creates a cache holding at most maxSize entries, each valid for ttl.
func NewLRU[V any](maxSize int, ttl time.Duration) *LRU[V] {
	return &LRU[V]{
		maxSize: maxSize,
		ttl:     ttl,
		ll:      list.New(),
		items:   make(map[string]*list.Element, maxSize),
	}
}

// Get returns the cached value and marks it as recently used.
func (c *LRU[V]) Get(key string) (V, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()

	el, ok := c.items[key]
	if !ok {
		var zero V
		return zero, false
	}
	e := el.Value.(*entry[V])
	if time.Now().After(e.expiresAt) {
		c.ll.Remove(el)
		delete(c.items, key)
		var zero V
		return zero, false
	}
	c.ll.MoveToFront(el)
	return e.value, true
}

// Set stores a value, evicting the least recently used entry if full.
func (c *LRU[V]) Set(key string, value V) {
	c.mu.Lock()
	defer c.mu.Unlock()

	expiresAt := time.Now().Add(c.ttl)
	if el, ok := c.items[key]; ok {
		e := el.Value.(*entry[V])
		e.value = value
		e.expiresAt = expiresAt
		c.ll.MoveToFront(el)
		return
	}

	c.items[key] = c.ll.PushFront(&entry[V]{key: key, value: value, expiresAt: expiresAt})
	if c.ll.Len() > c.maxSize {
		oldest := c.ll.Back()
		c.ll.Remove(oldest)
		delete(c.items, oldest.Value.(*entry[V]).key)
	}
}

// Len returns the number of entries, including not yet evicted expired ones.
func (c *LRU[V]) Len() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.ll.Len()
}
