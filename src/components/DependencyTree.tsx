import React, { useState, useMemo, useEffect } from 'react';
import { ChevronRight, ChevronDown, Package, ExternalLink, Loader2 } from 'lucide-react';
import { DependencyNode } from '../types';

interface DependencyTreeProps {
  dependencies: Map<string, DependencyNode>;
  rootPackage: string;
  showDevDependencies: boolean;
  onLoadDependencies: (packageName: string) => void;
  onPackageClick: (packageName: string, version: string) => void;
  expandedState?: Set<string>;
  onExpandedStateChange?: (expanded: Set<string>) => void;
}

interface TreeNodeProps {
  node: DependencyNode;
  dependencies: Map<string, DependencyNode>;
  showDevDependencies: boolean;
  level: number;
  isDevDependency?: boolean;
  expanded: Set<string>;
  onToggle: (key: string) => void;
  onLoadDependencies: (packageName: string) => void;
  onPackageClick: (packageName: string, version: string) => void;
}

const TreeNode: React.FC<TreeNodeProps> = ({ 
  node, 
  dependencies, 
  showDevDependencies,
  level, 
  isDevDependency = false,
  expanded, 
  onToggle, 
  onLoadDependencies, 
  onPackageClick 
}) => {
  const allDeps = {
    ...node.dependencies,
    ...(showDevDependencies ? node.devDependencies : {})
  };
  const hasChildren = allDeps && Object.keys(allDeps).length > 0;
  const canLoadDependencies = !node.childrenLoaded && !node.loading;
  const isExpanded = expanded.has(node.name);
  const indent = level * 24;

  const handleToggle = () => {

      console.log(`handleToggle for ${node.name}`);

    if (canLoadDependencies) {
      console.log(`Loading dependencies for ${node.name}`);
      onLoadDependencies(node.name);
      // Don't toggle expansion state until dependencies are loaded
      return;
    }
    
    if (hasChildren) {
      onToggle(node.name);
    }
  };

  const handlePackageClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    console.log(`handlePackageClick event: ${e} and ${node.name} `);
    // Load dependencies if not loaded
    if (!node.childrenLoaded && !node.loading) {
      onLoadDependencies(node.name);
    }
    onPackageClick(node.name, node.version);
  };

  const handleExternalClick = (e: React.MouseEvent) => {
    e.stopPropagation();

    console.log(`handleExternalClick event: ${e} and ${node.name} `);

    if (node.homepage || node.repository?.url) {
      const url = node.homepage || node.repository?.url;
      if (url) {
        window.open(url.replace('git+', '').replace('.git', ''), '_blank');
      }
    } else {
      window.open(`https://www.npmjs.com/package/${node.name}`, '_blank');
    }
  };

  return (
    <div className="select-none">
      <div 
        className={`flex items-center py-2 px-4 hover:bg-slate-50 transition-colors group ${
          level === 0 ? 'bg-blue-50 border-l-4 border-blue-500' : ''
        } ${hasChildren || canLoadDependencies ? 'cursor-pointer' : 'cursor-default'}`}
        style={{ paddingLeft: `${16 + indent}px` }}
        onClick={handleToggle}
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {node.loading ? (
            <Loader2 className="w-4 h-4 text-blue-500 animate-spin flex-shrink-0" />
          ) : hasChildren || canLoadDependencies ? (
            isExpanded ? (
              <ChevronDown className="w-4 h-4 text-slate-400 flex-shrink-0"/>
            ) : (
              <ChevronRight className="w-4 h-4 text-slate-400 flex-shrink-0"/>
            )
          ) : (
            <div className="w-4 h-4 flex-shrink-0" />
          )}
          
          <Package className="w-4 h-4 text-slate-600 flex-shrink-0" />
          
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <button
                onClick={handlePackageClick}
                className="font-medium text-slate-900 hover:text-blue-600 truncate transition-colors text-left"
              >
                {node.name}
              </button>
              <span className="text-xs text-slate-500 flex-shrink-0">v{node.version}</span>
              {/* Dev dependency badge - pass parent info to determine if this is a dev dep */}
              {level > 0 && isDevDependency && showDevDependencies && (
                <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800 flex-shrink-0">
                  dev
                </span>
              )}
              <button
                onClick={handleExternalClick}
                className="opacity-0 group-hover:opacity-100 hover:opacity-100 text-slate-400 hover:text-blue-600 transition-all"
                title="View on npm"
              >
                <ExternalLink className="w-3 h-3" />
              </button>
            </div>
            {node.description && (
              <p className="text-xs text-slate-600 truncate mt-1">{node.description}</p>
            )}
            {node.childrenLoaded && node.hasNoDependencies && !showDevDependencies && node.devDependencies && Object.keys(node.devDependencies).length > 0 && (
              <p className="text-xs text-slate-500 italic mt-1">
                No dependencies • {Object.keys(node.devDependencies).length} dev deps available
              </p>
            )}
            {node.childrenLoaded && node.hasNoDependencies && !showDevDependencies && (!node.devDependencies || Object.keys(node.devDependencies).length === 0) && (
              <p className="text-xs text-slate-500 italic mt-1">No dependencies</p>
            )}
            {node.childrenLoaded && node.hasNoDependencies && showDevDependencies && (
              <p className="text-xs text-slate-500 italic mt-1">No dependencies</p>
            )}
          </div>
        </div>
        
        {hasChildren && node.childrenLoaded && !node.loading && (
          <span className="text-xs text-slate-500 ml-2">
            {Object.keys(node.dependencies || {}).length} deps
            {showDevDependencies && node.devDependencies && Object.keys(node.devDependencies).length > 0 && (
              <span className="text-purple-600 ml-1">
                +{Object.keys(node.devDependencies).length} dev
              </span>
            )}
          </span>
        )}
        {canLoadDependencies && (
          <span className="text-xs text-blue-600 ml-2">Click to load</span>
        )}
      </div>

      {hasChildren && isExpanded && node.childrenLoaded && (
        <div className="border-l border-slate-200 ml-4">
          {Object.entries(node.dependencies || {}).map(([name, version]) => {
            const childNode = dependencies.get(name);
            
            if (childNode) {
              return (
                <div key={`${name}-${level}`}>
                  <TreeNode
                    node={childNode}
                    dependencies={dependencies}
                    showDevDependencies={showDevDependencies}
                    level={level + 1}
                    isDevDependency={false}
                    expanded={expanded}
                    onToggle={onToggle}
                    onLoadDependencies={onLoadDependencies}
                    onPackageClick={onPackageClick}
                  />
                </div>
              );
            }
            return (
              <div
                key={`${name}-${level}-loading`}
                className="flex items-center py-2 px-4 text-slate-500"
                style={{ paddingLeft: `${40 + indent}px` }}
              >
                <div className="w-3 h-3 border border-slate-300 border-t-transparent rounded-full animate-spin mr-3" />
                <span className="text-sm">
                  {name}@{version}
                </span>
              </div>
            );
          })}
          {showDevDependencies && Object.entries(node.devDependencies || {}).map(([name, version]) => {
            const childNode = dependencies.get(name);
            
            if (childNode) {
              return (
                <div key={`${name}-${level}`}>
                  <TreeNode
                    node={childNode}
                    dependencies={dependencies}
                    showDevDependencies={showDevDependencies}
                    level={level + 1}
                    isDevDependency={true}
                    expanded={expanded}
                    onToggle={onToggle}
                    onLoadDependencies={onLoadDependencies}
                    onPackageClick={onPackageClick}
                  />
                </div>
              );
            }
            return (
              <div
                key={`${name}-${level}-loading`}
                className="flex items-center py-2 px-4 text-slate-500"
                style={{ paddingLeft: `${40 + indent}px` }}
              >
                <div className="w-3 h-3 border border-slate-300 border-t-transparent rounded-full animate-spin mr-3" />
                <span className="text-sm">
                  {name}@{version}
                  <span className="inline-flex items-center rounded-md bg-purple-50 px-2 py-1 text-xs font-medium text-purple-700 inset-ring inset-ring-purple-700/10">
                    devDependency
                  </span>
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export const DependencyTree: React.FC<DependencyTreeProps> = ({ 
  dependencies, 
  rootPackage, 
  showDevDependencies,
  onLoadDependencies, 
  onPackageClick,
  expandedState,
  onExpandedStateChange
}) => {
  const [internalExpanded, setInternalExpanded] = useState<Set<string>>(new Set([rootPackage]));
  
  // Use external state if provided, otherwise use internal state
  const expanded = expandedState || internalExpanded;
  const setExpanded = onExpandedStateChange || setInternalExpanded;
  
  // Initialize expanded state with root package if using external state and it's empty
  useEffect(() => {
    if (expandedState && expandedState.size === 0 && rootPackage && onExpandedStateChange) {
      onExpandedStateChange(new Set([rootPackage]));
    }
  }, [expandedState, rootPackage, onExpandedStateChange]);

  const rootNode = useMemo(() => {
    return dependencies.get(rootPackage);
  }, [dependencies, rootPackage]);

  const handleToggle = (key: string) => {
    setExpanded(prev => {
      const newSet = new Set(prev);
      if (newSet.has(key)) {
        newSet.delete(key);
      } else {
        newSet.add(key);
      }
      return newSet;
    });
  };

  const handleExpandAll = () => {
    setExpanded(new Set(Array.from(dependencies.keys())));
  };

  const handleCollapseAll = () => {
    setExpanded(new Set([rootPackage]));
  };

  if (!rootNode) {
    return (
      <div className="p-8 text-center">
        <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <p className="text-slate-600">Loading dependency tree...</p>
      </div>
    );
  }

  return (
    <div className="h-[600px] flex flex-col">
      {/* Controls */}
      <div className="flex items-center justify-between p-4 border-b border-slate-200">
        <h3 className="text-lg font-medium text-slate-900">Dependency Tree</h3>
        <div className="flex gap-2">
          <button
            onClick={handleExpandAll}
            className="px-3 py-1 text-sm text-blue-600 hover:bg-blue-50 rounded transition-colors"
          >
            Expand All
          </button>
          <button
            onClick={handleCollapseAll}
            className="px-3 py-1 text-sm text-slate-600 hover:bg-slate-50 rounded transition-colors"
          >
            Collapse All
          </button>
        </div>
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-auto">
        <div className="group">
          <TreeNode
            node={rootNode}
            dependencies={dependencies}
            showDevDependencies={showDevDependencies}
            level={0}
            isDevDependency={false}
            expanded={expanded}
            onToggle={handleToggle}
            onLoadDependencies={onLoadDependencies}
            onPackageClick={onPackageClick}
          />
        </div>
      </div>
    </div>
  );
};