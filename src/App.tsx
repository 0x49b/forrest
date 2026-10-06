import {useCallback, useMemo, useState} from 'react';
import {PackageJsonInput} from './components/PackageJsonInput';
import {DependencyTree} from './components/DependencyTree';
import {DependencyMap} from './components/DependencyMap';
import {ProgressBar} from './components/ProgressBar';
import {useDependencyAnalyzer} from './hooks/useDependencyAnalyzer';
import {Map, Package, Settings, TreePine} from 'lucide-react';
import packageJson from '../package.json';
import {useAppSelector} from './store/hooks';

// Number of loaded packages, excluding packages only reachable through
// dev dependencies when those are hidden.
const AnalyzedCount = ({rootPackage, showDevDependencies}: { rootPackage: string; showDevDependencies: boolean }) => {
    const nodes = useAppSelector(state => state.dependencies.nodes);

    const count = useMemo(() => {
        const visited = new Set<string>([rootPackage]);
        const queue = [rootPackage];
        while (queue.length > 0) {
            const node = nodes[queue.pop()!];
            if (!node) continue;
            const children = showDevDependencies
                ? [...Object.keys(node.dependencies || {}), ...Object.keys(node.devDependencies || {})]
                : Object.keys(node.dependencies || {});
            for (const child of children) {
                if (!visited.has(child)) {
                    visited.add(child);
                    queue.push(child);
                }
            }
        }
        let loaded = 0;
        visited.forEach(name => {
            if (nodes[name]?.loaded) loaded++;
        });
        return loaded;
    }, [nodes, rootPackage, showDevDependencies]);

    return <>{count}</>;
};

function App() {
    const [view, setView] = useState<'tree' | 'map'>('tree');
    const [initialShowDevDependencies, setInitialShowDevDependencies] = useState(true);
    const [initialLoadLevels, setInitialLoadLevels] = useState(2);
    const {
        packageData,
        loading,
        error,
        showDevDependencies,
        analyzeDependencies,
        toggleDevDependencies,
        reset
    } = useDependencyAnalyzer();

    const handlePackageJsonSubmit = useCallback((content: string) => {
        try {
            const parsed = JSON.parse(content);
            analyzeDependencies(parsed, initialShowDevDependencies, initialLoadLevels);
        } catch (err) {
            console.error('Invalid JSON:', err);
        }
    }, [analyzeDependencies, initialShowDevDependencies, initialLoadLevels]);

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
                                <h1 className="text-2xl font-bold text-slate-900">Forrest Dependency Analyzer {packageJson.version}</h1>
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
                                    Start over
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
                            loadInitialLevels={initialLoadLevels}
                            onLoadInitialLevelsChange={setInitialLoadLevels}
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
                                            <AnalyzedCount rootPackage={packageData.name}
                                                           showDevDependencies={showDevDependencies}/>
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Loading Progress - Fixed Position */}
                        {loading && (
                            <div className="fixed top-20 right-6 z-40">
                                <ProgressBar/>
                            </div>
                        )}

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
                                <DependencyTree rootPackage={packageData.name}/>
                            ) : (
                                <DependencyMap rootPackage={packageData.name}/>
                            )}
                        </div>
                    </div>
                )}
            </main>
        </div>
    );
}

export default App;