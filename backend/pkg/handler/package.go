package handler

import (
	"forrest/backend/pkg/analyzer"

	"github.com/gofiber/fiber/v2"
)

// PackageHandler resolves single packages on demand, e.g. when a tree
// node beyond the initially analyzed depth is expanded.
type PackageHandler struct {
	analyzer *analyzer.Analyzer
}

// NewPackageHandler creates a new package handler.
func NewPackageHandler(a *analyzer.Analyzer) *PackageHandler {
	return &PackageHandler{analyzer: a}
}

// Get handles GET /api/package?name=...&version=...
func (h *PackageHandler) Get(c *fiber.Ctx) error {
	name := c.Query("name")
	if name == "" {
		return c.Status(400).JSON(fiber.Map{"error": "name is required"})
	}

	node, err := h.analyzer.FetchNode(c.UserContext(), name, c.Query("version", "latest"))
	if err != nil {
		return c.Status(502).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(node)
}
