import { createAsyncThunk, createSlice, PayloadAction } from '@reduxjs/toolkit';
import { DependencyNode, LoadingProgress, PackageJson } from '../types';
import { backendService, CompleteEvent, PackageErrorEvent } from '../services/backendService';
import type { AppDispatch, RootState } from './index';

interface DependencyState {
  nodes: Record<string, DependencyNode>;
  rootPackage: string | null;
  packageData: PackageJson | null;
  loading: boolean;
  error: string | null;
  failedPackages: number;
  progress: LoadingProgress;
  maxDepth: number;
  showDevDependencies: boolean;
  // Expanded tree rows keyed by path (see childPath), so expanding a
  // package in one place does not expand every other occurrence.
  expanded: Record<string, true>;
}

const emptyProgress: LoadingProgress = { current: 0, total: 0, level: 0, currentPackage: '' };

const initialState: DependencyState = {
  nodes: {},
  rootPackage: null,
  packageData: null,
  loading: false,
  error: null,
  failedPackages: 0,
  progress: emptyProgress,
  maxDepth: 0,
  showDevDependencies: false,
  expanded: {},
};

const errorNode = (name: string, version: string, message: string): DependencyNode => ({
  name,
  version,
  description: `Failed to load: ${message}`,
  dependencies: {},
  devDependencies: {},
  loaded: true,
  loading: false,
  childrenLoaded: true,
  hasNoDependencies: true,
});

/** Child dependencies of a node, honouring the dev dependency toggle. */
export const childDependencies = (node: DependencyNode, showDev: boolean): Record<string, string> =>
  showDev ? { ...node.dependencies, ...node.devDependencies } : node.dependencies ?? {};

/** Tree path of a child row. Package names cannot contain ">". */
export const childPath = (parentPath: string, name: string) => `${parentPath}>${name}`;

// Upper bound for "Expand All" so huge graphs stay responsive.
const EXPAND_ALL_LIMIT = 5000;

// The open analysis stream. Only one analysis runs at a time; starting a
// new one or resetting closes the previous stream so stale events
// cannot leak into the new state.
let activeStream: EventSource | null = null;

export const closeActiveStream = () => {
  activeStream?.close();
  activeStream = null;
};

// Loads a single package on demand, e.g. below the analyzed depth.
export const loadDependency = createAsyncThunk<
  DependencyNode,
  { packageName: string; version: string },
  { state: RootState; rejectValue: string }
>(
  'dependencies/loadDependency',
  async ({ packageName, version }, { rejectWithValue }) => {
    try {
      return await backendService.fetchPackage(packageName, version);
    } catch (error) {
      return rejectWithValue(error instanceof Error ? error.message : 'Unknown error');
    }
  },
  {
    condition: ({ packageName }, { getState }) => {
      const node = getState().dependencies.nodes[packageName];
      return !node || (!node.loading && !node.loaded);
    },
  }
);

// Loads every child of a node that is not in the store yet.
export const loadMissingChildren =
  (packageName: string) => (dispatch: AppDispatch, getState: () => RootState) => {
    const { nodes, showDevDependencies } = getState().dependencies;
    const node = nodes[packageName];
    if (!node) return;

    for (const [name, version] of Object.entries(childDependencies(node, showDevDependencies))) {
      if (!nodes[name]) {
        dispatch(loadDependency({ packageName: name, version }));
      }
    }
  };

// Starts a backend analysis and streams its results into the store.
export const analyzeWithBackend = createAsyncThunk<
  string,
  { packageData: PackageJson; showDevDeps: boolean; maxDepth: number },
  { dispatch: AppDispatch }
>('dependencies/analyzeBackend', async ({ packageData, showDevDeps, maxDepth }, { dispatch }) => {
  closeActiveStream();

  const { sessionId } = await backendService.startAnalysis(packageData, {
    includeDevDependencies: showDevDeps,
    maxDepth,
  });

  const eventSource = backendService.createEventSource(sessionId);
  activeStream = eventSource;
  const isActive = () => activeStream === eventSource;

  // The backend batches nodes and errors, so each event is one store update.
  eventSource.addEventListener('nodes', (e: MessageEvent) => {
    if (isActive()) dispatch(nodesReceived(JSON.parse(e.data)));
  });

  eventSource.addEventListener('package-errors', (e: MessageEvent) => {
    if (isActive()) dispatch(packagesFailed(JSON.parse(e.data)));
  });

  eventSource.addEventListener('progress', (e: MessageEvent) => {
    if (isActive()) dispatch(setProgress(JSON.parse(e.data)));
  });

  eventSource.addEventListener('complete', (e: MessageEvent) => {
    if (!isActive()) return;
    closeActiveStream();
    dispatch(analysisCompleted(JSON.parse(e.data)));
  });

  eventSource.onerror = () => {
    if (!isActive()) return;
    closeActiveStream();
    dispatch(analysisFailed('Connection to server lost'));
  };

  return sessionId;
});

const dependencySlice = createSlice({
  name: 'dependencies',
  initialState,
  reducers: {
    setPackageData: (state, action: PayloadAction<PackageJson>) => {
      const pkg = action.payload;
      state.packageData = pkg;
      state.rootPackage = pkg.name;
      state.error = null;
      state.failedPackages = 0;
      state.nodes = {
        [pkg.name]: {
          name: pkg.name,
          version: pkg.version,
          description: pkg.description,
          dependencies: pkg.dependencies || {},
          devDependencies: pkg.devDependencies || {},
          homepage: pkg.homepage,
          repository: pkg.repository,
          license: pkg.license,
          loaded: true,
          loading: false,
          childrenLoaded: true,
        },
      };
      state.expanded = { [pkg.name]: true };
    },

    setShowDevDependencies: (state, action: PayloadAction<boolean>) => {
      state.showDevDependencies = action.payload;
    },

    toggleDevDependencies: (state) => {
      state.showDevDependencies = !state.showDevDependencies;
    },

    setProgress: (state, action: PayloadAction<LoadingProgress>) => {
      state.progress = action.payload;
    },

    nodesReceived: (state, action: PayloadAction<DependencyNode[]>) => {
      for (const node of action.payload) {
        state.nodes[node.name] = node;
      }
    },

    packagesFailed: (state, action: PayloadAction<PackageErrorEvent[]>) => {
      for (const { package: name, error } of action.payload) {
        const existing = state.nodes[name];
        state.nodes[name] = errorNode(name, existing?.version ?? '', error);
      }
      state.failedPackages += action.payload.length;
      const last = action.payload[action.payload.length - 1];
      state.error =
        state.failedPackages === 1
          ? `Failed to load ${last.package}: ${last.error}`
          : `${state.failedPackages} packages failed to load (last: ${last.package}: ${last.error})`;
    },

    analysisCompleted: (state, action: PayloadAction<CompleteEvent>) => {
      const { totalProcessed, duration } = action.payload;
      state.loading = false;
      state.progress = {
        current: totalProcessed,
        total: totalProcessed,
        level: state.maxDepth,
        currentPackage: `Completed: ${totalProcessed} packages in ${duration}`,
      };

      // Expand the first level only, deeper levels on demand.
      const rootName = state.rootPackage;
      const root = rootName ? state.nodes[rootName] : undefined;
      if (rootName && root) {
        for (const name of Object.keys(childDependencies(root, state.showDevDependencies))) {
          if (state.nodes[name]?.loaded) state.expanded[childPath(rootName, name)] = true;
        }
      }
    },

    analysisFailed: (state, action: PayloadAction<string>) => {
      state.loading = false;
      state.error = action.payload;
    },

    toggleExpanded: (state, action: PayloadAction<string>) => {
      if (state.expanded[action.payload]) {
        delete state.expanded[action.payload];
      } else {
        state.expanded[action.payload] = true;
      }
    },

    // Expands every loaded package at its shallowest occurrence. Other
    // occurrences stay collapsed, otherwise every shared subtree would be
    // rendered once per parent.
    expandAll: (state) => {
      const rootName = state.rootPackage;
      if (!rootName) return;

      const expanded: Record<string, true> = {};
      const done = new Set<string>([rootName]);
      let rows = 0;
      // Breadth first, so the occurrence closest to the root wins.
      let queue: Array<[string, string]> = [[rootName, rootName]];
      while (queue.length > 0 && rows < EXPAND_ALL_LIMIT) {
        const next: Array<[string, string]> = [];
        for (const [name, path] of queue) {
          const node = state.nodes[name];
          if (!node?.loaded) continue;
          const children = Object.keys(childDependencies(node, state.showDevDependencies));
          if (children.length === 0) continue;
          expanded[path] = true;
          rows += children.length;
          for (const child of children) {
            if (!done.has(child)) {
              done.add(child);
              next.push([child, childPath(path, child)]);
            }
          }
        }
        queue = next;
      }
      state.expanded = expanded;
    },

    collapseAll: (state) => {
      state.expanded = state.rootPackage ? { [state.rootPackage]: true } : {};
    },

    reset: () => initialState,
  },

  extraReducers: (builder) => {
    builder
      .addCase(loadDependency.pending, (state, action) => {
        const { packageName, version } = action.meta.arg;
        const existing = state.nodes[packageName];
        if (existing) {
          existing.loading = true;
        } else {
          state.nodes[packageName] = {
            name: packageName,
            version,
            dependencies: {},
            devDependencies: {},
            loaded: false,
            loading: true,
            childrenLoaded: false,
          };
        }
      })
      .addCase(loadDependency.fulfilled, (state, action) => {
        state.nodes[action.meta.arg.packageName] = action.payload;
      })
      .addCase(loadDependency.rejected, (state, action) => {
        const { packageName, version } = action.meta.arg;
        const message = action.payload ?? action.error.message ?? 'Unknown error';
        state.nodes[packageName] = errorNode(packageName, version, message);
        state.error = `Failed to load ${packageName}: ${message}`;
      })
      .addCase(analyzeWithBackend.pending, (state, action) => {
        state.loading = true;
        state.error = null;
        state.maxDepth = action.meta.arg.maxDepth;
        state.progress = { ...emptyProgress, currentPackage: 'Starting analysis...' };
      })
      .addCase(analyzeWithBackend.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || 'Failed to start backend analysis';
        state.progress = emptyProgress;
      });
  },
});

export const {
  setPackageData,
  setShowDevDependencies,
  toggleDevDependencies,
  setProgress,
  nodesReceived,
  packagesFailed,
  analysisCompleted,
  analysisFailed,
  toggleExpanded,
  expandAll,
  collapseAll,
  reset,
} = dependencySlice.actions;

export default dependencySlice.reducer;
