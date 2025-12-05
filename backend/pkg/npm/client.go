package npm

import (
	"context"
	"encoding/json"
	"fmt"
	"forrest/backend/pkg/models"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const NPMRegistry = "https://registry.npmjs.org"

// Config holds NPM client configuration
type Config struct {
	RegistryURL string
	Timeout     time.Duration
}

// Client handles NPM registry interactions
type Client struct {
	httpClient  *http.Client
	registryURL string
}

// NewClient creates a new NPM client
func NewClient(config Config) *Client {
	return &Client{
		httpClient: &http.Client{
			Timeout: config.Timeout,
			Transport: &http.Transport{
				MaxIdleConns:        200,
				MaxIdleConnsPerHost: 100,
				IdleConnTimeout:     90 * time.Second,
			},
		},
		registryURL: config.RegistryURL,
	}
}

// FetchPackage fetches package metadata from NPM registry
func (c *Client) FetchPackage(ctx context.Context, packageName, version string) (*models.DependencyNode, error) {
	// Handle npm: aliases (e.g., "jiti-v2.1@npm:jiti@2.1.x")
	if strings.Contains(packageName, "@npm:") {
		parts := strings.Split(packageName, "@npm:")
		if len(parts) == 2 {
			actualPackage := parts[1]
			if strings.Contains(actualPackage, "@") {
				pkgParts := strings.SplitN(actualPackage, "@", 2)
				return c.FetchPackage(ctx, pkgParts[0], pkgParts[1])
			}
			return c.FetchPackage(ctx, actualPackage, version)
		}
	}

	// Handle version strings with npm: prefix
	if strings.HasPrefix(version, "npm:") {
		npmPart := strings.TrimPrefix(version, "npm:")
		if strings.Contains(npmPart, "@") {
			pkgParts := strings.SplitN(npmPart, "@", 2)
			return c.FetchPackage(ctx, pkgParts[0], pkgParts[1])
		}
		return c.FetchPackage(ctx, npmPart, "latest")
	}

	// Handle special dependency types
	if c.isSpecialDependency(version) {
		return &models.DependencyNode{
			Name:              packageName,
			Version:           version,
			Description:       fmt.Sprintf("Local or external dependency (%s)", version),
			Dependencies:      make(map[string]string),
			DevDependencies:   make(map[string]string),
			Loaded:            true,
			Loading:           false,
			ChildrenLoaded:    true,
			HasNoDependencies: true,
		}, nil
	}

	// Clean version string
	cleanVersion := c.cleanVersion(version)

	// Encode package name for URL
	encodedPackage := url.PathEscape(packageName)

	// Fetch package metadata
	reqURL := fmt.Sprintf("%s/%s", c.registryURL, encodedPackage)
	req, err := http.NewRequestWithContext(ctx, "GET", reqURL, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Accept", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch package: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		return nil, fmt.Errorf("package %s not found", packageName)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("npm registry returned status %d", resp.StatusCode)
	}

	var packageData struct {
		Name     string                         `json:"name"`
		Versions map[string]*models.PackageJSON `json:"versions"`
		DistTags map[string]string              `json:"dist-tags"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&packageData); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	if len(packageData.Versions) == 0 {
		return nil, fmt.Errorf("no versions available for %s", packageName)
	}

	// Find target version
	targetVersion := c.findBestVersion(cleanVersion, packageData.Versions, packageData.DistTags)
	if targetVersion == "" {
		return nil, fmt.Errorf("no compatible version found for %s@%s", packageName, version)
	}

	versionData := packageData.Versions[targetVersion]
	if versionData == nil {
		return nil, fmt.Errorf("version data not found for %s@%s", packageName, targetVersion)
	}

	// Create dependency node
	node := &models.DependencyNode{
		Name:              versionData.Name,
		Version:           versionData.Version,
		Description:       versionData.Description,
		Dependencies:      versionData.Dependencies,
		DevDependencies:   versionData.DevDependencies,
		Homepage:          versionData.Homepage,
		Repository:        versionData.Repository,
		License:           versionData.License,
		Loaded:            true,
		Loading:           false,
		ChildrenLoaded:    true,
		HasNoDependencies: len(versionData.Dependencies) == 0 && len(versionData.DevDependencies) == 0,
	}

	// Initialize empty maps if nil
	if node.Dependencies == nil {
		node.Dependencies = make(map[string]string)
	}
	if node.DevDependencies == nil {
		node.DevDependencies = make(map[string]string)
	}

	return node, nil
}

// isSpecialDependency checks if version is a special dependency type
func (c *Client) isSpecialDependency(version string) bool {
	prefixes := []string{"file:", "git+", "http://", "https://", "link:", "workspace:"}
	for _, prefix := range prefixes {
		if strings.HasPrefix(version, prefix) {
			return true
		}
	}
	return false
}

// cleanVersion removes version prefixes
func (c *Client) cleanVersion(version string) string {
	// Remove common prefixes
	version = strings.TrimPrefix(version, "^")
	version = strings.TrimPrefix(version, "~")
	version = strings.TrimPrefix(version, ">=")
	version = strings.TrimPrefix(version, ">")
	version = strings.TrimPrefix(version, "<=")
	version = strings.TrimPrefix(version, "<")
	version = strings.TrimPrefix(version, "=")
	version = strings.TrimSpace(version)

	if version == "" || version == "*" || version == "x" {
		return "latest"
	}

	return version
}

// findBestVersion finds the best matching version
func (c *Client) findBestVersion(targetVersion string, versions map[string]*models.PackageJSON, distTags map[string]string) string {
	// Handle "latest"
	if targetVersion == "latest" || targetVersion == "" {
		if latest, ok := distTags["latest"]; ok {
			if _, exists := versions[latest]; exists {
				return latest
			}
		}
		// Fallback to highest version
		return c.getHighestVersion(versions)
	}

	// Try exact match
	if _, ok := versions[targetVersion]; ok {
		return targetVersion
	}

	// Try to find compatible version using semver
	compatible := c.findCompatibleVersion(targetVersion, versions)
	if compatible != "" {
		return compatible
	}

	// Fallback to latest
	if latest, ok := distTags["latest"]; ok {
		if _, exists := versions[latest]; exists {
			return latest
		}
	}

	// Last resort: highest version
	return c.getHighestVersion(versions)
}

// getHighestVersion returns the highest semver version
func (c *Client) getHighestVersion(versions map[string]*models.PackageJSON) string {
	var highest string
	for v := range versions {
		if highest == "" {
			highest = v
			continue
		}
		if CompareVersions(v, highest) > 0 {
			highest = v
		}
	}
	return highest
}

// findCompatibleVersion finds a version compatible with target
func (c *Client) findCompatibleVersion(target string, versions map[string]*models.PackageJSON) string {
	targetParts := ParseVersion(target)
	if targetParts == nil {
		return ""
	}

	var compatible []string
	for v := range versions {
		vParts := ParseVersion(v)
		if vParts == nil {
			continue
		}

		// For caret ranges (^1.2.3), allow same major version
		if vParts[0] == targetParts[0] &&
			(vParts[1] > targetParts[1] ||
				(vParts[1] == targetParts[1] && vParts[2] >= targetParts[2])) {
			compatible = append(compatible, v)
		}
	}

	if len(compatible) == 0 {
		return ""
	}

	// Return the highest compatible version
	highest := compatible[0]
	for _, v := range compatible[1:] {
		if CompareVersions(v, highest) > 0 {
			highest = v
		}
	}

	return highest
}
