import { useCallback } from 'react';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import {
  setPackageData,
  setShowDevDependencies,
  toggleDevDependencies,
  loadDependency,
  loadInitialLevels,
  reset,
} from '../store/dependencySlice';
import { PackageJson } from '../types';

export const useDependencyAnalyzer = () => {
  const dispatch = useAppDispatch();
  const {
    nodes: dependencies,
    rootPackage,
    packageData,
    loading,
    error,
    progress,
    showDevDependencies,
  } = useAppSelector((state) => state.dependencies);

  const analyzeDependencies = useCallback((packageJson: PackageJson, includeDevDeps: boolean = true, loadInitialLevelsCount: number = 2) => {
    dispatch(setShowDevDependencies(includeDevDeps));
    dispatch(setPackageData(packageJson));
    
    // Load initial levels if requested
    if (loadInitialLevelsCount > 0) {
      dispatch(loadInitialLevels({
        packageData: packageJson,
        showDevDeps: includeDevDeps,
        maxLevel: loadInitialLevelsCount
      }));
    }
  }, [dispatch]);

  const loadPackageDependencies = useCallback((packageName: string) => {
    const node = dependencies[packageName];
    if (!node || node.childrenLoaded || node.loading) {
      return;
    }

    dispatch(loadDependency({
      packageName,
      version: node.version,
      showDevDeps: showDevDependencies
    }));
  }, [dispatch, dependencies, showDevDependencies]);

  const handleToggleDevDependencies = useCallback(() => {
    dispatch(toggleDevDependencies());
  }, [dispatch]);

  const handleReset = useCallback(() => {
    dispatch(reset());
  }, [dispatch]);

  // Convert nodes object to Map for backward compatibility
  const dependenciesMap = new Map(Object.entries(dependencies));

  return {
    packageData,
    dependencies: dependenciesMap,
    loading,
    error,
    progress,
    showDevDependencies,
    analyzeDependencies,
    loadPackageDependencies,
    toggleDevDependencies: handleToggleDevDependencies,
    reset: handleReset,
    // Breadcrumb functionality can be added later if needed
    breadcrumbs: [],
    navigateToBreadcrumb: () => {},
    addToBreadcrumbs: () => {},
  };
};