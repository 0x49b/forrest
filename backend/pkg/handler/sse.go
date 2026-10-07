package handler

import (
	"bufio"
	"context"
	"encoding/json"
	"forrest/backend/pkg/analyzer"
	"forrest/backend/pkg/models"
	"forrest/backend/pkg/sse"
	"log"
	"time"

	"github.com/gofiber/fiber/v2"
)

const (
	// flushInterval batches events so the client updates its state a
	// few times per second instead of once per package.
	flushInterval = 100 * time.Millisecond
	// heartbeatInterval keeps idle connections alive and detects
	// disconnected clients.
	heartbeatInterval = 15 * time.Second
)

// SSEHandler streams analysis events to the client. The analyzer is
// started inside this handler when the client connects, so events
// cannot accumulate without a reader.
type SSEHandler struct {
	sseManager *sse.Manager
	analyzer   *analyzer.Analyzer
}

// NewSSEHandler creates a new SSE handler.
func NewSSEHandler(sseManager *sse.Manager, a *analyzer.Analyzer) *SSEHandler {
	return &SSEHandler{
		sseManager: sseManager,
		analyzer:   a,
	}
}

// Stream handles GET /api/events/:sessionId.
func (h *SSEHandler) Stream(c *fiber.Ctx) error {
	sessionID := c.Params("sessionId")

	req, ok := h.sseManager.ConsumeSession(sessionID)
	if !ok {
		log.Printf("[SSE] Session not found or expired: %s", sessionID)
		return c.Status(404).JSON(fiber.Map{
			"error": "Session not found",
		})
	}

	c.Set("Content-Type", "text/event-stream")
	c.Set("Cache-Control", "no-cache")
	c.Set("Connection", "keep-alive")
	c.Set("Transfer-Encoding", "chunked")
	c.Set("X-Accel-Buffering", "no")

	c.Context().SetBodyStreamWriter(func(w *bufio.Writer) {
		ctx, cancel := context.WithCancel(context.Background())
		defer cancel()

		events := h.analyzer.Analyze(ctx, req)
		s := &stream{w: w}

		s.write("connected", fiber.Map{"status": "connected"})
		if err := s.flush(); err != nil {
			log.Printf("[SSE:%s] Client disconnected before first event: %v", sessionID, err)
			return
		}

		ticker := time.NewTicker(flushInterval)
		defer ticker.Stop()
		lastWrite := time.Now()

		for {
			select {
			case event, open := <-events:
				if !open {
					log.Printf("[SSE:%s] Events channel closed without complete event", sessionID)
					s.flush()
					return
				}
				s.add(event)
				if event.Type == models.EventTypeComplete {
					if err := s.flush(); err != nil {
						log.Printf("[SSE:%s] Flush error on complete: %v", sessionID, err)
					}
					return
				}

			case <-ticker.C:
				if !s.pending() {
					if time.Since(lastWrite) < heartbeatInterval {
						continue
					}
					s.comment("ping")
				}
				if err := s.flush(); err != nil {
					log.Printf("[SSE:%s] Client disconnected: %v", sessionID, err)
					return
				}
				lastWrite = time.Now()
			}
		}
	})

	return nil
}

// stream buffers analyzer events and writes them as SSE frames. Node
// and error events are coalesced into arrays, progress events collapse
// to the most recent one.
type stream struct {
	w        *bufio.Writer
	nodes    []interface{}
	errors   []interface{}
	progress interface{}
	err      error
}

func (s *stream) add(event models.Event) {
	switch event.Type {
	case models.EventTypeNode:
		s.nodes = append(s.nodes, event.Data)
	case models.EventTypePackageError:
		s.errors = append(s.errors, event.Data)
	case models.EventTypeProgress:
		s.progress = event.Data
	case models.EventTypeComplete:
		s.writePending()
		s.write(string(models.EventTypeComplete), event.Data)
	}
}

func (s *stream) pending() bool {
	return len(s.nodes) > 0 || len(s.errors) > 0 || s.progress != nil
}

func (s *stream) writePending() {
	if len(s.nodes) > 0 {
		s.write(models.SSEEventNodes, s.nodes)
		s.nodes = s.nodes[:0]
	}
	if len(s.errors) > 0 {
		s.write(models.SSEEventPackageErrors, s.errors)
		s.errors = s.errors[:0]
	}
	if s.progress != nil {
		s.write(string(models.EventTypeProgress), s.progress)
		s.progress = nil
	}
}

func (s *stream) write(event string, data interface{}) {
	if s.err != nil {
		return
	}
	payload, err := json.Marshal(data)
	if err != nil {
		log.Printf("[SSE] Failed to encode %s event: %v", event, err)
		return
	}
	s.w.WriteString("event: ")
	s.w.WriteString(event)
	s.w.WriteString("\ndata: ")
	s.w.Write(payload)
	_, s.err = s.w.WriteString("\n\n")
}

func (s *stream) comment(text string) {
	if s.err == nil {
		_, s.err = s.w.WriteString(": " + text + "\n\n")
	}
}

// flush writes all pending events and flushes them to the client.
func (s *stream) flush() error {
	s.writePending()
	if s.err != nil {
		return s.err
	}
	s.err = s.w.Flush()
	return s.err
}
