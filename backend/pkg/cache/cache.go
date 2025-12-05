package cache

import (
	"forrest/backend/pkg/models"
	"time"
)

// Cache defines the interface for caching package data
type Cache interface {
	Get(key string) (*models.DependencyNode, bool)
	Set(key string, node *models.DependencyNode, ttl time.Duration)
}
