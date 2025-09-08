import { useState, useCallback } from 'react';
import { DependencyNode, PackageJson, BreadcrumbItem, LoadingProgress } from '../types';
import { fetchPackageJson } from '../services/npmService';

export const useDependencyAnalyzer = () => {
  const [packageData, setPackageData] = useState<PackageJson | null>(null);
  const [dependencies, setDependencies] = useState<Map<string, DependencyNode>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<LoadingProgress>({ current: 0, total: 0, level: 0 });
  const [breadcrumbs, setBreadcrumbs] = useState<BreadcrumbItem[]>([]);
  const [showDevDependencies, setShowDevDependencies] = useState(false);

  const preloadDependencies = useCallback(async (
    packageName: string, 
    version: string, 
    level: number, 
    maxLevel: number,
    processedPackages: Set<string>,
    dependencyMap: Map<string, DependencyNode>
  ): Promise<void> => {
    if (level > maxLevel || processedPackages.has(`${packageName}@${version}`)) {
      return;
    }

    processedPackages.add(`${packageName}@${version}`);
    
    try {
      setProgress(prev => ({ 
        ...prev, 
        currentPackage: packageName,
        level 
      }));

      const packageJson = await fetchPackageJson(packageName, version);
      
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
        hasNoDependencies: (!packageJson.dependencies || Object.keys(packageJson.dependencies).length === 0) &&
                          (!packageJson.devDependencies || Object.keys(packageJson.devDependencies).length === 0)
      };

      dependencyMap.set(packageName, node);
      
      setProgress(prev => ({ 
        ...prev, 
        current: prev.current + 1 
      }));

      // Recursively load dependencies
      const allDeps = {
        ...packageJson.dependencies,
        ...(showDevDependencies ? packageJson.devDependencies : {})
      };

      if (allDeps && level < maxLevel) {
        const depPromises = Object.entries(allDeps).map(([depName, depVersion]) =>
          preloadDependencies(depName, depVersion, level + 1, maxLevel, processedPackages, dependencyMap)
        );
        
        await Promise.all(depPromises);
      }
    } catch (err) {
      console.error(`Failed to preload ${packageName}@${version}:`, err);
      
      const errorNode: DependencyNode = {
        name: packageName,
        version: version.replace(/[\^~]/, ''),
        loaded: true,
        loading: false,
        description: `Failed to load: ${err instanceof Error ? err.message : 'Unknown error'}`,
        hasNoDependencies: true
      };
      
      dependencyMap.set(packageName, errorNode);
      
      setProgress(prev => ({ 
        ...prev, 
        current: prev.current + 1 
      }));
    }
  }, [showDevDependencies]);

  const countTotalDependencies = useCallback((
    deps: Record<string, string> | undefined,
    level: number,
    maxLevel: number,
    counted: Set<string>
  ): number => {
    if (!deps || level > maxLevel) return 0;
    
    let count = 0;
    for (const [name, version] of Object.entries(deps)) {
      const key = `${name}@${version}`;
      if (!counted.has(key)) {
        counted.add(key);
        count += 1;
      }
    }
    return count;
  }, []);

  const analyzeDependencies = useCallback(async (rootPackage: PackageJson) => {
    setLoading(true);
    setError(null);
    setPackageData(rootPackage);
    setBreadcrumbs([{ name: rootPackage.name, version: rootPackage.version }]);

    const dependencyMap = new Map<string, DependencyNode>();
    const processedPackages = new Set<string>();
    const countedPackages = new Set<string>();

    // Count total dependencies to preload (approximate)
    const allRootDeps = {
      ...rootPackage.dependencies,
      ...(showDevDependencies ? rootPackage.devDependencies : {})
    };
    
    let totalEstimate = 1; // Root package
    if (allRootDeps) {
      totalEstimate += Object.keys(allRootDeps).length * 5; // Rough estimate
    }

    setProgress({ current: 0, total: totalEstimate, level: 0 });

    try {
      // Start preloading from root package
      await preloadDependencies(
        rootPackage.name, 
        rootPackage.version, 
        0, 
        5, // 5 levels deep
        processedPackages,
        dependencyMap
      );

      setDependencies(new Map(dependencyMap));
    } catch (err) {
      setError(`Failed to analyze dependencies: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setLoading(false);
      setProgress({ current: 0, total: 0, level: 0 });
    }
  }, [preloadDependencies, showDevDependencies]);

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
      if (showDevDependencies && node.devDependencies?.[packageName]) {
        targetVersion = node.devDependencies[packageName];
        break;
      }
    }

    setDependencies(prev => {
      const updated = new Map(prev);
      const node = updated.get(packageName);
      if (node) {
        updated.set(packageName, { ...node, loading: true });
      } else {
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
      
      setDependencies(prev => {
        const updated = new Map(prev);
        
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
          hasNoDependencies: (!packageJson.dependencies || Object.keys(packageJson.dependencies).length === 0) &&
                            (!packageJson.devDependencies || Object.keys(packageJson.devDependencies).length === 0)
        };
        
        updated.set(packageName, node);
        
        // Add placeholder nodes for dependencies
        const allDeps = {
          ...packageJson.dependencies,
          ...(showDevDependencies ? packageJson.devDependencies : {})
        };
        
        if (allDeps) {
          Object.entries(allDeps).forEach(([depName, version]) => {
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
  }, [dependencies, showDevDependencies]);

  const navigateToBreadcrumb = useCallback((index: number) => {
    setBreadcrumbs(prev => prev.slice(0, index + 1));
  }, []);

  const addToBreadcrumbs = useCallback((name: string, version: string) => {
    setBreadcrumbs(prev => {
      const existingIndex = prev.findIndex(item => item.name === name);
      if (existingIndex !== -1) {
        return prev.slice(0, existingIndex + 1);
      }
      return [...prev, { name, version }];
    });
  }, []);

  const toggleDevDependencies = useCallback(() => {
    setShowDevDependencies(prev => !prev);
  }, []);

  const reset = useCallback(() => {
    setPackageData(null);
    setDependencies(new Map());
    setLoading(false);
    setError(null);
    setProgress({ current: 0, total: 0, level: 0 });
    setBreadcrumbs([]);
    setShowDevDependencies(false);
  }, []);

  return {
    packageData,
    dependencies,
    loading,
    error,
    progress,
    breadcrumbs,
    showDevDependencies,
    analyzeDependencies,
    loadPackageDependencies,
    navigateToBreadcrumb,
    addToBreadcrumbs,
    toggleDevDependencies,
    reset
  };
};