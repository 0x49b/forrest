import { PackageJson } from '../types';

const NPM_REGISTRY_BASE = 'https://registry.npmjs.org';

interface WorkerMessage {
  type: 'LOAD_DEPENDENCIES' | 'LOAD_SINGLE_DEPENDENCY';
  payload: {
    packageName: string;
    version: string;
    maxLevel?: number;
    currentLevel?: number;
    visited?: string[];
  };
  id: string;
}

interface WorkerResponse {
  type: 'DEPENDENCY_LOADED' | 'DEPENDENCIES_COMPLETE' | 'DEPENDENCY_ERROR' | 'PROGRESS_UPDATE';
  payload: any;
  id: string;
}

const fetchPackageJson = async (packageName: string, version?: string): Promise<PackageJson> => {
  try {
    // Handle npm: aliases (e.g., "jiti-v2.1@npm:jiti@2.1.x")
    if (packageName.includes('@npm:')) {
      const parts = packageName.split('@npm:');
      if (parts.length === 2) {
        const actualPackage = parts[1];
        const [actualName, actualVersion] = actualPackage.includes('@') 
          ? actualPackage.split('@')
          : [actualPackage, version];
        return fetchPackageJson(actualName, actualVersion);
      }
    }
    
    // Handle version strings that contain npm: prefix (e.g., "npm:jiti@2.1.x")
    if (version && version.startsWith('npm:')) {
      const npmPart = version.substring(4); // Remove "npm:" prefix
      const [actualName, actualVersion] = npmPart.includes('@')
        ? npmPart.split('@')
        : [npmPart, 'latest'];
      return fetchPackageJson(actualName, actualVersion);
    }
    
    // Handle file:, git+, http://, https:// dependencies - return placeholder
    if (version && (
      version.startsWith('file:') ||
      version.startsWith('git+') ||
      version.startsWith('http://') ||
      version.startsWith('https://') ||
      version.startsWith('link:') ||
      version.startsWith('workspace:')
    )) {
      return {
        name: packageName,
        version: version,
        description: `Local or external dependency (${version})`,
        dependencies: {},
        devDependencies: {},
        homepage: undefined,
        repository: undefined,
        license: 'Unknown'
      };
    }
    
    // Clean version string (remove ^, ~, >=, etc.)
    const cleanVersion = version ? version.replace(/^[\^~>=<\s]+/, '') : 'latest';
    
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
      } else {
        // Fall back to latest
        const latestVersion = data['dist-tags']?.latest;
        if (latestVersion && data.versions[latestVersion]) {
          versionData = data.versions[latestVersion];
        } else {
          // Use the most recent version available
          const sortedVersions = availableVersions.sort(compareVersions).reverse();
          if (sortedVersions.length > 0) {
            versionData = data.versions[sortedVersions[0]];
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

const loadDependenciesRecursively = async (
  packageName: string,
  version: string,
  currentLevel: number,
  maxLevel: number,
  visited: Set<string>,
  messageId: string
) => {
  if (currentLevel >= maxLevel) return;
  
  const packageKey = `${packageName}@${version}`;
  if (visited.has(packageKey)) return;
  visited.add(packageKey);

  try {
    // Send progress update
    self.postMessage({
      type: 'PROGRESS_UPDATE',
      payload: {
        current: visited.size,
        total: visited.size + 1,
        currentPackage: packageName,
        level: currentLevel
      },
      id: messageId
    });

    const packageData = await fetchPackageJson(packageName, version);
    
    // Send the loaded dependency
    self.postMessage({
      type: 'DEPENDENCY_LOADED',
      payload: {
        name: packageName,
        version: packageData.version,
        description: packageData.description,
        dependencies: packageData.dependencies || {},
        devDependencies: packageData.devDependencies || {},
        loaded: true,
        loading: false,
        homepage: packageData.homepage,
        repository: packageData.repository,
        hasNoDependencies: !packageData.dependencies || Object.keys(packageData.dependencies).length === 0
      },
      id: messageId
    });

    // Load next level dependencies
    const deps = packageData.dependencies || {};
    const devDeps = packageData.devDependencies || {};
    
    const loadPromises = [
      ...Object.entries(deps).map(([depName, depVersion]) =>
        loadDependenciesRecursively(depName, depVersion, currentLevel + 1, maxLevel, visited, messageId)
      ),
      ...Object.entries(devDeps).map(([depName, depVersion]) =>
        loadDependenciesRecursively(depName, depVersion, currentLevel + 1, maxLevel, visited, messageId)
      )
    ];

    await Promise.all(loadPromises);
  } catch (error) {
    // Send error for this specific dependency
    self.postMessage({
      type: 'DEPENDENCY_ERROR',
      payload: {
        name: packageName,
        version: version,
        error: error instanceof Error ? error.message : 'Unknown error'
      },
      id: messageId
    });
  }
};

self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
  const { type, payload, id } = event.data;

  try {
    if (type === 'LOAD_DEPENDENCIES') {
      const { packageName, version, maxLevel = 5 } = payload;
      const visited = new Set<string>();
      
      await loadDependenciesRecursively(packageName, version, 1, maxLevel, visited, id);
      
      // Send completion message
      self.postMessage({
        type: 'DEPENDENCIES_COMPLETE',
        payload: { packageName, version },
        id
      });
    } else if (type === 'LOAD_SINGLE_DEPENDENCY') {
      const { packageName, version } = payload;
      
      try {
        const packageData = await fetchPackageJson(packageName, version);
        
        self.postMessage({
          type: 'DEPENDENCY_LOADED',
          payload: {
            name: packageName,
            version: packageData.version,
            description: packageData.description,
            dependencies: packageData.dependencies || {},
            devDependencies: packageData.devDependencies || {},
            loaded: true,
            loading: false,
            homepage: packageData.homepage,
            repository: packageData.repository,
            hasNoDependencies: !packageData.dependencies || Object.keys(packageData.dependencies).length === 0
          },
          id
        });
      } catch (error) {
        self.postMessage({
          type: 'DEPENDENCY_ERROR',
          payload: {
            name: packageName,
            version: version,
            error: error instanceof Error ? error.message : 'Unknown error'
          },
          id
        });
      }
    }
  } catch (error) {
    self.postMessage({
      type: 'DEPENDENCY_ERROR',
      payload: {
        error: error instanceof Error ? error.message : 'Unknown error'
      },
      id
    });
  }
};