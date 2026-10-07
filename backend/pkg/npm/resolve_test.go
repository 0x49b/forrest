package npm

import "testing"

func TestResolve(t *testing.T) {
	versions := []string{"0.9.0", "1.0.0", "1.2.3", "1.2.9", "1.3.0", "1.4.0-beta.1", "2.0.0", "2.1.0", "3.0.0-rc.1"}
	tags := map[string]string{"latest": "2.1.0", "next": "3.0.0-rc.1"}

	tests := []struct {
		spec string
		want string
	}{
		{"^1.2.3", "1.3.0"},
		{"~1.2.3", "1.2.9"},
		{"1.x", "1.3.0"},
		{">=1.0.0 <2.0.0", "1.3.0"},
		{"^1.0.0 || ^2.0.0", "2.1.0"},
		{"^0.9.0", "0.9.0"},
		{"next", "3.0.0-rc.1"},
		{"^5.0.0", "2.1.0"},      // nothing matches -> latest
		{"not a range", "2.1.0"}, // unparsable -> latest
	}
	for _, tt := range tests {
		if got := resolve(tt.spec, versions, tags); got != tt.want {
			t.Errorf("resolve(%q) = %q, want %q", tt.spec, got, tt.want)
		}
	}
}

func TestResolveAlias(t *testing.T) {
	tests := []struct {
		name, spec         string
		wantName, wantSpec string
	}{
		{"string-width-cjs", "npm:string-width@^4.2.0", "string-width", "^4.2.0"},
		{"foo", "npm:@scope/bar@1.0.0", "@scope/bar", "1.0.0"},
		{"foo", "npm:bar", "bar", "latest"},
		{"jiti-v2.1@npm:jiti@2.1.x", "", "jiti", "2.1.x"},
		{"react", "^18.0.0", "react", "^18.0.0"},
	}
	for _, tt := range tests {
		n, s := resolveAlias(tt.name, tt.spec)
		if n != tt.wantName || s != tt.wantSpec {
			t.Errorf("resolveAlias(%q, %q) = %q, %q; want %q, %q", tt.name, tt.spec, n, s, tt.wantName, tt.wantSpec)
		}
	}
}

func TestIsSpecialDependency(t *testing.T) {
	for _, s := range []string{"file:../x", "git+https://x", "github:a/b", "a/b#main", "workspace:*"} {
		if !isSpecialDependency(s) {
			t.Errorf("expected %q to be special", s)
		}
	}
	for _, s := range []string{"^1.0.0", "latest", "1.x"} {
		if isSpecialDependency(s) {
			t.Errorf("expected %q not to be special", s)
		}
	}
}
