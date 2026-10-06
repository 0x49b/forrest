package npm

import (
	"strings"

	"github.com/Masterminds/semver/v3"
)

// isExactVersion reports whether spec is a single concrete version
// ("1.2.3", "=1.2.3", "v1.2.3", "1.2.3-beta.1").
func isExactVersion(spec string) bool {
	s := strings.TrimPrefix(spec, "=")
	_, err := semver.StrictNewVersion(strings.TrimPrefix(s, "v"))
	return err == nil
}

// resolve picks the highest version satisfying spec, following npm
// semantics: dist-tags are honoured and prereleases only match when the
// range itself names a prerelease. Falls back to the "latest" dist-tag
// when spec cannot be parsed or nothing satisfies it.
func resolve(spec string, versions []string, distTags map[string]string) string {
	if v, ok := distTags[spec]; ok {
		return v
	}

	constraint, err := semver.NewConstraint(spec)
	if err != nil {
		return fallbackLatest(versions, distTags)
	}

	var best *semver.Version
	var bestRaw string
	for _, raw := range versions {
		v, err := semver.NewVersion(raw)
		if err != nil || !constraint.Check(v) {
			continue
		}
		if best == nil || v.GreaterThan(best) {
			best, bestRaw = v, raw
		}
	}
	if best != nil {
		return bestRaw
	}
	return fallbackLatest(versions, distTags)
}

func fallbackLatest(versions []string, distTags map[string]string) string {
	if v, ok := distTags["latest"]; ok {
		return v
	}
	var best *semver.Version
	var bestRaw string
	for _, raw := range versions {
		v, err := semver.NewVersion(raw)
		if err != nil || v.Prerelease() != "" {
			continue
		}
		if best == nil || v.GreaterThan(best) {
			best, bestRaw = v, raw
		}
	}
	return bestRaw
}
