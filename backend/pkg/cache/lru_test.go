package cache

import (
	"testing"
	"time"
)

func TestLRUEvictsLeastRecentlyUsed(t *testing.T) {
	c := NewLRU[int](2, time.Minute)
	c.Set("a", 1)
	c.Set("b", 2)
	c.Get("a") // a is now most recent
	c.Set("c", 3)

	if _, ok := c.Get("b"); ok {
		t.Fatal("expected b to be evicted")
	}
	if v, ok := c.Get("a"); !ok || v != 1 {
		t.Fatalf("expected a=1, got %v %v", v, ok)
	}
	if v, ok := c.Get("c"); !ok || v != 3 {
		t.Fatalf("expected c=3, got %v %v", v, ok)
	}
}

func TestLRUExpires(t *testing.T) {
	c := NewLRU[int](2, time.Millisecond)
	c.Set("a", 1)
	time.Sleep(5 * time.Millisecond)
	if _, ok := c.Get("a"); ok {
		t.Fatal("expected a to be expired")
	}
	if c.Len() != 0 {
		t.Fatalf("expected expired entry to be removed, len=%d", c.Len())
	}
}
