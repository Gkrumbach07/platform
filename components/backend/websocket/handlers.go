package websocket

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"ambient-code-backend/handlers"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// WebSocket upgrader
var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		// Allow all origins for development - should be restricted in production
		return true
	},
}

// HandleSessionWebSocket handles WebSocket connections for sessions
// Route: /projects/:projectName/sessions/:sessionId/ws
func HandleSessionWebSocket(c *gin.Context) {
	sessionID := c.Param("sessionId")
	log.Printf("handleSessionWebSocket for session: %s", sessionID)

	// Access enforced by RBAC on downstream resources

	// Best-effort user identity: prefer forwarded user, else extract ServiceAccount from bearer token
	var userIDStr string
	if v, ok := c.Get("userID"); ok {
		if s, ok2 := v.(string); ok2 {
			userIDStr = s
		}
	}
	if userIDStr == "" {
		if ns, sa, ok := handlers.ExtractServiceAccountFromAuth(c); ok {
			userIDStr = ns + ":" + sa
		}
	}

	// Upgrade HTTP connection to WebSocket
	conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		log.Printf("WebSocket upgrade failed: %v", err)
		return
	}

	sessionConn := &SessionConnection{
		SessionID: sessionID,
		Conn:      conn,
		UserID:    userIDStr,
	}

	// Register connection
	Hub.register <- sessionConn

	// Handle messages from client
	go handleWebSocketMessages(sessionConn)

	// Keep connection alive
	go handleWebSocketPing(sessionConn)
}

// handleWebSocketMessages processes incoming WebSocket messages
func handleWebSocketMessages(conn *SessionConnection) {
	defer func() {
		Hub.unregister <- conn
	}()

	for {
		messageType, messageData, err := conn.Conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("WebSocket error: %v", err)
			}
			break
		}

		if messageType == websocket.TextMessage {
			var msg map[string]interface{}
			if err := json.Unmarshal(messageData, &msg); err != nil {
				log.Printf("Failed to parse WebSocket message: %v", err)
				continue
			}

			// Handle control messages
			if msgType, ok := msg["type"].(string); ok {
				if msgType == "ping" {
					// Respond with pong
					pong := map[string]interface{}{
						"type":      "pong",
						"timestamp": time.Now().UTC().Format(time.RFC3339),
					}
					pongData, _ := json.Marshal(pong)
					// Lock write mutex before writing pong
					conn.writeMu.Lock()
					_ = conn.Conn.WriteMessage(websocket.TextMessage, pongData)
					conn.writeMu.Unlock()
					continue
				}
				// Extract payload from runner message to avoid double-nesting
				// Runner sends: {type, seq, timestamp, payload}
				// We only want to store the payload field
				payload, ok := msg["payload"].(map[string]interface{})
				if !ok {
					payload = msg // Fallback for legacy format
				}
				// Broadcast all other messages to session listeners (UI and others)
				sessionMsg := &SessionMessage{
					SessionID: conn.SessionID,
					Type:      msgType,
					Timestamp: time.Now().UTC().Format(time.RFC3339),
					Payload:   payload,
				}
				Hub.broadcast <- sessionMsg
			}
		}
	}
}

// handleWebSocketPing sends periodic ping messages
func handleWebSocketPing(conn *SessionConnection) {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	for range ticker.C {
		// Lock write mutex before writing ping
		conn.writeMu.Lock()
		err := conn.Conn.WriteMessage(websocket.PingMessage, nil)
		conn.writeMu.Unlock()
		if err != nil {
			return
		}
	}
}

// GetSessionMessagesWS handles GET /projects/:projectName/sessions/:sessionId/messages
// Retrieves messages from S3 storage
func GetSessionMessagesWS(c *gin.Context) {
	sessionID := c.Param("sessionId")

	// Access enforced by RBAC on downstream resources

	messages, err := retrieveMessagesFromS3(sessionID)
	if err != nil {
		log.Printf("getSessionMessagesWS: retrieve failed: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": fmt.Sprintf("failed to retrieve messages: %v", err),
		})
		return
	}

	// Optional consolidation of partial messages
	includeParam := strings.ToLower(strings.TrimSpace(c.Query("include_partial_messages")))
	includePartials := includeParam == "1" || includeParam == "true" || includeParam == "yes"

	collapsed := make([]SessionMessage, 0, len(messages))
	activePartialIndex := -1
	for _, m := range messages {
		if m.Type == "message.partial" {
			if includePartials {
				if activePartialIndex >= 0 {
					collapsed[activePartialIndex] = m
				} else {
					collapsed = append(collapsed, m)
					activePartialIndex = len(collapsed) - 1
				}
			}
			// If not including partials, simply skip adding them
			continue
		}
		// On any non-partial, clear active partial placeholder
		activePartialIndex = -1
		collapsed = append(collapsed, m)
	}

	c.JSON(http.StatusOK, gin.H{
		"sessionId": sessionID,
		"messages":  collapsed,
	})
}

// PostSessionMessageWS handles POST /projects/:projectName/sessions/:sessionId/messages
// Accepts a generic JSON body. If a "type" string is provided, it will be used.
// Otherwise, defaults to "user_message" and wraps body under payload.
func PostSessionMessageWS(c *gin.Context) {
	projectName := c.Param("projectName")
	sessionID := c.Param("sessionId")

	var body map[string]interface{}
	if err := c.BindJSON(&body); err != nil {
		log.Printf("postSessionMessageWS: bind failed: %v", err)
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid JSON body"})
		return
	}

	msgType := "user_message"
	if v, ok := body["type"].(string); ok && v != "" {
		msgType = v
		// Remove type from payload to avoid duplication
		delete(body, "type")
	}

	message := &SessionMessage{
		SessionID: sessionID,
		Type:      msgType,
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Payload:   body,
	}

	// Broadcast to session listeners (runner) and persist
	Hub.broadcast <- message

	// Check if we should auto-generate a display name
	// Only for user_message type (not control messages like interrupt/end_session)
	if msgType == "user_message" {
		go triggerDisplayNameGenerationIfNeeded(projectName, sessionID, body)
	}

	c.JSON(http.StatusAccepted, gin.H{"status": "queued"})
}

// maxUserMessageChars is the maximum characters to include from user messages for display name generation
const maxUserMessageChars = 1000

// triggerDisplayNameGenerationIfNeeded checks if display name generation should be triggered
// and initiates it asynchronously. This runs in a goroutine to not block the response.
func triggerDisplayNameGenerationIfNeeded(projectName, sessionID string, messageBody map[string]interface{}) {
	// Extract current user message content
	currentContent, ok := messageBody["content"].(string)
	if !ok || strings.TrimSpace(currentContent) == "" {
		return
	}

	// Get session to check if displayName is set and get context
	session, err := getSessionForDisplayName(projectName, sessionID)
	if err != nil {
		log.Printf("DisplayNameGen: Failed to get session %s/%s: %v", projectName, sessionID, err)
		return
	}

	spec, ok := session["spec"].(map[string]interface{})
	if !ok {
		return
	}

	// Check if display name should be generated (only if empty/unset)
	if !handlers.ShouldGenerateDisplayName(spec) {
		return
	}

	log.Printf("DisplayNameGen: Triggering generation for %s/%s", projectName, sessionID)

	// Collect all user messages (existing + current) for better context
	combinedContent := collectUserMessages(sessionID, currentContent)

	// Extract session context for better name generation
	sessionCtx := handlers.ExtractSessionContext(spec)

	// Trigger async display name generation
	handlers.GenerateDisplayNameAsync(projectName, sessionID, combinedContent, sessionCtx)
}

// collectUserMessages fetches existing user messages from storage and combines with current message
// Returns a truncated string of all user messages (max maxUserMessageChars)
func collectUserMessages(sessionID, currentMessage string) string {
	// Fetch existing messages from storage
	existingMessages, err := retrieveMessagesFromS3(sessionID)
	if err != nil {
		log.Printf("DisplayNameGen: Failed to retrieve messages for %s: %v", sessionID, err)
		// Fall back to just the current message
		return truncateString(currentMessage, maxUserMessageChars)
	}

	// Collect user message contents
	var userMessages []string
	for _, msg := range existingMessages {
		if msg.Type == "user_message" {
			// Extract content from payload (Payload is already map[string]interface{})
			if content, ok := msg.Payload["content"].(string); ok && strings.TrimSpace(content) != "" {
				userMessages = append(userMessages, strings.TrimSpace(content))
			}
		}
	}

	// Add current message
	userMessages = append(userMessages, strings.TrimSpace(currentMessage))

	// Combine with separator
	combined := strings.Join(userMessages, " | ")

	// Truncate if too long
	return truncateString(combined, maxUserMessageChars)
}

// truncateString truncates a string to maxLen characters, adding "..." if truncated
func truncateString(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	if maxLen <= 3 {
		return s[:maxLen]
	}
	return s[:maxLen-3] + "..."
}

// getSessionForDisplayName retrieves session data for display name generation
func getSessionForDisplayName(projectName, sessionID string) (map[string]interface{}, error) {
	if handlers.DynamicClient == nil {
		return nil, fmt.Errorf("dynamic client not initialized")
	}

	gvr := handlers.GetAgenticSessionV1Alpha1Resource()
	item, err := handlers.DynamicClient.Resource(gvr).Namespace(projectName).Get(
		context.Background(), sessionID, metav1.GetOptions{},
	)
	if err != nil {
		return nil, err
	}

	return item.Object, nil
}

// NOTE: GetSessionMessagesClaudeFormat removed - session continuation now uses
// SDK's built-in resume functionality with persisted ~/.claude state
// See: https://docs.claude.com/en/api/agent-sdk/sessions
