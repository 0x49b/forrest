import {useCallback, useState} from 'react';
import {PackageJsonInput} from './components/PackageJsonInput';
import {DependencyTree} from './components/DependencyTree';
import {DependencyMap} from './components/DependencyMap';
import {ProgressBar} from './components/ProgressBar';
import {useDependencyAnalyzer} from './hooks/useDependencyAnalyzer';
import {Map, Package, Settings, TreePine} from 'lucide-react';
import packageJson from '../package.json';
import {DependencyNode} from "./types";

// Helper function to check if a node has a path through regular dependencies
const hasRegularDependencyPath = (targetName: string, dependencies: Map<string, DependencyNode>, rootName: string): boolean => {
    const visited = new Set<string>();

    const dfs = (currentName: string): boolean => {
        if (visited.has(currentName)) return false;
        visited.add(currentName);

        const node = dependencies.get(currentName);
        if (!node) return false;

        // Check if target is in regular dependencies and children are loaded
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
        showDevDependencies,
        analyzeDependencies,
        loadPackageDependencies,
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
        // Package click functionality can be implemented later if needed
        console.log(`Clicked on package: ${packageName}@${version}`);
    }, [addToBreadcrumbs]);

    const handleLoadDependencies = useCallback((packageName: string) => {
        console.log(`App: Loading dependencies for ${packageName}`);
        loadPackageDependencies(packageName);
    }, [loadPackageDependencies]);

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
            {/* Header */}
            <header className="bg-white border-b border-slate-200 shadow-sm">
                <div className="max-w-7xl mx-auto px-6 py-4">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-blue-100 rounded-lg">
                                <Package className="w-6 h-6 text-blue-600"/>
                            </div>
                            <div>
                                <h1 className="text-2xl font-bold text-slate-900">Package Dependency
                                    Analyzer {packageJson.version}</h1>
                                <p className="text-slate-600">Visualize and explore npm package
                                    dependencies</p>
                            </div>
                        </div>
                        {packageData && (
                            <div className="flex items-center gap-4">
                                {/* Dev Dependencies Toggle */}
                                <div className="flex items-center gap-2">
                                    <Settings className="w-4 h-4 text-slate-500"/>
                                    <label
                                        className="flex items-center gap-2 text-sm text-slate-700">
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
                                        <TreePine className="w-4 h-4"/>
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
                                        <Map className="w-4 h-4"/>
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
                                    <ProgressBar progress={progress}/>
                                )}
                            </div>
                            {packageData.description && (
                                <p className="text-slate-700 mb-4">{packageData.description}</p>
                            )}
                            <div className="flex items-center justify-between">
                                <div className="flex gap-6 text-sm">
                                    <div>
                                        <span className="text-slate-500">Dependencies:</span>
                                        <span
                                            className="ml-2 font-medium">{Object.keys(packageData.dependencies || {}).length}</span>
                                    </div>
                                    <div>
                                        <span className="text-slate-500">Dev Dependencies:</span>
                                        <span
                                            className="ml-2 font-medium">{Object.keys(packageData.devDependencies || {}).length}</span>
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
                        <div
                            className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
                            {view === 'tree' ? (
                                <DependencyTree
                                    dependencies={dependencies}
                                    rootPackage={packageData.name}
                                    showDevDependencies={showDevDependencies}
                                    onLoadDependencies={handleLoadDependencies}
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