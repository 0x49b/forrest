import { PackageJson } from '../types';

const NPM_REGISTRY_BASE = 'https://registry.npmjs.org';

export const fetchPackageJson = async (packageName: string, version?: string): Promise<PackageJson> => {
  try {
    // Clean version string (remove ^, ~, >=, etc.)
    const cleanVersion = version ? version.replace(/^[\^~>=<]+/, '') : 'latest';
    
    console.log(`Fetching package data for: ${packageName}@${cleanVersion}`);
    
    // First, try to get the package metadata
    const response = await fetch(`${NPM_REGISTRY_BASE}/${encodeURIComponent(packageName)}`, {
      headers: {
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch package ${packageName}: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    
    // Get the latest version if no specific version requested
    let targetVersion = cleanVersion;
    if (cleanVersion === 'latest') {
      targetVersion = data['dist-tags']?.latest;
      if (!targetVersion) {
        throw new Error(`No latest version found for ${packageName}`);
      }
    }
    
    // Find the best matching version
    let versionData = data.versions?.[targetVersion];
    
    if (!versionData) {
      // Try to find a compatible version
      const availableVersions = Object.keys(data.versions || {});
      const compatibleVersion = findBestMatch(availableVersions, targetVersion);
      
      if (compatibleVersion) {
        versionData = data.versions[compatibleVersion];
        console.log(`Using compatible version ${compatibleVersion} for ${packageName}@${targetVersion}`);
      } else {
        // Fall back to latest
        const latestVersion = data['dist-tags']?.latest;
        if (latestVersion && data.versions[latestVersion]) {
          versionData = data.versions[latestVersion];
          console.log(`Falling back to latest version ${latestVersion} for ${packageName}@${targetVersion}`);
        }
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
  } catch (error) {
    console.error(`Error fetching ${packageName}@${version}:`, error);
    throw new Error(`Failed to fetch ${packageName}@${version || 'latest'}: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
};

const findBestMatch = (availableVersions: string[], targetVersion: string): string | null => {
  // Sort versions in descending order
  const sortedVersions = availableVersions
    .filter(v => /^\d+\.\d+\.\d+/.test(v)) // Only consider semantic versions
    .sort((a, b) => compareVersions(b, a));
  
  // If target is a range (like ^1.0.0), find compatible versions
  if (targetVersion.includes('.')) {
    const targetParts = targetVersion.split('.').map(part => parseInt(part.replace(/\D/g, ''), 10));
    
    for (const version of sortedVersions) {
      const versionParts = version.split('.').map(part => parseInt(part.replace(/\D/g, ''), 10));
      
      // For caret ranges (^1.2.3), allow same major version with higher minor/patch
      if (versionParts[0] === targetParts[0] && 
          (versionParts[1] > targetParts[1] || 
           (versionParts[1] === targetParts[1] && versionParts[2] >= targetParts[2]))) {
        return version;
      }
    }
  }
  
  // If no compatible version found, return the latest
  return sortedVersions[0] || null;
};

const compareVersions = (a: string, b: string): number => {
  const aParts = a.split('.').map(part => parseInt(part.replace(/\D/g, ''), 10));
  const bParts = b.split('.').map(part => parseInt(part.replace(/\D/g, ''), 10));
  
  for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
    const aPart = aParts[i] || 0;
    const bPart = bParts[i] || 0;
    
    if (aPart !== bPart) {
      return aPart - bPart;
    }
  }
  
  return 0;
};