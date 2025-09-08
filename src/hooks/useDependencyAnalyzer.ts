import { useState, useCallback } from 'react';
import { DependencyNode, PackageJson, BreadcrumbItem, LoadingProgress } from '../types';

export const useDependencyAnalyzer = () => {
  const [packageData, setPackageData] = useState<PackageJson | null>(null);
  const [dependencies, setDependencies] = useState<Map<string, DependencyNode>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState({ current: 0, total: 0, currentPackage: '', level: 0 });
  const [breadcrumbs, setBreadcrumbs] = useState<BreadcrumbItem[]>([]);
  const [showDevDependencies, setShowDevDependencies] = useState(false);

  // Web Worker for dependency loading
  const [worker, setWorker] = useState<Worker | null>(null);

  const initializeWorker = useCallback(() => {
    if (worker) {
      worker.terminate();
    }
    
    const newWorker = new Worker(new URL('../workers/dependencyWorker.ts', import.meta.url), {
      type: 'module'
    });
    
    newWorker.onmessage = (event) => {
      const { type, payload, id } = event.data;
      
      switch (type) {
        case 'DEPENDENCY_LOADED':
          setDependencies(prev => new Map(prev).set(payload.name, payload));
          break;
          
        case 'DEPENDENCY_ERROR':
          console.warn(`Failed to load ${payload.name}@${payload.version}:`, payload.error);
          
          const errorNode: DependencyNode = {
            name: payload.name,
            version: payload.version,
            description: `Failed to load: ${payload.error}`,
            dependencies: {},
            devDependencies: {},
            loaded: false,
            loading: false,
            hasNoDependencies: true
          };
          
          setDependencies(prev => new Map(prev).set(payload.name, errorNode));
          break;
          
        case 'PROGRESS_UPDATE':
          setProgress(payload);
          break;
          
        case 'DEPENDENCIES_COMPLETE':
          setLoading(false);
          setProgress({ current: 0, total: 0, currentPackage: '', level: 0 });
          break;
      }
    };
    
    newWorker.onerror = (error) => {
      console.error('Worker error:', error);
      setError('Failed to load dependencies');
      setLoading(false);
    };
    
    setWorker(newWorker);
    return newWorker;
  }, [worker]);

  const updateProgress = useCallback((current: number, total: number, currentPackage: string, level: number) => {
    setProgress({ current, total, currentPackage, level });
  }, []);

  const analyzeDependencies = useCallback((packageJson: PackageJson) => {
    setLoading(true);
    setError(null);
    setDependencies(new Map());
    setPackageData(packageJson);
    setShowDevDependencies(true);
    setBreadcrumbs([{ name: packageJson.name, version: packageJson.version }]);
    
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

    // Initialize worker and start loading dependencies
    const currentWorker = initializeWorker();
    
    // Load external dependencies using worker
    const deps = packageJson.dependencies || {};
    const devDeps = packageJson.devDependencies || {};
    const allDeps = { ...deps, ...devDeps };
    
    if (Object.keys(allDeps).length > 0) {
      updateProgress(0, Object.keys(allDeps).length, 'Starting preload...', 1);
      
      // Send each dependency to worker for loading
      Object.entries(allDeps).forEach(([depName, depVersion]) => {
        currentWorker.postMessage({
          type: 'LOAD_DEPENDENCIES',
          payload: {
            packageName: depName,
            version: depVersion,
            maxLevel: 5
          },
          id: `${depName}@${depVersion}`
        });
      });
    } else {
      setLoading(false);
    }
  }, [initializeWorker, updateProgress]);

  const loadDependencies = useCallback((packageName: string) => {
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

    // Use worker to load single dependency
    if (worker) {
      worker.postMessage({
        type: 'LOAD_SINGLE_DEPENDENCY',
        payload: {
          packageName,
          version: currentNode.version
        },
        id: `single-${packageName}`
      });
    }
  }, [dependencies, worker]);

  const addToBreadcrumbs = useCallback((packageName: string, version: string) => {
    setBreadcrumbs(prev => {
      const existingIndex = prev.findIndex(item => item.name === packageName);
      if (existingIndex >= 0) {
        return prev.slice(0, existingIndex + 1);
      }
      return [...prev, { name: packageName, version }];
    });
  }, []);

  const navigateToBreadcrumb = useCallback((index: number) => {
    setBreadcrumbs(prev => prev.slice(0, index + 1));
  }, []);

  const toggleDevDependencies = useCallback(() => {
    setShowDevDependencies(prev => !prev);
  }, []);

  const reset = useCallback(() => {
    if (worker) {
      worker.terminate();
      setWorker(null);
    }
    setPackageData(null);
    setDependencies(new Map());
    setBreadcrumbs([]);
    setError(null);
    setProgress({ current: 0, total: 0, currentPackage: '', level: 0 });
    setShowDevDependencies(false);
  }, [worker]);

  return {
    packageData,
    dependencies,
    loading,
    error,
    progress,
    breadcrumbs,
    showDevDependencies,
    analyzeDependencies,
    loadPackageDependencies: loadDependencies,
    navigateToBreadcrumb,
    addToBreadcrumbs,
    toggleDevDependencies,
    reset
  };
};