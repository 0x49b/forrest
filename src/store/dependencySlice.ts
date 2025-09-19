import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import { DependencyNode, PackageJson, LoadingProgress } from '../types';
import { workerPool } from '../services/workerPool';

interface DependencyState {
  nodes: Record<string, DependencyNode>;
  rootPackage: string | null;
  packageData: PackageJson | null;
  loading: boolean;
  error: string | null;
  progress: LoadingProgress;
  showDevDependencies: boolean;
  activeWorkers: number;
}

const initialState: DependencyState = {
  nodes: {},
  rootPackage: null,
  packageData: null,
  loading: false,
  error: null,
  progress: { current: 0, total: 0, level: 0, currentPackage: '' },
  showDevDependencies: false,
  activeWorkers: 0,
};

// Async thunk for loading a single dependency
export const loadDependency = createAsyncThunk(
  'dependencies/loadDependency',
  async (
    { packageName, version, showDevDeps }: { packageName: string; version: string; showDevDeps: boolean },
    { rejectWithValue }
  ) => {
    try {
      const result = await workerPool.fetchDependency(packageName, version, showDevDeps);
      return result;
    } catch (error) {
      console.warn(`Failed to load ${packageName}@${version}:`, error instanceof Error ? error.message : 'Unknown error');
      
      const errorNode: DependencyNode = {
        name: packageName,
        version: version,
        description: `Failed to load: ${error instanceof Error ? error.message : 'Package not found'}`,
        dependencies: {},
        devDependencies: {},
        loaded: true,
        loading: false,
        childrenLoaded: true,
        hasNoDependencies: true
      };

      return rejectWithValue({
        errorNode,
        packageName,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
);

// Async thunk for loading initial levels
export const loadInitialLevels = createAsyncThunk(
  'dependencies/loadInitialLevels',
  async (
    { packageData, showDevDeps, maxLevel = 2 }: { packageData: PackageJson; showDevDeps: boolean; maxLevel?: number },
    { dispatch, getState, rejectWithValue }
  ) => {
    try {
      const state = getState() as { dependencies: DependencyState };
      
      // Get all level 1 dependencies
      const level1Deps = Object.keys({
        ...(packageData.dependencies || {}),
        ...(showDevDeps ? (packageData.devDependencies || {}) : {})
      });
      
      if (level1Deps.length === 0) {
        return { completedLevels: 0, totalProcessed: 0 };
      }
      
      let totalProcessed = 0;
      const allDepsToLoad = new Set<string>();
      
      // Load level 1 dependencies
      dispatch(setProgress({
        current: 0,
        total: level1Deps.length,
        level: 1,
        currentPackage: 'Loading level 1 dependencies...'
      }));
      
      const level1Results = await Promise.allSettled(
        level1Deps.map(async (depName, index) => {
          const version = (packageData.dependencies?.[depName] || packageData.devDependencies?.[depName]) || 'latest';
          
          dispatch(setProgress({
            current: index + 1,
            total: level1Deps.length,
            level: 1,
            currentPackage: depName
          }));
          
          try {
            const result = await workerPool.fetchDependency(depName, version, showDevDeps);
            totalProcessed++;
            return { success: true, result, depName };
          } catch (error) {
            console.warn(`Failed to load level 1 dependency ${depName}:`, error);
            return { success: false, error, depName };
          }
        })
      );
      
     // Process level 1 results and add them to the store
     level1Results.forEach((result) => {
       if (result.status === 'fulfilled' && result.value.success) {
         const { result: depResult } = result.value;
         // The results will be processed by the fulfilled case of loadDependency
       }
     });
     
      // Process level 1 results and collect level 2 dependencies
      const level2Deps = new Set<string>();
      
      level1Results.forEach((result) => {
        if (result.status === 'fulfilled' && result.value.success) {
          const { result: depResult } = result.value;
          
          // Add level 2 dependencies to the set
          Object.keys(depResult.mainNode.dependencies || {}).forEach(dep => {
            if (!level1Deps.includes(dep) && dep !== packageData.name) {
              level2Deps.add(dep);
            }
          });
          
          if (showDevDeps) {
            Object.keys(depResult.mainNode.devDependencies || {}).forEach(dep => {
              if (!level1Deps.includes(dep) && dep !== packageData.name) {
                level2Deps.add(dep);
              }
            });
          }
        }
      });
      
      // Load level 2 dependencies if maxLevel >= 2
      if (maxLevel >= 2 && level2Deps.size > 0) {
        const level2Array = Array.from(level2Deps);
        
        dispatch(setProgress({
          current: 0,
          total: level2Array.length,
          level: 2,
          currentPackage: 'Loading level 2 dependencies...'
        }));
        
        const level2Results = await Promise.allSettled(
          level2Array.map(async (depName, index) => {
            // Find the version from level 1 results
            let version = 'latest';
            for (const l1Result of level1Results) {
              if (l1Result.status === 'fulfilled' && l1Result.value.success) {
                const deps = l1Result.value.result.mainNode.dependencies || {};
                const devDeps = l1Result.value.result.mainNode.devDependencies || {};
                if (deps[depName]) {
                  version = deps[depName];
                  break;
                } else if (devDeps[depName]) {
                  version = devDeps[depName];
                  break;
                }
              }
            }
            
            dispatch(incrementActiveWorkers());
            
            dispatch(incrementActiveWorkers());
            
            dispatch(setProgress({
              current: index + 1,
              total: level2Array.length,
              level: 2,
              currentPackage: depName
            }));
            
            try {
              const result = await workerPool.fetchDependency(depName, version, showDevDeps);
              dispatch(decrementActiveWorkers());
              dispatch(decrementActiveWorkers());
              totalProcessed++;
              return { success: true, result, depName };
            } catch (error) {
              dispatch(decrementActiveWorkers());
              dispatch(decrementActiveWorkers());
              console.warn(`Failed to load level 2 dependency ${depName}:`, error);
              return { success: false, error, depName };
            }
          })
        );
       
        state.activeWorkers = Math.max(0, state.activeWorkers - 1);
        
       // Process level 2 results and add them to the store
       level2Results.forEach((result) => {
         if (result.status === 'fulfilled' && result.value.success) {
           const { result: depResult } = result.value;
           // The results will be processed by the fulfilled case of loadDependency
         }
       });
      }
      
      return { completedLevels: maxLevel, totalProcessed };
    } catch (error) {
      return rejectWithValue(error instanceof Error ? error.message : 'Unknown error');
    } finally {
      // Clear progress message after a delay
      setTimeout(() => {
        dispatch(clearProgressMessage());
      }, 3000);
    }
  }
);
const dependencySlice = createSlice({
  name: 'dependencies',
  initialState,
  reducers: {
    setPackageData: (state, action: PayloadAction<PackageJson>) => {
      state.packageData = action.payload;
      state.rootPackage = action.payload.name;
      
      // Add root package as a loaded node
      const rootNode: DependencyNode = {
        name: action.payload.name,
        version: action.payload.version,
        description: action.payload.description,
        dependencies: action.payload.dependencies || {},
        devDependencies: action.payload.devDependencies || {},
        loaded: true,
        loading: false,
        childrenLoaded: true,
        homepage: action.payload.homepage,
        repository: action.payload.repository,
        license: action.payload.license,
        hasNoDependencies: (!action.payload.dependencies || Object.keys(action.payload.dependencies).length === 0) &&
          (!state.showDevDependencies || !action.payload.devDependencies || Object.keys(action.payload.devDependencies).length === 0)
      };
      
      state.nodes = { [action.payload.name]: rootNode };
      
      // Add initial child dependencies as unloaded nodes
      const deps = action.payload.dependencies || {};
      const devDeps = state.showDevDependencies ? (action.payload.devDependencies || {}) : {};
      const allDeps = { ...deps, ...devDeps };
      
      Object.entries(allDeps).forEach(([name, version]) => {
        if (!state.nodes[name]) {
          state.nodes[name] = {
            name,
            version,
            description: undefined,
            dependencies: {},
            devDependencies: {},
            loaded: false,
            loading: false,
            childrenLoaded: false,
            hasNoDependencies: false
          };
        }
      });
      
      // Update root node's hasNoDependencies flag
      state.nodes[action.payload.name].hasNoDependencies = Object.keys(allDeps).length === 0;
    },
    
    setNodeLoading: (state, action: PayloadAction<{ packageName: string; loading: boolean }>) => {
      const { packageName, loading } = action.payload;
      if (state.nodes[packageName]) {
        state.nodes[packageName].loading = loading;
      }
    },
    
    setLoading: (state, action: PayloadAction<boolean>) => {
      state.loading = action.payload;
    },
    
    setProgress: (state, action: PayloadAction<LoadingProgress>) => {
      state.progress = action.payload;
    },
    
    setActiveWorkers: (state, action: PayloadAction<number>) => {
      state.activeWorkers = action.payload;
    },
    
    incrementActiveWorkers: (state) => {
      state.activeWorkers += 1;
    },
    
    decrementActiveWorkers: (state) => {
      state.activeWorkers = Math.max(0, state.activeWorkers - 1);
    },
    
    setError: (state, action: PayloadAction<string | null>) => {
      state.error = action.payload;
    },
    
    toggleDevDependencies: (state) => {
      state.showDevDependencies = !state.showDevDependencies;
      
      // Reset childrenLoaded for all nodes so they can be reloaded with new dev dependency setting
      Object.values(state.nodes).forEach(node => {
        if (node.loaded) {
          node.childrenLoaded = false;
          
          // Recalculate hasNoDependencies based on new showDevDependencies setting
          const regularDeps = Object.keys(node.dependencies || {}).length;
          const devDeps = state.showDevDependencies ? Object.keys(node.devDependencies || {}).length : 0;
          node.hasNoDependencies = (regularDeps + devDeps) === 0;
        }
      });
      
      // Remove nodes that are no longer relevant
      if (!state.showDevDependencies) {
        const nodesToKeep: Record<string, DependencyNode> = {};
        const rootNode = state.packageData?.name;
        
        // Keep root node
        if (rootNode && state.nodes[rootNode]) {
          nodesToKeep[rootNode] = state.nodes[rootNode];
        }
        
        // Keep nodes that are regular dependencies
        Object.values(state.nodes).forEach(node => {
          if (node.loaded && node.dependencies) {
            Object.keys(node.dependencies).forEach(depName => {
              if (state.nodes[depName]) {
                nodesToKeep[depName] = state.nodes[depName];
              }
            });
          }
        });
        
        state.nodes = nodesToKeep;
      }
    },
    
    setShowDevDependencies: (state, action: PayloadAction<boolean>) => {
      state.showDevDependencies = action.payload;
    },
    
    reset: () => initialState,
    
    clearProgressMessage: (state) => {
      if (state.activeWorkers === 0) {
        state.progress = { current: 0, total: 0, level: 0, currentPackage: '' };
      }
    },
  },
  
  extraReducers: (builder) => {
    builder
      .addCase(loadDependency.pending, (state, action) => {
        const { packageName } = action.meta.arg;
        state.loading = true;
        state.error = null;
        state.activeWorkers += 1;
        state.progress = {
          current: 0,
          total: 1,
          level: 1,
          currentPackage: packageName
        };
        
        if (state.nodes[packageName]) {
          state.nodes[packageName].loading = true;
        }
      })
      .addCase(loadDependency.fulfilled, (state, action) => {
        const { mainNode, childNodes } = action.payload;
        
        state.activeWorkers = Math.max(0, state.activeWorkers - 1);
        
        // Update the main node
        state.nodes[mainNode.name] = mainNode;
        
        // Add child nodes
        Object.entries(childNodes).forEach(([name, node]) => {
          if (!state.nodes[name]) {
            state.nodes[name] = node;
          }
        });
        
        // Only stop loading when no active workers remain
        if (state.activeWorkers === 0) {
          state.loading = false;
          state.progress = { current: 0, total: 0, level: 0, currentPackage: '' };
        }
      })
      .addCase(loadInitialLevels.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(loadInitialLevels.fulfilled, (state, action) => {
        const { completedLevels, totalProcessed } = action.payload;
        state.loading = false;
        state.progress = { 
          current: totalProcessed, 
          total: totalProcessed, 
          level: completedLevels, 
          currentPackage: `Completed loading ${completedLevels} levels (${totalProcessed} packages)` 
        };
        
       // Clear progress after showing completion
       setTimeout(() => {
         if (state.progress.currentPackage?.includes('Completed loading')) {
           state.progress = { current: 0, total: 0, level: 0, currentPackage: '' };
         }
       }, 3000);
      })
      .addCase(loadInitialLevels.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload as string || 'Failed to load initial levels';
        state.progress = { current: 0, total: 0, level: 0, currentPackage: '' };
      })
      .addCase(loadDependency.rejected, (state, action) => {
        const payload = action.payload as any;
        
        if (payload?.errorNode && payload?.packageName) {
          state.nodes[payload.packageName] = payload.errorNode;
          state.error = payload.error;
        }
        
        // Only stop loading when no active workers remain
        if (state.activeWorkers === 0) {
          state.loading = false;
          state.progress = { current: 0, total: 0, level: 0, currentPackage: '' };
        }
     })
     // Handle individual dependency loads from loadInitialLevels
     .addMatcher(
       (action) => action.type === 'dependencies/loadDependency/fulfilled' && action.meta?.arg?.fromInitialLoad,
       (state, action) => {
         // This will be handled by the existing loadDependency.fulfilled case
       }
     );
     
     // Add a custom matcher to handle batch updates from loadInitialLevels
     builder.addMatcher(
       (action) => action.type.startsWith('dependencies/loadInitialLevels'),
       (state, action) => {
         // Handle batch dependency loading results
         if (action.type === 'dependencies/loadInitialLevels/pending') {
           // Already handled above
         } else if (action.type === 'dependencies/loadInitialLevels/fulfilled') {
           // Process any batch results here if needed
         }
      });
  },
});

export const {
  setPackageData,
  setNodeLoading,
  setLoading,
  setProgress,
  setActiveWorkers,
  incrementActiveWorkers,
  decrementActiveWorkers,
  setError,
  toggleDevDependencies,
  setShowDevDependencies,
  reset,
  clearProgressMessage,
} = dependencySlice.actions;

export default dependencySlice.reducer;