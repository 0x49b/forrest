import { useState, useCallback } from 'react';
import { DependencyNode, PackageJson, BreadcrumbItem } from '../types';
import { fetchPackageJson } from '../services/npmService';

interface Progress {
  current: number;
  total: number;
}

export const useDependencyAnalyzer = () => {
  const [packageData, setPackageData] = useState<PackageJson | null>(null);
  const [dependencies, setDependencies] = useState<Map<string, DependencyNode>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<Progress>({ current: 0, total: 0 });
  const [breadcrumbs, setBreadcrumbs] = useState<BreadcrumbItem[]>([]);

  const analyzeDependencies = useCallback(async (rootPackage: PackageJson) => {
    setLoading(true);
    setError(null);
    setPackageData(rootPackage);
    setProgress({ current: 1, total: 1 });
    setBreadcrumbs([{ name: rootPackage.name, version: rootPackage.version }]);

    const dependencyMap = new Map<string, DependencyNode>();

    // Initialize with root package
    const rootNode: DependencyNode = {
      name: rootPackage.name,
      version: rootPackage.version,
      description: rootPackage.description,
      dependencies: rootPackage.dependencies,
      devDependencies: rootPackage.devDependencies,
      homepage: rootPackage.homepage,
      repository: rootPackage.repository,
      license: rootPackage.license,
      loaded: true,
      hasNoDependencies: !rootPackage.dependencies || Object.keys(rootPackage.dependencies).length === 0
    };

    dependencyMap.set(rootPackage.name, rootNode);
    setDependencies(new Map(dependencyMap));
    setLoading(false);
  }, []);

  const loadPackageDependencies = useCallback(async (packageName: string) => {
    // Don't load if already loaded or loading
    const existingNode = dependencies.get(packageName);
    if (existingNode?.loaded || existingNode?.loading) {
      return;
    }

    // Find the version from the parent's dependencies
    let targetVersion: string | undefined;
    for (const [, node] of dependencies) {
      if (node.dependencies?.[packageName]) {
        targetVersion = node.dependencies[packageName];
        break;
      }
    }

    console.log(`Loading dependencies for ${packageName}@${targetVersion}`);

    setDependencies(prev => {
      const updated = new Map(prev);
      const node = updated.get(packageName);
      if (node) {
        updated.set(packageName, { ...node, loading: true });
      } else {
        // Create a new node if it doesn't exist
        updated.set(packageName, {
          name: packageName,
          version: targetVersion?.replace(/^[\^~>=<]+/, '') || 'unknown',
          loading: true,
          loaded: false
        });
      }
      return updated;
    });

    try {
      const packageJson = await fetchPackageJson(packageName, targetVersion);
      
      console.log(`Successfully loaded ${packageName}@${packageJson.version}:`, packageJson);
      
      setDependencies(prev => {
        const updated = new Map(prev);
        
        // Update the clicked package
        const node: DependencyNode = {
          name: packageJson.name,
          version: packageJson.version,
          description: packageJson.description,
          dependencies: packageJson.dependencies,
          devDependencies: packageJson.devDependencies,
          homepage: packageJson.homepage,
          repository: packageJson.repository,
          license: packageJson.license,
          loaded: true,
          loading: false,
          hasNoDependencies: !packageJson.dependencies || Object.keys(packageJson.dependencies).length === 0
        };
        
        updated.set(packageName, node);
        
        // Add placeholder nodes for dependencies
        if (packageJson.dependencies) {
          Object.entries(packageJson.dependencies).forEach(([depName, version]) => {
            if (!updated.has(depName)) {
              updated.set(depName, {
                name: depName,
                version: version.replace(/[\^~]/, ''),
                loaded: false,
                loading: false
              });
            }
          });
        }
        
        return updated;
      });
    } catch (err) {
      console.error(`Failed to fetch ${packageName}:`, err);
      setDependencies(prev => {
        const updated = new Map(prev);
        const node = updated.get(packageName);
        if (node) {
          updated.set(packageName, {
            ...node,
            loaded: true,
            loading: false,
            description: `Failed to load: ${err instanceof Error ? err.message : 'Unknown error'}`,
            hasNoDependencies: true
          });
        }
        return updated;
      });
    }
  }, [dependencies]);

  const navigateToBreadcrumb = useCallback((index: number) => {
    setBreadcrumbs(prev => prev.slice(0, index + 1));
  }, []);

  const addToBreadcrumbs = useCallback((name: string, version: string) => {
    setBreadcrumbs(prev => {
      // Check if already in breadcrumbs to avoid duplicates
      const existingIndex = prev.findIndex(item => item.name === name);
      if (existingIndex !== -1) {
        return prev.slice(0, existingIndex + 1);
      }
      return [...prev, { name, version }];
    });
  }, []);

  const reset = useCallback(() => {
    setPackageData(null);
    setDependencies(new Map());
    setLoading(false);
    setError(null);
    setProgress({ current: 0, total: 0 });
    setBreadcrumbs([]);
  }, []);

  return {
    packageData,
    dependencies,
    loading,
    error,
    progress,
    breadcrumbs,
    analyzeDependencies,
    loadPackageDependencies,
    navigateToBreadcrumb,
    addToBreadcrumbs,
    reset
  };
};