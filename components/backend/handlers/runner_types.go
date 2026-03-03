package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	v1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

const agentRegistryConfigMapName = "ambient-agent-registry"
const agentRegistryDataKey = "agent-registry.json"

// DefaultRunnerType is the default runner type when none is specified.
const DefaultRunnerType = "claude-agent-sdk"

// AgentRegistryEntry represents a runner type entry from the agent registry ConfigMap.
type AgentRegistryEntry struct {
	ID              string            `json:"id"`
	DisplayName     string            `json:"displayName"`
	Description     string            `json:"description"`
	DefaultModel    string            `json:"defaultModel"`
	Models          []ModelOption     `json:"models"`
	RequiredSecrets []string          `json:"requiredSecrets"`
	InternalEnvVars map[string]string `json:"internalEnvVars,omitempty"`
}

// ModelOption represents a model choice within a runner type.
type ModelOption struct {
	Value string `json:"value"`
	Label string `json:"label"`
}

// RunnerTypeResponse is the public API shape (excludes internalEnvVars).
type RunnerTypeResponse struct {
	ID              string        `json:"id"`
	DisplayName     string        `json:"displayName"`
	Description     string        `json:"description"`
	DefaultModel    string        `json:"defaultModel"`
	Models          []ModelOption `json:"models"`
	RequiredSecrets []string      `json:"requiredSecrets"`
}

// In-memory cache for the agent registry (ConfigMap content changes rarely).
var (
	registryCache     []AgentRegistryEntry
	registryCacheMu   sync.RWMutex
	registryCacheTime time.Time
)

const registryCacheTTL = 60 * time.Second

// loadAgentRegistry reads and parses the agent registry ConfigMap using the backend service account.
// Results are cached in-memory with a TTL since the ConfigMap content rarely changes.
func loadAgentRegistry() ([]AgentRegistryEntry, error) {
	registryCacheMu.RLock()
	if time.Since(registryCacheTime) < registryCacheTTL && registryCache != nil {
		defer registryCacheMu.RUnlock()
		return registryCache, nil
	}
	registryCacheMu.RUnlock()

	if K8sClientMw == nil {
		return nil, fmt.Errorf("backend K8s client not initialized")
	}

	cm, err := K8sClientMw.CoreV1().ConfigMaps(Namespace).Get(
		context.Background(), agentRegistryConfigMapName, v1.GetOptions{},
	)
	if err != nil {
		return nil, fmt.Errorf("failed to read ConfigMap %s: %w", agentRegistryConfigMapName, err)
	}

	rawJSON, ok := cm.Data[agentRegistryDataKey]
	if !ok {
		return nil, fmt.Errorf("ConfigMap %s missing key %q", agentRegistryConfigMapName, agentRegistryDataKey)
	}

	var entries []AgentRegistryEntry
	if err := json.Unmarshal([]byte(rawJSON), &entries); err != nil {
		return nil, fmt.Errorf("failed to parse agent registry JSON: %w", err)
	}

	registryCacheMu.Lock()
	registryCache = entries
	registryCacheTime = time.Now()
	registryCacheMu.Unlock()

	return entries, nil
}

// getRunnerTypeConfig returns the full registry entry (including internalEnvVars) for the given runner type ID.
// Returns nil if not found.
func getRunnerTypeConfig(runnerTypeID string) (*AgentRegistryEntry, error) {
	entries, err := loadAgentRegistry()
	if err != nil {
		return nil, err
	}

	for i := range entries {
		if entries[i].ID == runnerTypeID {
			return &entries[i], nil
		}
	}
	return nil, nil
}

// runnerFlagName returns the feature flag name for a runner type.
// Convention: "runner.<id>.enabled" (e.g. "runner.gemini-cli.enabled").
// The default runner (claude-agent-sdk) has no flag — always enabled.
func runnerFlagName(runnerID string) string {
	if runnerID == DefaultRunnerType {
		return "" // default runner is always enabled
	}
	return "runner." + runnerID + ".enabled"
}

// isRunnerEnabled checks if a runner type is enabled via feature flags.
// The default runner is always enabled. Other runners require their
// feature flag to be explicitly enabled.
func isRunnerEnabled(runnerID string) bool {
	flag := runnerFlagName(runnerID)
	if flag == "" {
		return true // default runner
	}
	return FeatureEnabled(flag)
}

// GetRunnerTypes handles GET /api/runner-types and returns the list of available runner types
// with internalEnvVars excluded. Runners gated by feature flags are filtered out.
func GetRunnerTypes(c *gin.Context) {
	entries, err := loadAgentRegistry()
	if err != nil {
		log.Printf("Failed to load agent registry: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to load runner types"})
		return
	}

	resp := make([]RunnerTypeResponse, 0, len(entries))
	for _, e := range entries {
		if !isRunnerEnabled(e.ID) {
			continue
		}
		resp = append(resp, RunnerTypeResponse{
			ID:              e.ID,
			DisplayName:     e.DisplayName,
			Description:     e.Description,
			DefaultModel:    e.DefaultModel,
			Models:          e.Models,
			RequiredSecrets: e.RequiredSecrets,
		})
	}

	c.JSON(http.StatusOK, resp)
}
