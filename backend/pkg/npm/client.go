package npm

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"forrest/backend/pkg/cache"
	"forrest/backend/pkg/models"
	"net/http"
	"net/url"
	"strings"
	"time"

	"golang.org/x/sync/singleflight"
)

const NPMRegistry = "https://registry.npmjs.org"

// abbreviatedAccept requests the "corgi" metadata document, which is a
// fraction of the size of the full packument and contains everything
// needed to resolve a version range.
const abbreviatedAccept = "application/vnd.npm.install-v1+json"

// ErrNotFound is returned when the package or version does not exist.
var ErrNotFound = errors.New("not found")

// Config holds NPM client configuration
type Config struct {
	RegistryURL string
	Timeout     time.Duration
	// IndexCacheSize and IndexTTL bound the cache of per-package version
	// lists used for range resolution.
	IndexCacheSize int
	IndexTTL       time.Duration
}

// versionIndex is the minimal data needed to resolve a version range.
type versionIndex struct {
	versions []string
	distTags map[string]string
}

// Client handles NPM registry interactions
type Client struct {
	httpClient  *http.Client
	registryURL string
	indexCache  *cache.LRU[*versionIndex]
	indexGroup  singleflight.Group
}

// NewClient creates a new NPM client
func NewClient(config Config) *Client {
	if config.IndexCacheSize == 0 {
		config.IndexCacheSize = 5000
	}
	if config.IndexTTL == 0 {
		config.IndexTTL = 10 * time.Minute
	}

	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.MaxIdleConns = 200
	transport.MaxIdleConnsPerHost = 100
	transport.IdleConnTimeout = 90 * time.Second
	transport.ForceAttemptHTTP2 = true

	return &Client{
		httpClient: &http.Client{
			Timeout:   config.Timeout,
			Transport: transport,
		},
		registryURL: strings.TrimSuffix(config.RegistryURL, "/"),
		indexCache:  cache.NewLRU[*versionIndex](config.IndexCacheSize, config.IndexTTL),
	}
}

// FetchPackage resolves spec for packageName and returns the matching
// version's metadata.
func (c *Client) FetchPackage(ctx context.Context, packageName, spec string) (*models.DependencyNode, error) {
	packageName, spec = resolveAlias(packageName, strings.TrimSpace(spec))

	if isSpecialDependency(spec) {
		return &models.DependencyNode{
			Name:              packageName,
			Version:           spec,
			Description:       fmt.Sprintf("Local or external dependency (%s)", spec),
			Dependencies:      map[string]string{},
			DevDependencies:   map[string]string{},
			Loaded:            true,
			ChildrenLoaded:    true,
			HasNoDependencies: true,
		}, nil
	}

	version, err := c.resolveVersion(ctx, packageName, spec)
	if err != nil {
		return nil, err
	}

	manifest, err := c.fetchManifest(ctx, packageName, version)
	if err != nil {
		return nil, err
	}

	return manifest.toNode(), nil
}

// resolveVersion maps a spec to a concrete version or dist-tag that the
// registry can serve directly. Exact versions and dist-tags need no
// extra request.
func (c *Client) resolveVersion(ctx context.Context, name, spec string) (string, error) {
	if spec == "" || spec == "*" || spec == "x" || spec == "latest" {
		return "latest", nil
	}
	if isExactVersion(spec) {
		return strings.TrimPrefix(strings.TrimPrefix(spec, "="), "v"), nil
	}

	idx, err := c.fetchIndex(ctx, name)
	if err != nil {
		return "", err
	}
	if v := resolve(spec, idx.versions, idx.distTags); v != "" {
		return v, nil
	}
	return "", fmt.Errorf("no compatible version found for %s@%s", name, spec)
}

// fetchIndex returns the version list of a package. Concurrent callers
// for the same package share one request.
func (c *Client) fetchIndex(ctx context.Context, name string) (*versionIndex, error) {
	if idx, ok := c.indexCache.Get(name); ok {
		return idx, nil
	}

	v, err, _ := c.indexGroup.Do(name, func() (interface{}, error) {
		if idx, ok := c.indexCache.Get(name); ok {
			return idx, nil
		}

		var doc struct {
			DistTags map[string]string   `json:"dist-tags"`
			Versions map[string]struct{} `json:"versions"`
		}
		// The result is shared between callers, so one cancelled
		// caller must not fail the others; the HTTP client timeout
		// still bounds the request.
		if err := c.getJSON(context.WithoutCancel(ctx), c.packageURL(name), abbreviatedAccept, &doc); err != nil {
			if errors.Is(err, ErrNotFound) {
				return nil, fmt.Errorf("package %s not found", name)
			}
			return nil, err
		}
		if len(doc.Versions) == 0 {
			return nil, fmt.Errorf("no versions available for %s", name)
		}

		idx := &versionIndex{
			versions: make([]string, 0, len(doc.Versions)),
			distTags: doc.DistTags,
		}
		for v := range doc.Versions {
			idx.versions = append(idx.versions, v)
		}
		c.indexCache.Set(name, idx)
		return idx, nil
	})
	if err != nil {
		return nil, err
	}
	return v.(*versionIndex), nil
}

func (c *Client) fetchManifest(ctx context.Context, name, version string) (*manifest, error) {
	var m manifest
	err := c.getJSON(ctx, c.packageURL(name)+"/"+url.PathEscape(version), "application/json", &m)
	if errors.Is(err, ErrNotFound) {
		return nil, fmt.Errorf("version %s of %s not found", version, name)
	}
	if err != nil {
		return nil, err
	}
	return &m, nil
}

func (c *Client) packageURL(name string) string {
	return c.registryURL + "/" + url.PathEscape(name)
}

func (c *Client) getJSON(ctx context.Context, reqURL, accept string, out interface{}) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, reqURL, nil)
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}
	req.Header.Set("Accept", accept)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("failed to fetch %s: %w", reqURL, err)
	}
	defer resp.Body.Close()

	switch {
	case resp.StatusCode == http.StatusNotFound:
		return ErrNotFound
	case resp.StatusCode != http.StatusOK:
		return fmt.Errorf("npm registry returned status %d for %s", resp.StatusCode, reqURL)
	}

	if err := json.NewDecoder(resp.Body).Decode(out); err != nil {
		return fmt.Errorf("failed to decode response: %w", err)
	}
	return nil
}

// resolveAlias unwraps npm: aliases, both in the name
// ("jiti-v2.1@npm:jiti@2.1.x") and in the spec ("npm:jiti@2.1.x").
func resolveAlias(name, spec string) (string, string) {
	if i := strings.Index(name, "@npm:"); i >= 0 {
		name, spec = splitNameSpec(name[i+len("@npm:"):], spec)
	}
	if strings.HasPrefix(spec, "npm:") {
		name, spec = splitNameSpec(strings.TrimPrefix(spec, "npm:"), "latest")
	}
	return name, spec
}

// splitNameSpec splits "name@spec" while respecting scoped names
// ("@scope/name@spec").
func splitNameSpec(s, fallbackSpec string) (string, string) {
	if i := strings.LastIndex(s, "@"); i > 0 {
		return s[:i], s[i+1:]
	}
	return s, fallbackSpec
}

var specialPrefixes = []string{
	"file:", "link:", "workspace:", "portal:", "patch:",
	"git:", "git+", "git://", "github:", "gitlab:", "bitbucket:", "gist:",
	"http://", "https://",
}

// isSpecialDependency reports whether spec points outside the registry.
func isSpecialDependency(spec string) bool {
	for _, prefix := range specialPrefixes {
		if strings.HasPrefix(spec, prefix) {
			return true
		}
	}
	// GitHub shorthand: "user/repo" or "user/repo#ref"
	return strings.Contains(spec, "/")
}

// manifest is a single version document from the registry. repository
// and license come in several shapes in the wild, so they are decoded
// lazily.
type manifest struct {
	Name            string            `json:"name"`
	Version         string            `json:"version"`
	Description     string            `json:"description"`
	Dependencies    map[string]string `json:"dependencies"`
	DevDependencies map[string]string `json:"devDependencies"`
	Homepage        string            `json:"homepage"`
	Repository      json.RawMessage   `json:"repository"`
	License         json.RawMessage   `json:"license"`
}

func (m *manifest) toNode() *models.DependencyNode {
	deps := m.Dependencies
	if deps == nil {
		deps = map[string]string{}
	}
	devDeps := m.DevDependencies
	if devDeps == nil {
		devDeps = map[string]string{}
	}

	return &models.DependencyNode{
		Name:              m.Name,
		Version:           m.Version,
		Description:       m.Description,
		Dependencies:      deps,
		DevDependencies:   devDeps,
		Homepage:          m.Homepage,
		Repository:        parseRepository(m.Repository),
		License:           parseLicense(m.License),
		Loaded:            true,
		ChildrenLoaded:    true,
		HasNoDependencies: len(deps) == 0 && len(devDeps) == 0,
	}
}

func parseRepository(raw json.RawMessage) *models.Repository {
	if len(raw) == 0 {
		return nil
	}
	var repo models.Repository
	if err := json.Unmarshal(raw, &repo); err == nil && repo.URL != "" {
		return &repo
	}
	var s string
	if err := json.Unmarshal(raw, &s); err == nil && s != "" {
		return &models.Repository{Type: "git", URL: s}
	}
	return nil
}

func parseLicense(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	var s string
	if err := json.Unmarshal(raw, &s); err == nil {
		return s
	}
	var obj struct {
		Type string `json:"type"`
	}
	if err := json.Unmarshal(raw, &obj); err == nil {
		return obj.Type
	}
	return ""
}
