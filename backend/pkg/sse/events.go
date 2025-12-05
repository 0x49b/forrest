package sse

import (
	"encoding/json"
	"fmt"
	"forrest/backend/pkg/models"
)

// FormatSSE formats an event as SSE data
func FormatSSE(event models.Event) string {
	data, _ := json.Marshal(event.Data)
	return fmt.Sprintf("event: %s\ndata: %s\n\n", event.Type, string(data))
}
