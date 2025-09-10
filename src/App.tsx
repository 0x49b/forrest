import React, { useState, useCallback } from 'react';
import { PackageJsonInput } from './components/PackageJsonInput';
import { DependencyTree } from './components/DependencyTree';
import { DependencyMap } from './components/DependencyMap';
import { Breadcrumbs } from './components/Breadcrumbs';
import { ProgressBar } from './components/ProgressBar';
import { useDependencyAnalyzer } from './hooks/useDependencyAnalyzer';
import { Package, TreePine, Map, Settings } from 'lucide-react';

// Helper function to check if a node has a path through regular dependencies
const hasRegularDependencyPath = (targetName: string, dependencies: Map<string, DependencyNode>, rootName: string): boolean => {
  const visited = new Set<string>();
  
  const dfs = (currentName: string): boolean => {
    if (visited.has(currentName)) return false;
    visited.add(currentName);
    
    const node = dependencies.get(currentName);
    if (!node) return false;
    
    // Check if target is in regular dependencies
    if (node.dependencies?.[targetName]) return true;
    
    // Recursively check regular dependencies
    for (const depName of Object.keys(node.dependencies || {})) {
      if (dfs(depName)) return true;
    }
    
    return false;
  };
  
  return dfs(rootName);
};

function App() {
  const [view, setView] = useState<'tree' | 'map'>('tree');
  const [initialShowDevDependencies, setInitialShowDevDependencies] = useState(true);
  const { 
    packageData, 
    dependencies, 
    loading, 
    error, 
    progress,
    breadcrumbs,
    showDevDependencies,
    analyzeDependencies,
    loadPackageDependencies,
    navigateToBreadcrumb,
    addToBreadcrumbs,
    toggleDevDependencies,
    reset 
  } = useDependencyAnalyzer();

  const handlePackageJsonSubmit = useCallback((content: string) => {
    try {
      const parsed = JSON.parse(content);
      analyzeDependencies(parsed, initialShowDevDependencies);
    } catch (err) {
      console.error('Invalid JSON:', err);
    }
  }, [analyzeDependencies, initialShowDevDependencies]);

  const handlePackageClick = useCallback((packageName: string, version: string) => {
    addToBreadcrumbs(packageName, version);
  }, [addToBreadcrumbs]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      {/* Progress Bar */}
      <ProgressBar progress={progress} loading={loading} />

      {/* Header */}
      <header className="bg-white border-b border-slate-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-100 rounded-lg">
                <Package className="w-6 h-6 text-blue-600" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-slate-900">Package Dependency Analyzer</h1>
                <p className="text-slate-600">Visualize and explore npm package dependencies</p>
              </div>
              {/* Loading Progress */}
              {loading && (
                <div className="bg-blue-50 rounded-lg border border-blue-200 p-4 min-w-[280px]">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-sm font-medium text-blue-900">Loading Dependencies</h4>
                    <span className="text-xs text-blue-600">
                      {progress.current}/{progress.total}
                    </span>
                  </div>
                  
                  <div className="w-full bg-blue-200 rounded-full h-2 mb-3">
                    <div 
                      className="bg-blue-600 h-2 rounded-full transition-all duration-300 ease-out"
                      style={{ width: `${Math.min((progress.current / progress.total) * 100, 100)}%` }}
                    />
                  </div>
                  
                  <div className="space-y-1 text-xs text-blue-700">
                    <div className="flex items-center justify-between">
                      <span>Level:</span>
                      <span className="font-medium">{Math.min(progress.level, 2)}/2</span>
                    </div>
                    {progress.currentPackage && (
                      <div className="flex items-center justify-between">
                        <span>Current:</span>
                        <span className="font-mono text-blue-800 truncate max-w-[150px]">
                          {progress.currentPackage}
                        </span>
                      </div>
                    )}
                    <div className="flex items-center justify-between">
                      <span>Progress:</span>
                      <span className="font-medium">{Math.round(Math.min((progress.current / progress.total) * 100, 100))}%</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
            {packageData && (
              <div className="flex items-center gap-4">
                {/* Dev Dependencies Toggle */}
                <div className="flex items-center gap-2">
                  <Settings className="w-4 h-4 text-slate-500" />
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={showDevDependencies}
                      onChange={toggleDevDependencies}
                      className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    />
                    Show dev dependencies
                  </label>
                </div>

                {/* View Toggle */}
                <div className="flex bg-slate-100 rounded-lg p-1">
                  <button
                    onClick={() => setView('tree')}
                    className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${
                      view === 'tree' 
                        ? 'bg-white text-slate-900 shadow-sm' 
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <TreePine className="w-4 h-4" />
                    Tree View
                  </button>
                  <button
                    onClick={() => setView('map')}
                    className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${
                      view === 'map' 
                        ? 'bg-white text-slate-900 shadow-sm' 
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <Map className="w-4 h-4" />
                    Map View
                  </button>
                </div>
                <button
                  onClick={reset}
                  className="px-4 py-2 bg-slate-600 text-white rounded-lg hover:bg-slate-700 transition-colors"
                >
                  Reset
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Breadcrumbs */}
      {packageData && breadcrumbs.length > 0 && (
        <Breadcrumbs items={breadcrumbs} onNavigate={navigateToBreadcrumb} />
      )}

      <main className="max-w-7xl mx-auto px-6 py-8">
        {!packageData ? (
          <div className="max-w-2xl mx-auto">
            <PackageJsonInput 
              onSubmit={handlePackageJsonSubmit}
              showDevDependencies={initialShowDevDependencies}
              onToggleDevDependencies={setInitialShowDevDependencies}
            />
          </div>
        ) : (
          <div className="space-y-6">
            {/* Package Info */}
            <div className="bg-white rounded-lg border border-slate-200 p-6 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-xl font-semibold text-slate-900">{packageData.name}</h2>
                  <p className="text-slate-600">{packageData.version}</p>
                </div>
                {/* Loading Progress */}
                {loading && (
                  <div className="bg-blue-50 rounded-lg border border-blue-200 p-4 min-w-[280px]">
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="text-sm font-medium text-blue-900">Loading Dependencies</h4>
                      <span className="text-xs text-blue-600">
                        {progress.current}/{progress.total}
                      </span>
                    </div>
                    
                    <div className="w-full bg-blue-200 rounded-full h-2 mb-3">
                      <div 
                        className="bg-blue-600 h-2 rounded-full transition-all duration-300 ease-out"
                        style={{ width: `${Math.min((progress.current / progress.total) * 100, 100)}%` }}
                      />
                    </div>
                    
                    <div className="space-y-1 text-xs text-blue-700">
                      <div className="flex items-center justify-between">
                        <span>Level:</span>
                        <span className="font-medium">{Math.min(progress.level, 2)}/2</span>
                      </div>
                      {progress.currentPackage && (
                        <div className="flex items-center justify-between">
                          <span>Current:</span>
                          <span className="font-mono text-blue-800 truncate max-w-[150px]">
                            {progress.currentPackage}
                          </span>
                        </div>
                      )}
                      <div className="flex items-center justify-between">
                        <span>Progress:</span>
                        <span className="font-medium">{Math.round(Math.min((progress.current / progress.total) * 100, 100))}%</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
              {packageData.description && (
                <p className="text-slate-700 mb-4">{packageData.description}</p>
              )}
              <div className="flex items-center justify-between">
                <div className="flex gap-6 text-sm">
                  <div>
                    <span className="text-slate-500">Dependencies:</span>
                    <span className="ml-2 font-medium">{Object.keys(packageData.dependencies || {}).length}</span>
                  </div>
                  <div>
                    <span className="text-slate-500">Dev Dependencies:</span>
                    <span className="ml-2 font-medium">{Object.keys(packageData.devDependencies || {}).length}</span>
                  </div>
                  <div>
                    <span className="text-slate-500">Total Analyzed:</span>
                    <span className="ml-2 font-medium">
                      {Array.from(dependencies.values()).filter(node => {
                        if (!showDevDependencies) {
                          // Only count nodes that are not dev-only dependencies
                          const rootNode = dependencies.get(packageData.name);
                          const isInRegularDeps = rootNode?.dependencies?.[node.name];
                          const isRoot = node.name === packageData.name;
                          return isRoot || isInRegularDeps || hasRegularDependencyPath(node.name, dependencies, packageData.name);
                        }
                        return true;
                      }).length}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Error Display */}
            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                <p className="text-red-800">{error}</p>
              </div>
            )}

            {/* Visualization */}
            <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
              {view === 'tree' ? (
                <DependencyTree 
                  dependencies={dependencies} 
                  rootPackage={packageData.name}
                  showDevDependencies={showDevDependencies}
                  onLoadDependencies={loadPackageDependencies}
                  onPackageClick={handlePackageClick}
                />
              ) : (
                <DependencyMap 
                  dependencies={dependencies} 
                  rootPackage={packageData.name}
                  showDevDependencies={showDevDependencies}
                />
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;