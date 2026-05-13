package sse

import (
	"forrest/backend/pkg/models"
	"sync"
	"time"

	"github.com/google/uuid"
)

// sessionTTL is how long a pending session is kept before it expires
// if the SSE client never connects.
const sessionTTL = 60 * time.Second

type pendingSession struct {
	request   models.AnalyzeRequest
	createdAt time.Time
}

// Manager stores pending analyze requests keyed by session ID until the
// SSE client connects and consumes them.
type Manager struct {
	sessions map[string]*pendingSession
	mu       sync.Mutex
}

// NewManager creates a new session manager and starts the background
// cleanup goroutine.
func NewManager() *Manager {
	m := &Manager{
		sessions: make(map[string]*pendingSession),
	}
	go m.cleanupLoop()
	return m
}

// CreateSession stores the request and returns a new session ID.
func (m *Manager) CreateSession(req models.AnalyzeRequest) string {
	sessionID := uuid.New().String()

	m.mu.Lock()
	m.sessions[sessionID] = &pendingSession{
		request:   req,
		createdAt: time.Now(),
	}
	m.mu.Unlock()

	return sessionID
}

// ConsumeSession atomically retrieves and removes a session. Returns
// false if the session does not exist or has expired.
func (m *Manager) ConsumeSession(sessionID string) (models.AnalyzeRequest, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()

	s, exists := m.sessions[sessionID]
	if !exists {
		return models.AnalyzeRequest{}, false
	}
	delete(m.sessions, sessionID)

	if time.Since(s.createdAt) > sessionTTL {
		return models.AnalyzeRequest{}, false
	}

	return s.request, true
}

func (m *Manager) cleanupLoop() {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	for range ticker.C {
		m.mu.Lock()
		now := time.Now()
		for id, s := range m.sessions {
			if now.Sub(s.createdAt) > sessionTTL {
				delete(m.sessions, id)
			}
		}
		m.mu.Unlock()
	}
}
