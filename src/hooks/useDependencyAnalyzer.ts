import { useCallback } from 'react';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import {
  analyzeWithBackend,
  closeActiveStream,
  reset,
  setPackageData,
  setShowDevDependencies,
  toggleDevDependencies,
} from '../store/dependencySlice';
import { PackageJson } from '../types';

export const useDependencyAnalyzer = () => {
  const dispatch = useAppDispatch();
  const packageData = useAppSelector((state) => state.dependencies.packageData);
  const loading = useAppSelector((state) => state.dependencies.loading);
  const error = useAppSelector((state) => state.dependencies.error);
  const showDevDependencies = useAppSelector((state) => state.dependencies.showDevDependencies);

  const analyzeDependencies = useCallback(
    (packageJson: PackageJson, includeDevDeps: boolean = true, maxDepth: number = 2) => {
      dispatch(setShowDevDependencies(includeDevDeps));
      dispatch(setPackageData(packageJson));
      if (maxDepth > 0) {
        dispatch(analyzeWithBackend({ packageData: packageJson, showDevDeps: includeDevDeps, maxDepth }));
      }
    },
    [dispatch]
  );

  const handleToggleDevDependencies = useCallback(() => {
    dispatch(toggleDevDependencies());
  }, [dispatch]);

  const handleReset = useCallback(() => {
    closeActiveStream();
    dispatch(reset());
  }, [dispatch]);

  return {
    packageData,
    loading,
    error,
    showDevDependencies,
    analyzeDependencies,
    toggleDevDependencies: handleToggleDevDependencies,
    reset: handleReset,
  };
};
