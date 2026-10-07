package handler

import (
	"fmt"
	"forrest/backend/pkg/models"
	"forrest/backend/pkg/sse"
	"log"

	"github.com/gofiber/fiber/v2"
)

// maxDepthLimit caps the requested depth; every extra level multiplies
// the number of registry requests.
const maxDepthLimit = 5

// AnalyzeHandler accepts analyze requests and stores them in a session
// to be consumed by the SSE handler when the client connects.
type AnalyzeHandler struct {
	sseManager *sse.Manager
}

// NewAnalyzeHandler creates a new analyze handler.
func NewAnalyzeHandler(sseManager *sse.Manager) *AnalyzeHandler {
	return &AnalyzeHandler{sseManager: sseManager}
}

// Analyze handles POST /api/analyze. It does not start the analysis —
// the SSE handler does, when the client connects — so events cannot be
// dropped due to a race between POST returning and the EventSource
// being opened.
func (h *AnalyzeHandler) Analyze(c *fiber.Ctx) error {
	var req models.AnalyzeRequest
	if err := c.BodyParser(&req); err != nil {
		log.Printf("[ANALYZE] Failed to parse request body: %v", err)
		return c.Status(400).JSON(fiber.Map{
			"error": "Invalid request body",
		})
	}

	if req.PackageJSON.Name == "" {
		return c.Status(400).JSON(fiber.Map{
			"error": "Package name is required",
		})
	}

	switch {
	case req.MaxDepth <= 0:
		req.MaxDepth = 2
	case req.MaxDepth > maxDepthLimit:
		req.MaxDepth = maxDepthLimit
	}

	sessionID := h.sseManager.CreateSession(req)
	log.Printf("[ANALYZE] Created session %s for %s (depth=%d, dev=%v)",
		sessionID, req.PackageJSON.Name, req.MaxDepth, req.IncludeDevDependencies)

	return c.Status(202).JSON(models.AnalyzeResponse{
		SessionID: sessionID,
		StreamURL: fmt.Sprintf("/api/events/%s", sessionID),
	})
}
