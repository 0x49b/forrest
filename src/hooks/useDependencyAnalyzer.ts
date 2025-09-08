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

  // Worker pool management
  const [workers, setWorkers] = useState<Map<string, Worker>>(new Map());
  const [activeWorkers, setActiveWorkers] = useState(0);
  const [pendingDependencies, setPendingDependencies] = useState<Array<{name: string, version: string, level: number}>>([]);
  const [processedDependencies, setProcessedDependencies] = useState<Set<string>>(new Set());
  const [totalDependencies, setTotalDependencies] = useState(0);
  
  const MAX_WORKERS = 30;

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
          if (level < 5) {
            const childDeps = [
              ...Object.entries(payload.dependencies || {}),
              ...Object.entries(payload.devDependencies || {})
            ];
            
            const newDeps = childDeps
              .map(([name, version]) => ({ name, version, level: level + 1 }))
              .filter(dep => !processedDependencies.has(`${dep.name}@${dep.version}`));
            
            if (newDeps.length > 0) {
              setPendingDependencies(prev => [...prev, ...newDeps]);
              setTotalDependencies(prev => prev + newDeps.length);
            }
          }
          
          // Mark as processed and clean up worker
          setProcessedDependencies(prev => new Set(prev).add(workerId));
          setActiveWorkers(prev => prev - 1);
          
          // Clean up worker
          worker.terminate();
          setWorkers(prev => {
            const newMap = new Map(prev);
            newMap.delete(workerId);
            return newMap;
          });
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
          
          // Mark as processed and clean up worker
          setProcessedDependencies(prev => new Set(prev).add(workerId));
          setActiveWorkers(prev => prev - 1);
          
          // Clean up worker
          worker.terminate();
          setWorkers(prev => {
            const newMap = new Map(prev);
            newMap.delete(workerId);
            return newMap;
          });
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
  }, [workers, processedDependencies, level]);

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
      
      if (processedDependencies.has(workerId)) {
        return;
      }
      
      setActiveWorkers(prev => prev + 1);
      
      const worker = createWorker(name, version, level);
      worker.postMessage({
        type: 'LOAD_SINGLE_DEPENDENCY',
        payload: { packageName: name, version },
        id: workerId
      });
    });
  }, [activeWorkers, pendingDependencies, processedDependencies, createWorker]);

  // Update progress based on processed dependencies
  React.useEffect(() => {
    const current = processedDependencies.size;
    const total = Math.max(totalDependencies, current);
    
    setProgress({
      current,
      total,
      currentPackage: pendingDependencies[0]?.name || '',
      level: Math.min(...Array.from(pendingDependencies).map(d => d.level)) || 0
    });
    
    // Check if loading is complete
    if (current > 0 && pendingDependencies.length === 0 && activeWorkers === 0) {
      setLoading(false);
      setProgress({ current: 0, total: 0, currentPackage: '', level: 0 });
    }
  }, [processedDependencies.size, totalDependencies, pendingDependencies.length, activeWorkers]);

  // Process pending dependencies when slots become available
  React.useEffect(() => {
    processPendingDependencies();
  }, [processPendingDependencies]);

  const updateProgress = useCallback((current: number, total: number, currentPackage: string, level: number) => {
    setProgress({ current, total, currentPackage, level });
  }, []);

  const analyzeDependencies = useCallback((packageJson: PackageJson) => {
    setLoading(true);
    setError(null);
    setDependencies(new Map());
    setWorkers(new Map());
    setActiveWorkers(0);
    setPendingDependencies([]);
    setProcessedDependencies(new Set());
    setTotalDependencies(0);
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

    // Queue initial dependencies for loading
    const deps = packageJson.dependencies || {};
    const devDeps = packageJson.devDependencies || {};
    const allDeps = { ...deps, ...devDeps };
    
    if (Object.keys(allDeps).length > 0) {
      const initialDeps = Object.entries(allDeps).map(([name, version]) => ({
        name,
        version,
        level: 1
      }));
      
      setPendingDependencies(initialDeps);
      setTotalDependencies(initialDeps.length);
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
    if (!processedDependencies.has(workerId)) {
      setPendingDependencies(prev => [...prev, {
        name: packageName,
        version: currentNode.version,
        level: 1
      }]);
      setTotalDependencies(prev => prev + 1);
    }
  }, [dependencies, processedDependencies]);

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
    // Terminate all active workers
    workers.forEach(worker => worker.terminate());
    setWorkers(new Map());
    setActiveWorkers(0);
    setPendingDependencies([]);
    setProcessedDependencies(new Set());
    setTotalDependencies(0);
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