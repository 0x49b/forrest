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
}

const initialState: DependencyState = {
  nodes: {},
  rootPackage: null,
  packageData: null,
  loading: false,
  error: null,
  progress: { current: 0, total: 0, level: 0, currentPackage: '' },
  showDevDependencies: false,
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
  },
  
  extraReducers: (builder) => {
    builder
      .addCase(loadDependency.pending, (state, action) => {
        const { packageName } = action.meta.arg;
        state.loading = true;
        state.error = null;
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
        
        // Update the main node
        state.nodes[mainNode.name] = mainNode;
        
        // Add child nodes
        Object.entries(childNodes).forEach(([name, node]) => {
          if (!state.nodes[name]) {
            state.nodes[name] = node;
          }
        });
        
        state.loading = false;
        state.progress = { current: 0, total: 0, level: 0, currentPackage: '' };
      })
      .addCase(loadDependency.rejected, (state, action) => {
        const payload = action.payload as any;
        
        if (payload?.errorNode && payload?.packageName) {
          state.nodes[payload.packageName] = payload.errorNode;
          state.error = payload.error;
        }
        
        state.loading = false;
        state.progress = { current: 0, total: 0, level: 0, currentPackage: '' };
      });
  },
});

export const {
  setPackageData,
  setNodeLoading,
  setLoading,
  setProgress,
  setError,
  toggleDevDependencies,
  setShowDevDependencies,
  reset,
} = dependencySlice.actions;

export default dependencySlice.reducer;