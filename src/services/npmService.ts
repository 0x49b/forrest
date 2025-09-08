import { PackageJson } from '../types';

const NPM_REGISTRY_BASE = 'https://registry.npmjs.org';

export const fetchPackageJson = async (packageName: string, version?: string): Promise<PackageJson> => {
  try {
    // Clean version string (remove ^, ~, >=, etc.)
    const cleanVersion = version ? version.replace(/^[\^~>=<]+/, '') : 'latest';
    
    let url: string;
    if (cleanVersion === 'latest') {
      url = `${NPM_REGISTRY_BASE}/${encodeURIComponent(packageName)}/latest`;
    } else {
      // Fetch specific version data directly
      url = `${NPM_REGISTRY_BASE}/${encodeURIComponent(packageName)}/${cleanVersion}`;
    }

    console.log(`Fetching package data from: ${url}`);
    
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      // If specific version fails, try getting all versions and find the best match
      if (cleanVersion !== 'latest') {
        console.log(`Direct version fetch failed, trying to get all versions for ${packageName}`);
        return await fetchFromAllVersions(packageName, cleanVersion);
      }
      throw new Error(`Failed to fetch package ${packageName}@${cleanVersion}: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    
    return {
      name: data.name,
      version: data.version,
      description: data.description,
      dependencies: data.dependencies || {},
      devDependencies: data.devDependencies || {},
      homepage: data.homepage,
      repository: data.repository,
      license: data.license
    };
  } catch (error) {
    console.error(`Error fetching ${packageName}@${version}:`, error);
    throw new Error(`Failed to fetch ${packageName}@${version || 'latest'}: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
};

const fetchFromAllVersions = async (packageName: string, targetVersion: string): Promise<PackageJson> => {
  const response = await fetch(`${NPM_REGISTRY_BASE}/${encodeURIComponent(packageName)}`, {
    headers: {
      'Accept': 'application/json'
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch package ${packageName}: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  
  // Try to find the exact version or a compatible one
  let versionData = data.versions?.[targetVersion];
  
  if (!versionData) {
    // Try to find a compatible version (for ranges like ^18.0.0)
    const availableVersions = Object.keys(data.versions || {});
    const compatibleVersion = findCompatibleVersion(availableVersions, targetVersion);
    
    if (compatibleVersion) {
      versionData = data.versions[compatibleVersion];
    } else {
      // Fall back to latest
      const latestVersion = data['dist-tags']?.latest;
      versionData = latestVersion ? data.versions[latestVersion] : null;
    }
  }
  
  if (!versionData) {
    throw new Error(`No compatible version found for ${packageName}@${targetVersion}`);
  }
  
  return {
    name: versionData.name,
    version: versionData.version,
    description: versionData.description,
    dependencies: versionData.dependencies || {},
    devDependencies: versionData.devDependencies || {},
    homepage: versionData.homepage,
    repository: versionData.repository,
    license: versionData.license
  };
};

const findCompatibleVersion = (availableVersions: string[], targetVersion: string): string | null => {
  // Simple version matching - in a real app you'd use semver library
  const target = targetVersion.split('.').map(Number);
  
  for (const version of availableVersions.sort().reverse()) {
    const current = version.split('.').map(Number);
    
    // Check if it's a compatible version (same major version, >= minor.patch)
    if (current[0] === target[0] && 
        (current[1] > target[1] || 
         (current[1] === target[1] && current[2] >= target[2]))) {
      return version;
    }
  }
  
  return null;
};