// Package websocket provides AG-UI protocol endpoints for event streaming.
package websocket

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/gin-gonic/gin"
)

// ExportResponse contains the exported session data
type ExportResponse struct {
	SessionID      string          `json:"sessionId"`
	ProjectName    string          `json:"projectName"`
	ExportDate     string          `json:"exportDate"`
	AGUIEvents     json.RawMessage `json:"aguiEvents"`
	LegacyMessages json.RawMessage `json:"legacyMessages,omitempty"`
	HasLegacy      bool            `json:"hasLegacy"`
}

// HandleExportSession exports session chat data as JSON
// GET /api/projects/:projectName/agentic-sessions/:sessionName/export
func HandleExportSession(c *gin.Context) {
	projectName := c.Param("projectName")
	sessionName := c.Param("sessionName")

	log.Printf("Export: Exporting session %s/%s", projectName, sessionName)

	// Build paths
	sessionDir := fmt.Sprintf("%s/sessions/%s", StateBaseDir, sessionName)
	aguiEventsPath := fmt.Sprintf("%s/agui-events.jsonl", sessionDir)
	legacyMigratedPath := fmt.Sprintf("%s/messages.jsonl.migrated", sessionDir)
	legacyOriginalPath := fmt.Sprintf("%s/messages.jsonl", sessionDir)

	// Check if session directory exists
	if _, err := os.Stat(sessionDir); os.IsNotExist(err) {
		log.Printf("Export: Session directory not found: %s", sessionDir)
		c.JSON(http.StatusNotFound, gin.H{"error": "Session not found"})
		return
	}

	response := ExportResponse{
		SessionID:   sessionName,
		ProjectName: projectName,
		ExportDate:  time.Now().UTC().Format(time.RFC3339),
		HasLegacy:   false,
	}

	// Read AG-UI events
	aguiData, err := readJSONLFile(aguiEventsPath)
	if err != nil {
		if os.IsNotExist(err) {
			// No AG-UI events yet - return empty array
			response.AGUIEvents = json.RawMessage("[]")
		} else {
			log.Printf("Export: Error reading AG-UI events: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to read session events"})
			return
		}
	} else {
		// Pretty-print the events array
		prettyJSON, err := json.MarshalIndent(aguiData, "", "  ")
		if err != nil {
			log.Printf("Export: Error formatting AG-UI events: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to format events"})
			return
		}
		response.AGUIEvents = prettyJSON
	}

	// Check for legacy messages - try migrated file first, then original
	legacyPath := ""
	if _, err := os.Stat(legacyMigratedPath); err == nil {
		legacyPath = legacyMigratedPath
		log.Printf("Export: Found migrated legacy file: %s", legacyMigratedPath)
	} else if _, err := os.Stat(legacyOriginalPath); err == nil {
		legacyPath = legacyOriginalPath
		log.Printf("Export: Found original legacy file: %s", legacyOriginalPath)
	}

	if legacyPath != "" {
		legacyData, err := readJSONLFile(legacyPath)
		if err != nil {
			log.Printf("Export: Warning - failed to read legacy messages: %v", err)
		} else {
			prettyJSON, err := json.MarshalIndent(legacyData, "", "  ")
			if err != nil {
				log.Printf("Export: Warning - failed to format legacy messages: %v", err)
			} else {
				response.LegacyMessages = prettyJSON
				response.HasLegacy = true
			}
		}
	}

	log.Printf("Export: Successfully exported session %s (hasLegacy=%v)", sessionName, response.HasLegacy)

	// Set headers for JSON download
	c.Header("Content-Type", "application/json")
	c.Header("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s-export.json\"", sessionName))

	c.JSON(http.StatusOK, response)
}

// readJSONLFile reads a JSONL file and returns parsed array of objects
func readJSONLFile(path string) ([]map[string]interface{}, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}

	var events []map[string]interface{}
	lines := splitLines(data)

	for _, line := range lines {
		if len(line) == 0 {
			continue
		}
		var event map[string]interface{}
		if err := json.Unmarshal(line, &event); err != nil {
			// Skip malformed lines
			log.Printf("Export: Skipping malformed JSON line: %v", err)
			continue
		}
		events = append(events, event)
	}

	return events, nil
}

