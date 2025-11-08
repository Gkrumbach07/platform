package handlers

import (
	"net/http"
	"os"
	"strings"

	"github.com/gin-gonic/gin"
)

type OOTBWorkflow struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	GitURL      string `json:"gitUrl"`
	Branch      string `json:"branch"`
	Path        string `json:"path,omitempty"`
	Enabled     bool   `json:"enabled"`
}

// ListOOTBWorkflows returns the list of out-of-the-box workflows
// Configuration comes from environment variables with sensible defaults
func ListOOTBWorkflows(c *gin.Context) {
	// Read OOTB workflow configuration from environment
	specKitRepo := strings.TrimSpace(os.Getenv("OOTB_SPEC_KIT_REPO"))
	if specKitRepo == "" {
		specKitRepo = "https://github.com/Gkrumbach07/spec-kit-template.git"
	}
	specKitBranch := strings.TrimSpace(os.Getenv("OOTB_SPEC_KIT_BRANCH"))
	if specKitBranch == "" {
		specKitBranch = "main"
	}
	specKitPath := strings.TrimSpace(os.Getenv("OOTB_SPEC_KIT_PATH"))
	if specKitPath == "" {
		specKitPath = "workflows/spec-kit"
	}

	bugFixRepo := strings.TrimSpace(os.Getenv("OOTB_BUG_FIX_REPO"))
	bugFixBranch := strings.TrimSpace(os.Getenv("OOTB_BUG_FIX_BRANCH"))
	if bugFixBranch == "" {
		bugFixBranch = "main"
	}
	bugFixPath := strings.TrimSpace(os.Getenv("OOTB_BUG_FIX_PATH"))

	workflows := []OOTBWorkflow{
		{
			ID:          "spec-kit",
			Name:        "Spec Kit Workflow",
			Description: "Comprehensive workflow for planning and implementing features using a specification-first approach",
			GitURL:      specKitRepo,
			Branch:      specKitBranch,
			Path:        specKitPath,
			Enabled:     true,
		},
		{
			ID:          "bug-fix",
			Name:        "Bug Fix Workflow",
			Description: "Streamlined workflow for bug triage, reproduction, and fixes (Coming Soon)",
			GitURL:      bugFixRepo,
			Branch:      bugFixBranch,
			Path:        bugFixPath,
			Enabled:     bugFixRepo != "", // Only enabled if configured
		},
	}

	c.JSON(http.StatusOK, gin.H{"workflows": workflows})
}

