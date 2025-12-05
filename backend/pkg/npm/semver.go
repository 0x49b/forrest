package npm

import (
	"regexp"
	"strconv"
)

var versionRegex = regexp.MustCompile(`^(\d+)\.(\d+)\.(\d+)(?:-[\w.-]+)?(?:\+[\w.-]+)?$`)

// ParseVersion parses a semantic version string into [major, minor, patch]
func ParseVersion(version string) []int {
	matches := versionRegex.FindStringSubmatch(version)
	if matches == nil {
		return nil
	}

	major, _ := strconv.Atoi(matches[1])
	minor, _ := strconv.Atoi(matches[2])
	patch, _ := strconv.Atoi(matches[3])

	return []int{major, minor, patch}
}

// CompareVersions compares two semantic versions
// Returns: -1 if a < b, 0 if a == b, 1 if a > b
func CompareVersions(a, b string) int {
	aParts := ParseVersion(a)
	bParts := ParseVersion(b)

	if aParts == nil || bParts == nil {
		return 0
	}

	for i := 0; i < 3; i++ {
		if aParts[i] < bParts[i] {
			return -1
		}
		if aParts[i] > bParts[i] {
			return 1
		}
	}

	return 0
}
