package handler

import (
	"bufio"
	"forrest/backend/pkg/models"
	"forrest/backend/pkg/sse"
	"log"

	"github.com/gofiber/fiber/v2"
)

// SSEHandler handles SSE streaming
type SSEHandler struct {
	sseManager *sse.Manager
}

// NewSSEHandler creates a new SSE handler
func NewSSEHandler(sseManager *sse.Manager) *SSEHandler {
	return &SSEHandler{sseManager: sseManager}
}

// Stream handles GET /api/events/:sessionId
func (h *SSEHandler) Stream(c *fiber.Ctx) error {
	sessionID := c.Params("sessionId")
	log.Printf("[SSE] Client connecting to session: %s", sessionID)

	// Get session
	eventChan, exists := h.sseManager.GetSession(sessionID)
	if !exists {
		log.Printf("[SSE] ERROR: Session not found: %s", sessionID)
		return c.Status(404).JSON(fiber.Map{
			"error": "Session not found",
		})
	}

	log.Printf("[SSE:%s] Session found, setting up SSE stream", sessionID)

	// Set SSE headers
	c.Set("Content-Type", "text/event-stream")
	c.Set("Cache-Control", "no-cache")
	c.Set("Connection", "keep-alive")
	c.Set("Transfer-Encoding", "chunked")
	c.Set("X-Accel-Buffering", "no")

	c.Context().SetBodyStreamWriter(func(w *bufio.Writer) {
		// Send initial connection event
		log.Printf("[SSE:%s] Sending connection event", sessionID)
		w.WriteString("event: connected\ndata: {\"status\":\"connected\"}\n\n")
		w.Flush()

		eventsSent := 0
		// Stream events
		for event := range eventChan {
			eventsSent++
			log.Printf("[SSE:%s] Streaming event #%d - Type: %s", sessionID, eventsSent, event.Type)
			formatted := sse.FormatSSE(event)
			w.WriteString(formatted)
			w.Flush()

			// Exit on complete
			if event.Type == models.EventTypeComplete {
				log.Printf("[SSE:%s] Complete event sent, closing stream - Total events: %d", sessionID, eventsSent)
				break
			}
		}

		log.Printf("[SSE:%s] Stream closed", sessionID)
	})

	return nil
}
