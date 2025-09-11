import { fetchPackageJson } from '../services/npmService';

export interface WorkerMessage {
  id: string;
  type: 'FETCH_DEPENDENCY';
  payload: {
    packageName: string;
    version: string;
    showDevDeps: boolean;
  };
}

export interface WorkerResponse {
  id: string;
  type: 'FETCH_SUCCESS' | 'FETCH_ERROR';
  payload: any;
}

// Worker message handler
self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
  const { id, type, payload } = event.data;

  if (type === 'FETCH_DEPENDENCY') {
    try {
      const { packageName, version, showDevDeps } = payload;
      
      const packageData = await fetchPackageJson(packageName, version);
      
      const dependencyNode = {
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
        license: packageData.license,
        hasNoDependencies: false
      };

      // Prepare child dependencies
      const childDeps = Object.entries(packageData.dependencies || {});
      const childDevDeps = showDevDeps ? Object.entries(packageData.devDependencies || {}) : [];
      const allChildDeps = [...childDeps, ...childDevDeps];

      dependencyNode.hasNoDependencies = allChildDeps.length === 0;

      const childNodes: Record<string, any> = {};
      allChildDeps.forEach(([depName, depVersion]) => {
        if (!childNodes[depName]) {
          childNodes[depName] = {
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
        }
      });

      const response: WorkerResponse = {
        id,
        type: 'FETCH_SUCCESS',
        payload: {
          mainNode: dependencyNode,
          childNodes,
          packageName
        }
      };

      self.postMessage(response);
    } catch (error) {
      const errorNode = {
        name: payload.packageName,
        version: payload.version,
        description: `Failed to load: ${error instanceof Error ? error.message : 'Package not found'}`,
        dependencies: {},
        devDependencies: {},
        loaded: true,
        loading: false,
        childrenLoaded: true,
        hasNoDependencies: true
      };

      const response: WorkerResponse = {
        id,
        type: 'FETCH_ERROR',
        payload: {
          errorNode,
          packageName: payload.packageName,
          error: error instanceof Error ? error.message : 'Unknown error'
        }
      };

      self.postMessage(response);
    }
  }
};