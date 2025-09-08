import { PackageJson } from '../types';

const NPM_REGISTRY_BASE = 'https://registry.npmjs.org';

export const fetchPackageJson = async (packageName: string, version?: string): Promise<PackageJson> => {
  try {
    // Clean version string (remove ^, ~, >=, etc.)
    const cleanVersion = version ? version.replace(/^[\^~>=<\s]+/, '') : 'latest';
    
    console.log(`Fetching package data for: ${packageName}@${cleanVersion}`);
    
    // Encode package name to handle scoped packages
    const encodedPackageName = encodeURIComponent(packageName);
    
    // First, try to get the package metadata
    const response = await fetch(`${NPM_REGISTRY_BASE}/${encodedPackageName}`, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'dependency-analyzer'
      }
    });

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(`Package "${packageName}" not found`);
      }
      throw new Error(`Failed to fetch package ${packageName}: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    
    if (!data.versions || Object.keys(data.versions).length === 0) {
      throw new Error(`No versions available for package ${packageName}`);
    }
    
    // Get the target version
    let targetVersion = cleanVersion;
    if (cleanVersion === 'latest' || !cleanVersion) {
      targetVersion = data['dist-tags']?.latest;
      if (!targetVersion) {
        // Fallback to the highest version
        const versions = Object.keys(data.versions).sort(compareVersions).reverse();
        targetVersion = versions[0];
      }
    }
    
    // Find the best matching version
    let versionData = data.versions[targetVersion];
    
    if (!versionData) {
      // Try to find a compatible version
      const availableVersions = Object.keys(data.versions);
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
        } else {
          // Use the most recent version available
          const sortedVersions = availableVersions.sort(compareVersions).reverse();
          if (sortedVersions.length > 0) {
            versionData = data.versions[sortedVersions[0]];
            console.log(`Using most recent version ${sortedVersions[0]} for ${packageName}@${targetVersion}`);
          }
        }
      }
    }
    
    if (!versionData) {
      throw new Error(`No compatible version found for ${packageName}@${targetVersion}`);
    }
    
    return {
      name: versionData.name || packageName,
      version: versionData.version || targetVersion,
      description: versionData.description,
      dependencies: versionData.dependencies || {},
      devDependencies: versionData.devDependencies || {},
      homepage: versionData.homepage,
      repository: versionData.repository,
      license: versionData.license
    };
  } catch (error) {
    console.error(`Error fetching ${packageName}@${version}:`, error);
    
    if (error instanceof Error) {
      throw error;
    }
    
    throw new Error(`Failed to fetch ${packageName}@${version || 'latest'}: Unknown error`);
  }
};

const findBestMatch = (availableVersions: string[], targetVersion: string): string | null => {
  if (!targetVersion || targetVersion === 'latest') {
    return null;
  }

  // Sort versions in descending order
  const sortedVersions = availableVersions
    .filter(v => /^\d+\.\d+\.\d+/.test(v)) // Only consider semantic versions
    .sort(compareVersions)
    .reverse();
  
  // Try exact match first
  if (sortedVersions.includes(targetVersion)) {
    return targetVersion;
  }
  
  // If target is a range (like ^1.0.0), find compatible versions
  if (targetVersion.includes('.')) {
    const targetParts = parseVersion(targetVersion);
    if (!targetParts) return sortedVersions[0] || null;
    
    for (const version of sortedVersions) {
      const versionParts = parseVersion(version);
      if (!versionParts) continue;
      
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

const parseVersion = (version: string): [number, number, number] | null => {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  
  return [
    parseInt(match[1], 10),
    parseInt(match[2], 10),
    parseInt(match[3], 10)
  ];
};

const compareVersions = (a: string, b: string): number => {
  const aParts = parseVersion(a);
  const bParts = parseVersion(b);
  
  if (!aParts || !bParts) return 0;
  
  for (let i = 0; i < 3; i++) {
    if (aParts[i] !== bParts[i]) {
      return aParts[i] - bParts[i];
    }
  }
  
  return 0;
};