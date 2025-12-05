package sse

import (
	"forrest/backend/pkg/models"
	"sync"

	"github.com/google/uuid"
)

// Manager handles SSE session management
type Manager struct {
	sessions map[string]chan models.Event
	mu       sync.RWMutex
}

// NewManager creates a new SSE manager
func NewManager() *Manager {
	return &Manager{
		sessions: make(map[string]chan models.Event),
	}
}

// CreateSession creates a new SSE session
func (m *Manager) CreateSession() string {
	sessionID := uuid.New().String()

	m.mu.Lock()
	m.sessions[sessionID] = make(chan models.Event, 100)
	m.mu.Unlock()

	return sessionID
}

// GetSession retrieves a session channel
func (m *Manager) GetSession(sessionID string) (chan models.Event, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	ch, exists := m.sessions[sessionID]
	return ch, exists
}

// CloseSession closes and removes a session
func (m *Manager) CloseSession(sessionID string) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if ch, exists := m.sessions[sessionID]; exists {
		close(ch)
		delete(m.sessions, sessionID)
	}
}

// SendEvent sends an event to a session
func (m *Manager) SendEvent(sessionID string, event models.Event) bool {
	m.mu.RLock()
	ch, exists := m.sessions[sessionID]
	m.mu.RUnlock()

	if !exists {
		return false
	}

	select {
	case ch <- event:
		return true
	default:
		return false
	}
}
