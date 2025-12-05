package handler

import (
	"context"
	"fmt"
	"forrest/backend/pkg/analyzer"
	"forrest/backend/pkg/models"
	"forrest/backend/pkg/sse"
	"log"
	"time"

	"github.com/gofiber/fiber/v2"
)

// AnalyzeHandler handles analysis requests
type AnalyzeHandler struct {
	analyzer   *analyzer.Analyzer
	sseManager *sse.Manager
}

// NewAnalyzeHandler creates a new analyze handler
func NewAnalyzeHandler(analyzer *analyzer.Analyzer, sseManager *sse.Manager) *AnalyzeHandler {
	return &AnalyzeHandler{
		analyzer:   analyzer,
		sseManager: sseManager,
	}
}

// Analyze handles POST /api/analyze
func (h *AnalyzeHandler) Analyze(c *fiber.Ctx) error {
	log.Println("=== [ANALYZE] Received analyze request ===")

	var req models.AnalyzeRequest
	if err := c.BodyParser(&req); err != nil {
		log.Printf("[ANALYZE] ERROR: Failed to parse request body: %v", err)
		return c.Status(400).JSON(fiber.Map{
			"error": "Invalid request body",
		})
	}

	log.Printf("[ANALYZE] Request parsed - Package: %s, MaxDepth: %d, IncludeDevDeps: %v, ParallelWorkers: %d",
		req.PackageJSON.Name, req.MaxDepth, req.IncludeDevDependencies, req.ParallelWorkers)

	// Validate
	if req.PackageJSON.Name == "" {
		log.Println("[ANALYZE] ERROR: Package name is missing")
		return c.Status(400).JSON(fiber.Map{
			"error": "Package name is required",
		})
	}

	// Set defaults
	if req.MaxDepth == 0 {
		req.MaxDepth = 2
		log.Printf("[ANALYZE] Set default MaxDepth: %d", req.MaxDepth)
	}
	if req.ParallelWorkers == 0 {
		req.ParallelWorkers = 100
		log.Printf("[ANALYZE] Set default ParallelWorkers: %d", req.ParallelWorkers)
	}

	// Create session
	sessionID := h.sseManager.CreateSession()
	log.Printf("[ANALYZE] Created session ID: %s", sessionID)

	// Start analysis in background
	go func() {
		log.Printf("[ANALYZE:%s] Starting background analysis", sessionID)
		startTime := time.Now()
		ctx := context.Background()
		events := h.analyzer.Analyze(ctx, req)

		eventCount := 0
		for event := range events {
			eventCount++
			log.Printf("[ANALYZE:%s] Sending event #%d - Type: %s", sessionID, eventCount, event.Type)
			h.sseManager.SendEvent(sessionID, event)
		}

		duration := time.Since(startTime)
		log.Printf("[ANALYZE:%s] Analysis complete - Total events: %d, Duration: %s",
			sessionID, eventCount, duration)

		// Close session after completion (with delay)
		time.AfterFunc(10*time.Second, func() {
			log.Printf("[ANALYZE:%s] Closing session", sessionID)
			h.sseManager.CloseSession(sessionID)
		})
	}()

	// Return session info
	log.Printf("[ANALYZE] Returning session info to client - SessionID: %s", sessionID)
	return c.Status(202).JSON(models.AnalyzeResponse{
		SessionID: sessionID,
		StreamURL: fmt.Sprintf("/api/events/%s", sessionID),
	})
}
