import { useState, useCallback } from 'react';
import { DependencyNode, PackageJson } from '../types';
import { fetchPackageJson } from '../services/npmService';

export const useDependencyAnalyzer = () => {
  const [dependencies, setDependencies] = useState<Map<string, DependencyNode>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState({ current: 0, total: 0, currentPackage: '', level: 0 });

  const updateProgress = useCallback((current: number, total: number, currentPackage: string, level: number) => {
    setProgress({ current, total, currentPackage, level });
  }, []);

  const preloadDependencies = useCallback(async (
    packageName: string, 
    version: string, 
    currentLevel: number, 
    maxLevel: number = 5,
    visited: Set<string> = new Set()
  ) => {
    if (currentLevel >= maxLevel) return;
    
    const packageKey = `${packageName}@${version}`;
    if (visited.has(packageKey)) return;
    visited.add(packageKey);

    try {
      updateProgress(visited.size, visited.size + 1, packageName, currentLevel);
      
      const packageData = await fetchPackageJson(packageName, version);
      
      const node: DependencyNode = {
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
      };

      setDependencies(prev => new Map(prev).set(packageName, node));

      // Preload next level dependencies
      const deps = packageData.dependencies || {};
      const depEntries = Object.entries(deps);
      
      if (depEntries.length > 0) {
        await Promise.all(
          depEntries.map(([depName, depVersion]) =>
            preloadDependencies(depName, depVersion, currentLevel + 1, maxLevel, visited)
          )
        );
      }
    } catch (error) {
      console.warn(`Failed to preload ${packageName}@${version}:`, error);
      
      const errorNode: DependencyNode = {
        name: packageName,
        version: version,
        description: `Failed to load: ${error instanceof Error ? error.message : 'Unknown error'}`,
        dependencies: {},
        devDependencies: {},
        loaded: false,
        loading: false,
        hasNoDependencies: true
      };
      
      setDependencies(prev => new Map(prev).set(packageName, errorNode));
    }
  }, [updateProgress]);

  const analyzeDependencies = useCallback(async (packageJson: PackageJson) => {
    setLoading(true);
    setError(null);
    setDependencies(new Map());
    
    try {
      // Add root package directly without fetching from npm
      const rootNode: DependencyNode = {
        name: packageJson.name,
        version: packageJson.version,
        description: packageJson.description,
        dependencies: packageJson.dependencies || {},
        devDependencies: packageJson.devDependencies || {},
        loaded: true,
        loading: false,
        homepage: packageJson.homepage,
        repository: packageJson.repository,
        hasNoDependencies: !packageJson.dependencies || Object.keys(packageJson.dependencies).length === 0
      };

      setDependencies(new Map([[packageJson.name, rootNode]]));

      // Preload external dependencies starting from level 1
      const deps = packageJson.dependencies || {};
      const depEntries = Object.entries(deps);
      
      if (depEntries.length > 0) {
        updateProgress(0, depEntries.length, 'Starting preload...', 1);
        
        await Promise.all(
          depEntries.map(([depName, depVersion]) =>
            preloadDependencies(depName, depVersion, 1, 5)
          )
        );
      }
      
      updateProgress(0, 0, '', 0);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to analyze dependencies');
    } finally {
      setLoading(false);
    }
  }, [preloadDependencies, updateProgress]);

  const loadDependencies = useCallback(async (packageName: string) => {
    const currentNode = dependencies.get(packageName);
    if (!currentNode || currentNode.loaded || currentNode.loading) return;

    // Mark as loading
    setDependencies(prev => {
      const newMap = new Map(prev);
      const node = newMap.get(packageName);
      if (node) {
        newMap.set(packageName, { ...node, loading: true });
      }
      return newMap;
    });

    try {
      updateProgress(1, 1, packageName, 0);
      
      const packageData = await fetchPackageJson(packageName, currentNode.version);
      
      const updatedNode: DependencyNode = {
        ...currentNode,
        dependencies: packageData.dependencies || {},
        devDependencies: packageData.devDependencies || {},
        loaded: true,
        loading: false,
        description: packageData.description || currentNode.description,
        homepage: packageData.homepage,
        repository: packageData.repository,
        hasNoDependencies: !packageData.dependencies || Object.keys(packageData.dependencies).length === 0
      };

      setDependencies(prev => new Map(prev).set(packageName, updatedNode));
      
      updateProgress(0, 0, '', 0);
    } catch (error) {
      setDependencies(prev => {
        const newMap = new Map(prev);
        const node = newMap.get(packageName);
        if (node) {
          newMap.set(packageName, { 
            ...node, 
            loading: false, 
            loaded: false,
            description: `Failed to load: ${error instanceof Error ? error.message : 'Unknown error'}`,
            hasNoDependencies: true
          });
        }
        return newMap;
      });
      
      updateProgress(0, 0, '', 0);
    }
  }, [dependencies, updateProgress]);

  return {
    dependencies,
    loading,
    error,
    progress,
    analyzeDependencies,
    loadDependencies
  };
};