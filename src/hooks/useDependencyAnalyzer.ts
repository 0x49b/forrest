import { useState, useCallback } from 'react';
import { DependencyNode, PackageJson, BreadcrumbItem, LoadingProgress } from '../types';
import React from 'react';

export const useDependencyAnalyzer = () => {
  const [packageData, setPackageData] = useState<PackageJson | null>(null);
  const [dependencies, setDependencies] = useState<Map<string, DependencyNode>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState({ current: 0, total: 0, currentPackage: '', level: 0 });
  const [breadcrumbs, setBreadcrumbs] = useState<BreadcrumbItem[]>([]);
  const [showDevDependencies, setShowDevDependencies] = useState(false);

  // Worker pool management
  const [workers, setWorkers] = useState<Map<string, Worker>>(new Map());
  const [activeWorkers, setActiveWorkers] = useState(0);
  const [pendingDependencies, setPendingDependencies] = useState<Array<{name: string, version: string, level: number}>>([]);
  const [completedDependencies, setCompletedDependencies] = useState<Set<string>>(new Set());
  const [totalDependenciesToLoad, setTotalDependenciesToLoad] = useState(0);
  
  const MAX_WORKERS = 30;
  const MAX_DEPENDENCY_LEVELS = 2; // Configure max depth here - change this to adjust levels

  const createWorker = useCallback((packageName: string, version: string, level: number) => {
    const workerId = `${packageName}@${version}`;
    
    if (workers.has(workerId)) {
      return workers.get(workerId)!;
    }
    
    const worker = new Worker(new URL('../workers/dependencyWorker.ts', import.meta.url), {
      type: 'module'
    });
    
    worker.onmessage = (event) => {
      const { type, payload, id } = event.data;
      
      switch (type) {
        case 'DEPENDENCY_LOADED':
          setDependencies(prev => new Map(prev).set(payload.name, payload));
          
          // Queue child dependencies if within level limit
          if (level < MAX_DEPENDENCY_LEVELS) {
            const childDeps = [
              ...Object.entries(payload.dependencies || {}),
              ...Object.entries(payload.devDependencies || {})
            ];
            
            const newDeps = childDeps
              .map(([name, version]) => ({ name, version, level: level + 1 }))
              .filter(dep => !completedDependencies.has(`${dep.name}@${dep.version}`) && !pendingDependencies.some(p => p.name === dep.name));
            
            if (newDeps.length > 0) {
              setPendingDependencies(prev => [...prev, ...newDeps]);
              setTotalDependenciesToLoad(prev => prev + newDeps.length);
            }
          }
          
          // Mark as completed and clean up worker
          setCompletedDependencies(prev => new Set(prev).add(workerId));
          
          // Clean up worker
          worker.terminate();
          setWorkers(prev => {
            const newMap = new Map(prev);
            newMap.delete(workerId);
            return newMap;
          });
          
          setActiveWorkers(prev => prev - 1);
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
          
          // Mark as completed and clean up worker
          setCompletedDependencies(prev => new Set(prev).add(workerId));
          
          // Clean up worker
          worker.terminate();
          setWorkers(prev => {
            const newMap = new Map(prev);
            newMap.delete(workerId);
            return newMap;
          });
          
          setActiveWorkers(prev => prev - 1);
          break;
      }
    };
    
    worker.onerror = (error) => {
      console.error(`Worker error for ${workerId}:`, error);
      setActiveWorkers(prev => prev - 1);
      
      // Clean up worker
      worker.terminate();
      setWorkers(prev => {
        const newMap = new Map(prev);
        newMap.delete(workerId);
        return newMap;
      });
    };
    
    setWorkers(prev => new Map(prev).set(workerId, worker));
    return worker;
  }, [workers, completedDependencies, pendingDependencies]);

  // Process pending dependencies with worker limit
  const processPendingDependencies = useCallback(() => {
    if (activeWorkers >= MAX_WORKERS || pendingDependencies.length === 0) {
      return;
    }
    
    const availableSlots = MAX_WORKERS - activeWorkers;
    const toProcess = pendingDependencies.slice(0, availableSlots);
    
    setPendingDependencies(prev => prev.slice(availableSlots));
    
    toProcess.forEach(({ name, version, level }) => {
      const workerId = `${name}@${version}`;
      
      if (completedDependencies.has(workerId)) {
        return;
      }
      
      setActiveWorkers(prev => prev + 1);
      
      const worker = createWorker(name, version, level);
      worker.postMessage({
        type: 'LOAD_SINGLE_DEPENDENCY',
        payload: { packageName: name, version, includeDevDeps: showDevDependencies },
        id: workerId
      });
    });
  }, [activeWorkers, pendingDependencies, completedDependencies, createWorker, showDevDependencies]);

  // Update progress based on processed dependencies
  React.useEffect(() => {
    const current = completedDependencies.size;
    const total = totalDependenciesToLoad;
    
    if (total > 0) {
      const currentLevel = pendingDependencies.length > 0 
        ? Math.min(...pendingDependencies.map(d => d.level)) 
        : MAX_DEPENDENCY_LEVELS;
        
      setProgress({
        current,
        total,
        currentPackage: pendingDependencies[0]?.name || '',
        level: currentLevel
      });
    }
    
    // Check if loading is complete
    if (totalDependenciesToLoad > 0 && pendingDependencies.length === 0 && activeWorkers === 0) {
      setLoading(false);
      setProgress({ current: 0, total: 0, currentPackage: '', level: 0 });
    }
  }, [completedDependencies.size, totalDependenciesToLoad, pendingDependencies.length, activeWorkers, pendingDependencies, MAX_DEPENDENCY_LEVELS]);

  // Process pending dependencies when slots become available
  React.useEffect(() => {
    processPendingDependencies();
  }, [processPendingDependencies]);

  const updateProgress = useCallback((current: number, total: number, currentPackage: string, level: number) => {
    setProgress({ current, total, currentPackage, level });
  }, []);

  const analyzeDependencies = useCallback((packageJson: PackageJson, includeDevDeps: boolean = true) => {
    setLoading(true);
    setError(null);
    setDependencies(new Map());
    setWorkers(new Map());
    setActiveWorkers(0);
    setPendingDependencies([]);
    setCompletedDependencies(new Set());
    setTotalDependenciesToLoad(0);
    setPackageData(packageJson);
    setShowDevDependencies(includeDevDeps);
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

    // Queue initial dependencies for loading
    const deps = packageJson.dependencies || {};
    const devDeps = includeDevDeps ? (packageJson.devDependencies || {}) : {};
    const allDeps = { ...deps, ...devDeps };
    
    if (Object.keys(allDeps).length > 0) {
      const initialDeps = Object.entries(allDeps).map(([name, version]) => ({
        name,
        version,
        level: 1
      }));
      
      setPendingDependencies(initialDeps);
      setTotalDependenciesToLoad(initialDeps.length);
    } else {
      setLoading(false);
    }
  }, []);

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

    // Add to pending dependencies if not already processed
    const workerId = `${packageName}@${currentNode.version}`;
    if (!completedDependencies.has(workerId)) {
      setPendingDependencies(prev => [...prev, {
        name: packageName,
        version: currentNode.version,
        level: 1
      }]);
      setTotalDependenciesToLoad(prev => prev + 1);
    }
  }, [dependencies, completedDependencies]);

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
    setShowDevDependencies(prev => {
      const newValue = !prev;
      
      // If enabling dev dependencies, load them for all existing packages
      if (newValue) {
        const packagesToUpdate: Array<{name: string, version: string, level: number}> = [];
        
        dependencies.forEach((node, name) => {
          if (node.loaded && node.devDependencies && Object.keys(node.devDependencies).length > 0) {
            // Add dev dependencies that haven't been loaded or queued yet
            Object.entries(node.devDependencies).forEach(([depName, depVersion]) => {
              // Check if this dependency is already loaded, being processed, or queued
              const isAlreadyLoaded = dependencies.has(depName);
              const isAlreadyQueued = pendingDependencies.some(p => p.name === depName);
              const workerId = `${depName}@${depVersion}`;
              const isCompleted = completedDependencies.has(workerId);
              
              if (!isAlreadyLoaded && !isAlreadyQueued && !isCompleted) {
                packagesToUpdate.push({
                  name: depName,
                  version: depVersion,
                  level: 1 // Start dev deps at level 1, they'll be limited by MAX_DEPENDENCY_LEVELS
                });
              }
            });
          }
        });
        
        if (packagesToUpdate.length > 0) {
          setLoading(true);
          setPendingDependencies(prev => [...prev, ...packagesToUpdate]);
          setTotalDependenciesToLoad(prev => prev + packagesToUpdate.length);
        }
      }
      
      return newValue;
    });
  }, [dependencies, completedDependencies, pendingDependencies]);

  const reset = useCallback(() => {
    // Terminate all active workers
    workers.forEach(worker => worker.terminate());
    setWorkers(new Map());
    setActiveWorkers(0);
    setPendingDependencies([]);
    setCompletedDependencies(new Set());
    setTotalDependenciesToLoad(0);
    setPackageData(null);
    setDependencies(new Map());
    setBreadcrumbs([]);
    setError(null);
    setProgress({ current: 0, total: 0, currentPackage: '', level: 0 });
    setShowDevDependencies(false);
  }, [workers]);

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