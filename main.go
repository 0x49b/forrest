package main

import (
	"embed"
	"forrest/backend/pkg/analyzer"
	"forrest/backend/pkg/cache"
	"forrest/backend/pkg/handler"
	"forrest/backend/pkg/npm"
	"forrest/backend/pkg/sse"
	"io/fs"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/gofiber/fiber/v2/middleware/filesystem"
	"github.com/gofiber/fiber/v2/middleware/logger"
	"github.com/gofiber/fiber/v2/middleware/recover"
)

//go:embed all:dist
var frontendFS embed.FS

func main() {
	// Initialize dependencies
	npmClient := npm.NewClient(npm.Config{
		RegistryURL: npm.NPMRegistry,
		Timeout:     10 * time.Second,
	})

	memCache := cache.NewMemoryCache(10000, 10*time.Minute)

	workerPool := analyzer.NewWorkerPool(100, npmClient, memCache)
	analyzerService := analyzer.NewAnalyzer(workerPool)

	sseManager := sse.NewManager()

	// Initialize handlers
	analyzeHandler := handler.NewAnalyzeHandler(sseManager)
	sseHandler := handler.NewSSEHandler(sseManager, analyzerService)

	// Create Fiber app
	app := fiber.New(fiber.Config{
		AppName:      "Forrest Dependency Analyzer v1.0",
		ServerHeader: "Forrest",
	})

	// Middleware
	app.Use(recover.New())
	app.Use(logger.New())
	app.Use(cors.New(cors.Config{
		AllowOrigins: "*",
		AllowMethods: "GET,POST,PUT,DELETE,OPTIONS",
		AllowHeaders: "Origin, Content-Type, Accept",
	}))

	// API routes
	api := app.Group("/api")
	api.Post("/analyze", analyzeHandler.Analyze)
	api.Get("/events/:sessionId", sseHandler.Stream)

	// Health check
	api.Get("/health", func(c *fiber.Ctx) error {
		return c.JSON(fiber.Map{
			"status": "healthy",
		})
	})

	// Serve frontend from embedded FS
	distFS, err := fs.Sub(frontendFS, "dist")
	if err != nil {
		log.Fatal(err)
	}

	app.Use("/", filesystem.New(filesystem.Config{
		Root:         http.FS(distFS),
		Browse:       false,
		Index:        "index.html",
		NotFoundFile: "index.html", // SPA fallback
	}))

	// Start server
	port := os.Getenv("PORT")
	if port == "" {
		port = "8081"
	}

	log.Printf("Starting server on :%s", port)
	log.Fatal(app.Listen(":" + port))
}
