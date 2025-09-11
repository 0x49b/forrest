import React, {useCallback, useState} from 'react';
import {BreadcrumbItem, DependencyNode, PackageJson} from '../types';
import {fetchPackageJson} from '../services/npmService';

export const useDependencyAnalyzer = () => {
    const [packageData, setPackageData] = useState<PackageJson | null>(null);
    const [dependencies, setDependencies] = useState<Map<string, DependencyNode>>(new Map());
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [progress, setProgress] = useState({current: 0, total: 0, currentPackage: '', level: 0});
    const [breadcrumbs, setBreadcrumbs] = useState<BreadcrumbItem[]>([]);
    const [showDevDependencies, setShowDevDependencies] = useState(false);

    // Async loading management
    const [activeRequests, setActiveRequests] = useState(0);
    const [pendingDependencies, setPendingDependencies] = useState<Array<{
        name: string,
        version: string,
        level: number
    }>>([]);
    const [completedDependencies, setCompletedDependencies] = useState<Set<string>>(new Set());
    const [totalDependenciesToLoad, setTotalDependenciesToLoad] = useState(0);
    const [allDiscoveredDependencies, setAllDiscoveredDependencies] = useState<Set<string>>(new Set());

    const MAX_CONCURRENT_REQUESTS = 15;
    const MAX_DEPENDENCY_LEVELS = 3; // Hard limit to prevent infinite recursion

    const loadSingleDependency = useCallback(async (packageName: string, version: string, level: number) => {
        const requestId = `${packageName}@${version}`;

        if (completedDependencies.has(requestId)) {
            return;
        }

        setActiveRequests(prev => prev + 1);

        try {
            const packageData = await fetchPackageJson(packageName, version);

            const dependencyNode: DependencyNode = {
                name: packageName,
                version: packageData.version,
                description: packageData.description,
                dependencies: packageData.dependencies || {},
                devDependencies: packageData.devDependencies || {},
                loaded: true,
                loading: false,
                childrenLoaded: false,
                homepage: packageData.homepage,
                repository: packageData.repository,
                hasNoDependencies: !packageData.dependencies || Object.keys(packageData.dependencies).length === 0
            };

            setDependencies(prev => new Map(prev).set(packageName, dependencyNode));

            // Track all discovered dependencies
            const allChildDeps = [
                ...Object.keys(packageData.dependencies || {}),
                ...Object.keys(packageData.devDependencies || {})
            ];
            setAllDiscoveredDependencies(prev => {
                const newSet = new Set(prev);
                allChildDeps.forEach(dep => newSet.add(dep));
                return newSet;
            });

            // Queue child dependencies if within level limit
            if (level < MAX_DEPENDENCY_LEVELS - 1) {
                const childDeps = [
                    ...Object.entries(packageData.dependencies || {})
                ];

                // Add dev dependencies only if showDevDependencies is true
                if (showDevDependencies) {
                    childDeps.push(...Object.entries(packageData.devDependencies || {}));
                }

                const newDeps = childDeps
                    .map(([name, version]) => ({name, version, level: level + 1}))
                    .filter(dep => {
                        const depId = `${dep.name}@${dep.version}`;
                        return !completedDependencies.has(depId) &&
                            !pendingDependencies.some(p => p.name === dep.name) &&
                            !dependencies.has(dep.name) &&
                            dep.level < MAX_DEPENDENCY_LEVELS;
                    });

                if (newDeps.length > 0) {
                    setPendingDependencies(prev => [...prev, ...newDeps]);
                    setTotalDependenciesToLoad(prev => prev + newDeps.length);
                }
            }

            // Mark as completed
            setCompletedDependencies(prev => new Set(prev).add(requestId));

        } catch (error) {
            console.warn(`Failed to load ${packageName}@${version}:`, error instanceof Error ? error.message : 'Unknown error');

            const errorNode: DependencyNode = {
                name: packageName,
                version: version,
                description: `Not resolved: ${error instanceof Error ? error.message : 'Package not found'}`,
                dependencies: {},
                devDependencies: {},
                loaded: true, // Mark as loaded to prevent retry attempts
                loading: false,
                childrenLoaded: false,
                hasNoDependencies: true
            };

            setDependencies(prev => new Map(prev).set(packageName, errorNode));
            setCompletedDependencies(prev => new Set(prev).add(requestId));
        } finally {
            setActiveRequests(prev => prev - 1);
        }
    }, [completedDependencies, pendingDependencies, dependencies, showDevDependencies, MAX_DEPENDENCY_LEVELS]);

    // Process pending dependencies with worker limit
    const processPendingDependencies = useCallback(() => {
        if (activeRequests >= MAX_CONCURRENT_REQUESTS || pendingDependencies.length === 0) {
            return;
        }

        const availableSlots = MAX_CONCURRENT_REQUESTS - activeRequests;
        const toProcess = pendingDependencies.slice(0, availableSlots);

        setPendingDependencies(prev => prev.slice(availableSlots));

        toProcess.forEach(({name, version, level}) => {
            const requestId = `${name}@${version}`;

            if (completedDependencies.has(requestId)) {
                return;
            }

            loadSingleDependency(name, version, level);
        });
    }, [activeRequests, pendingDependencies, completedDependencies, loadSingleDependency]);

    // Update progress based on processed dependencies
    React.useEffect(() => {
        const current = completedDependencies.size;
        // Filter total based on showDevDependencies setting
        const total = showDevDependencies ? totalDependenciesToLoad :
            Array.from(allDiscoveredDependencies).filter(depName => {
                // Only count if it's reachable through regular dependencies
                return hasRegularDependencyPathInProgress(depName);
            }).length;

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
        if (totalDependenciesToLoad > 0 && pendingDependencies.length === 0 && activeRequests === 0) {
            setLoading(false);
            setProgress({current: 0, total: 0, currentPackage: '', level: 0});
        }
    }, [completedDependencies.size, totalDependenciesToLoad, pendingDependencies.length, activeRequests, pendingDependencies, MAX_DEPENDENCY_LEVELS]);

    // Helper function for progress calculation
    const hasRegularDependencyPathInProgress = (targetName: string): boolean => {
        const visited = new Set<string>();

        const dfs = (currentName: string): boolean => {
            if (visited.has(currentName)) return false;
            visited.add(currentName);

            const node = dependencies.get(currentName);
            if (!node || !packageData) return false;

            if (node.dependencies?.[targetName]) return true;

            for (const depName of Object.keys(node.dependencies || {})) {
                if (dfs(depName)) return true;
            }
            return false;
        };

        return packageData ? dfs(packageData.name) : false;
    };
    // Process pending dependencies when slots become available
    React.useEffect(() => {
        processPendingDependencies();
    }, [processPendingDependencies]);

    const analyzeDependencies = useCallback((packageJson: PackageJson, includeDevDeps: boolean = true) => {
        setLoading(true);
        setError(null);
        setDependencies(new Map());
        setActiveRequests(0);
        setPendingDependencies([]);
        setCompletedDependencies(new Set());
        setAllDiscoveredDependencies(new Set());
        setTotalDependenciesToLoad(0);
        setPackageData(packageJson);
        setShowDevDependencies(includeDevDeps);
        setBreadcrumbs([{name: packageJson.name, version: packageJson.version}]);

        // Add root package directly without fetching from npm
        const rootNode: DependencyNode = {
            name: packageJson.name,
            version: packageJson.version,
            description: packageJson.description,
            dependencies: packageJson.dependencies || {},
            devDependencies: packageJson.devDependencies || {},
            loaded: true,
            loading: false,
            childrenLoaded: true, // Root package children are loaded initially
            homepage: packageJson.homepage,
            repository: packageJson.repository,
            hasNoDependencies: !packageJson.dependencies || Object.keys(packageJson.dependencies).length === 0
        };

        setDependencies(new Map([[packageJson.name, rootNode]]));

        // Queue initial dependencies for loading
        const deps = packageJson.dependencies || {};
        const devDeps = includeDevDeps ? (packageJson.devDependencies || {}) : {};
        const allDeps = {...deps, ...devDeps};

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
        console.log(`Hook: loadDependencies called for ${packageName}`);
        const currentNode = dependencies.get(packageName);
        console.log(`Current node:`, currentNode);

        if (!currentNode || currentNode.childrenLoaded || currentNode.loading) {
            console.log(`Skipping load for ${packageName}: childrenLoaded=${currentNode?.childrenLoaded}, loading=${currentNode?.loading}`);
            return;
        }

        // Set loading state and show progress
        setLoading(true);
        setProgress({
            current: 0,
            total: 1,
            currentPackage: packageName,
            level: 1
        });

        // Mark as loading
        setDependencies(prev => {
            const newMap = new Map(prev);
            const node = newMap.get(packageName);
            if (node) {
                newMap.set(packageName, {...node, loading: true});
            }
            return newMap;
        });

        // Load package data and its dependencies
        const loadPackageAndDependencies = async () => {
            try {
                console.log(`Loading dependencies for ${packageName}@${currentNode.version}`);
                
                let packageData;
                if (currentNode.loaded) {
                    // If the node is already loaded, we just need to load its children
                    packageData = {
                        name: currentNode.name,
                        version: currentNode.version,
                        description: currentNode.description,
                        dependencies: currentNode.dependencies || {},
                        devDependencies: currentNode.devDependencies || {},
                        homepage: currentNode.homepage,
                        repository: currentNode.repository,
                        license: currentNode.license
                    };
                } else {
                    // Load the package data from npm
                    packageData = await fetchPackageJson(packageName, currentNode.version);
                }

                const dependencyNode: DependencyNode = {
                    name: packageName,
                    version: packageData.version,
                    description: packageData.description,
                    dependencies: packageData.dependencies || {},
                    devDependencies: packageData.devDependencies || {},
                    loaded: true,
                    loading: false,
                    childrenLoaded: true,
                    homepage: packageData.homepage,
                    repository: packageData.repository,
                    hasNoDependencies: (!packageData.dependencies || Object.keys(packageData.dependencies).length === 0) &&
                        (!showDevDependencies || !packageData.devDependencies || Object.keys(packageData.devDependencies).length === 0)
                };

                // Update the main node
                setDependencies(prev => new Map(prev).set(packageName, dependencyNode));

                // Add child dependencies as unloaded nodes
                const childDeps = Object.entries(packageData.dependencies || {});
                const childDevDeps = showDevDependencies ? Object.entries(packageData.devDependencies || {}) : [];
                const allChildDeps = [...childDeps, ...childDevDeps];

                // Update progress
                setProgress({
                    current: 1,
                    total: 1,
                    currentPackage: packageName,
                    level: 1
                });
                if (allChildDeps.length > 0) {
                    setDependencies(prev => {
                        const newMap = new Map(prev);

                        allChildDeps.forEach(([depName, depVersion]) => {
                            if (!newMap.has(depName)) {
                                const childNode: DependencyNode = {
                                    name: depName,
                                    version: depVersion,
                                    description: undefined,
                                    dependencies: {},
                                    devDependencies: {},
                                    loaded: false,
                                    loading: false,
                                    childrenLoaded: false,
                                    hasNoDependencies: false
                                };
                                newMap.set(depName, childNode);
                            }
                        });

                        return newMap;
                    });
                }

                console.log(`Successfully loaded ${packageName} with ${allChildDeps.length} child dependencies`);

            } catch (error) {
                console.warn(`Failed to load ${packageName}@${currentNode.version}:`, error instanceof Error ? error.message : 'Unknown error');

                const errorNode: DependencyNode = {
                    name: packageName,
                    version: currentNode.version,
                    description: `Failed to load: ${error instanceof Error ? error.message : 'Package not found'}`,
                    dependencies: {},
                    devDependencies: {},
                    loaded: true,
                    loading: false,
                    childrenLoaded: true,
                    childrenLoaded: false,
                    childrenLoaded: false,
                    hasNoDependencies: true
                };

                setDependencies(prev => new Map(prev).set(packageName, errorNode));
            } finally {
                // Hide loading state
                setLoading(false);
                setProgress({current: 0, total: 0, currentPackage: '', level: 0});
            }
        };

        loadPackageAndDependencies();
    }, [dependencies, showDevDependencies]);

    const addToBreadcrumbs = useCallback((packageName: string, version: string) => {
        setBreadcrumbs(prev => {
            const existingIndex = prev.findIndex(item => item.name === packageName);
            if (existingIndex >= 0) {
                return prev.slice(0, existingIndex + 1);
            }
            return [...prev, {name: packageName, version}];
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
                const newDevDepsToLoad: Array<{
                    name: string,
                    version: string,
                    level: number
                }> = [];

                dependencies.forEach((node) => {
                    if (node.loaded && node.devDependencies) {
                        Object.entries(node.devDependencies).forEach(([depName, depVersion]) => {
                            const workerId = `${depName}@${depVersion}`;

                            // Only load if we haven't seen this dependency at all
                            if (!dependencies.has(depName) &&
                                !completedDependencies.has(workerId) &&
                                !pendingDependencies.some(p => p.name === depName)) {
                                newDevDepsToLoad.push({
                                    name: depName,
                                    version: depVersion,
                                    level: 1
                                });
                            }
                        });
                    }
                });

                if (newDevDepsToLoad.length > 0) {
                    setLoading(true);
                    setPendingDependencies(prev => [...prev, ...newDevDepsToLoad]);
                    setTotalDependenciesToLoad(prev => prev + newDevDepsToLoad.length);
                }
            }

            return newValue;
        });
    }, [dependencies, completedDependencies, pendingDependencies, showDevDependencies]);

    const reset = useCallback(() => {
        setActiveRequests(0);
        setPendingDependencies([]);
        setCompletedDependencies(new Set());
        setAllDiscoveredDependencies(new Set());
        setTotalDependenciesToLoad(0);
        setPackageData(null);
        setDependencies(new Map());
        setBreadcrumbs([]);
        setError(null);
        setProgress({current: 0, total: 0, currentPackage: '', level: 0});
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
        loadPackageDependencies: loadDependencies,
        navigateToBreadcrumb,
        addToBreadcrumbs,
        toggleDevDependencies,
        reset
    };
};