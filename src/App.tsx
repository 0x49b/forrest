import React, { useState, useCallback } from 'react';
import { PackageJsonInput } from './components/PackageJsonInput';
import { DependencyTree } from './components/DependencyTree';
import { DependencyMap } from './components/DependencyMap';
import { Breadcrumbs } from './components/Breadcrumbs';
import { useDependencyAnalyzer } from './hooks/useDependencyAnalyzer';
import { Package, View as TreeView } from 'lucide-react';

function App() {
  const [view, setView] = useState<'tree' | 'map'>('tree');
  const { 
    packageData, 
    dependencies, 
    loading, 
    error, 
    progress,
    breadcrumbs,
    analyzeDependencies,
    loadPackageDependencies,
    navigateToBreadcrumb,
    addToBreadcrumbs,
    reset 
  } = useDependencyAnalyzer();

  const handlePackageJsonSubmit = useCallback((content: string) => {
    try {
      const parsed = JSON.parse(content);
      analyzeDependencies(parsed);
    } catch (err) {
      console.error('Invalid JSON:', err);
    }
  }, [analyzeDependencies]);

  const handlePackageClick = useCallback((packageName: string, version: string) => {
    addToBreadcrumbs(packageName, version);
  }, [addToBreadcrumbs, loadPackageDependencies, dependencies]);
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
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
            </div>
            {packageData && (
              <div className="flex items-center gap-4">
                <div className="flex bg-slate-100 rounded-lg p-1">
                  <button
                    onClick={() => setView('tree')}
                    className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
                      view === 'tree' 
                        ? 'bg-white text-slate-900 shadow-sm' 
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Tree View
                  </button>
                  <button
                    onClick={() => setView('map')}
                    className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
                      view === 'map' 
                        ? 'bg-white text-slate-900 shadow-sm' 
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
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
            <PackageJsonInput onSubmit={handlePackageJsonSubmit} />
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
              </div>
              {packageData.description && (
                <p className="text-slate-700 mb-4">{packageData.description}</p>
              )}
              <div className="grid grid-cols-3 gap-4 text-sm">
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
                  <span className="ml-2 font-medium">{dependencies.size}</span>
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
                  onLoadDependencies={loadPackageDependencies}
                  onPackageClick={handlePackageClick}
                />
              ) : (
                <DependencyMap 
                  dependencies={dependencies} 
                  rootPackage={packageData.name}
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