package models

// PackageJSON represents the package.json structure
type PackageJSON struct {
	Name            string            `json:"name"`
	Version         string            `json:"version"`
	Description     string            `json:"description,omitempty"`
	Dependencies    map[string]string `json:"dependencies,omitempty"`
	DevDependencies map[string]string `json:"devDependencies,omitempty"`
	Homepage        string            `json:"homepage,omitempty"`
	Repository      *Repository       `json:"repository,omitempty"`
	License         string            `json:"license,omitempty"`
}

// Repository represents the repository information
type Repository struct {
	Type string `json:"type"`
	URL  string `json:"url"`
}

// DependencyNode represents a dependency with its metadata
type DependencyNode struct {
	Name              string            `json:"name"`
	Version           string            `json:"version"`
	Description       string            `json:"description,omitempty"`
	Dependencies      map[string]string `json:"dependencies,omitempty"`
	DevDependencies   map[string]string `json:"devDependencies,omitempty"`
	Homepage          string            `json:"homepage,omitempty"`
	Repository        *Repository       `json:"repository,omitempty"`
	License           string            `json:"license,omitempty"`
	Loaded            bool              `json:"loaded"`
	Loading           bool              `json:"loading"`
	ChildrenLoaded    bool              `json:"childrenLoaded"`
	HasNoDependencies bool              `json:"hasNoDependencies"`
}

// AnalyzeRequest represents the analysis request from frontend
type AnalyzeRequest struct {
	PackageJSON            PackageJSON `json:"packageJson"`
	IncludeDevDependencies bool        `json:"includeDevDependencies"`
	MaxDepth               int         `json:"maxDepth"`
}

// AnalyzeResponse represents the response with session info
type AnalyzeResponse struct {
	SessionID string `json:"sessionId"`
	StreamURL string `json:"streamUrl"`
}

// EventType represents SSE event types
type EventType string

const (
	EventTypeProgress EventType = "progress"
	EventTypeNode     EventType = "node"
	EventTypeComplete EventType = "complete"
	// EventTypePackageError reports a single package that failed to
	// load. It is deliberately not named "error", which EventSource
	// reserves for connection errors.
	EventTypePackageError EventType = "package-error"
)

// SSE wire event names. The stream handler batches node and error
// events into arrays to keep the number of client updates low.
const (
	SSEEventNodes         = "nodes"
	SSEEventPackageErrors = "package-errors"
)

// Event represents an analyzer event
type Event struct {
	Type EventType
	Data interface{}
}

// ProgressData represents progress information
type ProgressData struct {
	Current        int    `json:"current"`
	Total          int    `json:"total"`
	Level          int    `json:"level"`
	CurrentPackage string `json:"currentPackage"`
}

// CompleteData represents completion information
type CompleteData struct {
	TotalProcessed int    `json:"totalProcessed"`
	Duration       string `json:"duration"`
}

// ErrorData represents error information
type ErrorData struct {
	Package string `json:"package"`
	Error   string `json:"error"`
}
