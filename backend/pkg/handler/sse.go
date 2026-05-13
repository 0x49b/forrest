package handler

import (
	"bufio"
	"context"
	"forrest/backend/pkg/analyzer"
	"forrest/backend/pkg/models"
	"forrest/backend/pkg/sse"
	"log"

	"github.com/gofiber/fiber/v2"
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
	log.Printf("[SSE] Client connecting to session: %s", sessionID)

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

		if _, err := w.WriteString("event: connected\ndata: {\"status\":\"connected\"}\n\n"); err != nil {
			log.Printf("[SSE:%s] Write error on connect event: %v", sessionID, err)
			return
		}
		if err := w.Flush(); err != nil {
			log.Printf("[SSE:%s] Flush error on connect event (client likely disconnected): %v", sessionID, err)
			return
		}

		eventsSent := 0
		for event := range events {
			eventsSent++
			formatted := sse.FormatSSE(event)

			if _, err := w.WriteString(formatted); err != nil {
				log.Printf("[SSE:%s] Write error after %d events: %v", sessionID, eventsSent, err)
				return
			}
			if err := w.Flush(); err != nil {
				log.Printf("[SSE:%s] Flush error after %d events (client disconnected): %v", sessionID, eventsSent, err)
				return
			}

			if event.Type == models.EventTypeComplete {
				log.Printf("[SSE:%s] Complete event sent, total events: %d", sessionID, eventsSent)
				return
			}
		}

		log.Printf("[SSE:%s] Events channel closed without complete event, total events: %d", sessionID, eventsSent)
	})

	return nil
}
