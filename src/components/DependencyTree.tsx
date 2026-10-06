import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, ChevronDown, Package, ExternalLink, Loader2 } from 'lucide-react';
import { DependencyNode } from '../types';
import { useAppSelector, useAppDispatch } from '../store/hooks';
import {
  childPath,
  collapseAll,
  expandAll,
  loadDependency,
  loadMissingChildren,
  toggleExpanded,
} from '../store/dependencySlice';

interface DependencyTreeProps {
  rootPackage: string;
}

interface Row {
  path: string;
  name: string;
  // Version spec from the parent, used while the node is not loaded yet.
  spec: string;
  level: number;
  isDevDependency: boolean;
  node: DependencyNode | undefined;
  expanded: boolean;
  circular: boolean;
  regularCount: number;
  devCount: number;
}

const ROW_HEIGHT = 56;
const OVERSCAN = 12;
// Deeper rows are not indented further so names stay readable.
const MAX_INDENT_LEVEL = 12;

const openExternal = (url: string) => window.open(url, '_blank', 'noopener');

// Flattens the visible part of the tree into rows in display order.
const buildRows = (
  nodes: Record<string, DependencyNode>,
  expanded: Record<string, true>,
  rootPackage: string,
  showDev: boolean
): Row[] => {
  const rows: Row[] = [];
  const ancestors = new Set<string>();

  const visit = (name: string, spec: string, path: string, level: number, isDev: boolean) => {
    const node = nodes[name];
    const regular = node?.loaded ? Object.entries(node.dependencies ?? {}) : [];
    const dev = node?.loaded && showDev ? Object.entries(node.devDependencies ?? {}) : [];
    const circular = ancestors.has(name);
    const isExpanded = !circular && expanded[path] === true && regular.length + dev.length > 0;

    rows.push({
      path,
      name,
      spec,
      level,
      isDevDependency: isDev,
      node,
      expanded: isExpanded,
      circular,
      regularCount: regular.length,
      devCount: dev.length,
    });

    if (!isExpanded) return;
    ancestors.add(name);
    for (const [child, childSpec] of regular) visit(child, childSpec, childPath(path, child), level + 1, false);
    const regularNames = new Set(regular.map(([child]) => child));
    for (const [child, childSpec] of dev) {
      // Same key scheme as childDependencies: regular entries win.
      const segment = regularNames.has(child) ? `dev:${child}` : child;
      visit(child, childSpec, childPath(path, segment), level + 1, true);
    }
    ancestors.delete(name);
  };

  visit(rootPackage, nodes[rootPackage]?.version ?? '', rootPackage, 0, false);
  return rows;
};

interface TreeRowProps {
  row: Row;
  top: number;
  showDevDependencies: boolean;
  analysisRunning: boolean;
}

const TreeRow: React.FC<TreeRowProps> = React.memo(({ row, top, showDevDependencies, analysisRunning }) => {
  const dispatch = useAppDispatch();
  const { node, name, spec, level, path } = row;
  const indent = 16 + Math.min(level, MAX_INDENT_LEVEL) * 24;
  const childCount = row.regularCount + row.devCount;
  const hasChildren = childCount > 0 && !row.circular;
  const canLoad = (!node || (!node.loaded && !node.loading)) && !(analysisRunning && !node);
  const pending = (!node && analysisRunning) || node?.loading;

  const handleClick = useCallback(() => {
    if (canLoad) {
      dispatch(loadDependency({ packageName: name, version: spec }));
      dispatch(toggleExpanded(path));
      return;
    }
    if (!hasChildren) return;
    if (!row.expanded) dispatch(loadMissingChildren(name));
    dispatch(toggleExpanded(path));
  }, [canLoad, hasChildren, row.expanded, dispatch, name, spec, path]);

  const handleExternalClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    const url = node?.homepage || node?.repository?.url;
    if (url) {
      openExternal(url.replace('git+', '').replace(/\.git$/, ''));
    } else {
      openExternal(`https://www.npmjs.com/package/${name}`);
    }
  };

  let subtitle = node?.description ?? '';
  if (node?.loaded && childCount === 0) {
    const devAvailable = Object.keys(node.devDependencies ?? {}).length;
    const noDeps =
      !showDevDependencies && devAvailable > 0 ? `No dependencies • ${devAvailable} dev deps available` : 'No dependencies';
    subtitle = subtitle ? `${subtitle} • ${noDeps}` : noDeps;
  }

  return (
    <div
      className={`absolute left-0 right-0 flex items-center px-4 hover:bg-slate-50 transition-colors group select-none ${
        level === 0 ? 'bg-blue-50 border-l-4 border-blue-500' : 'border-l border-transparent'
      } ${hasChildren || canLoad ? 'cursor-pointer' : 'cursor-default'}`}
      style={{ top, height: ROW_HEIGHT, paddingLeft: indent }}
      onClick={handleClick}
    >
      <div className="flex items-center gap-2 min-w-0 flex-1">
        {pending ? (
          <Loader2 className="w-4 h-4 text-blue-500 animate-spin flex-shrink-0" />
        ) : hasChildren || canLoad ? (
          row.expanded ? (
            <ChevronDown className="w-4 h-4 text-slate-400 flex-shrink-0" />
          ) : (
            <ChevronRight className="w-4 h-4 text-slate-400 flex-shrink-0" />
          )
        ) : (
          <div className="w-4 h-4 flex-shrink-0" />
        )}

        <Package className={`w-4 h-4 flex-shrink-0 ${node?.loaded ? 'text-slate-600' : 'text-slate-300'}`} />

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={`font-medium truncate ${node?.loaded ? 'text-slate-900' : 'text-slate-500'}`}>{name}</span>
            <span className="text-xs text-slate-500 flex-shrink-0">
              {node?.loaded ? `v${node.version}` : spec}
            </span>
            {level > 0 && row.isDevDependency && showDevDependencies && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800 flex-shrink-0">
                dev
              </span>
            )}
            {row.circular && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800 flex-shrink-0">
                circular
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
          {subtitle && <p className="text-xs text-slate-600 truncate mt-1">{subtitle}</p>}
        </div>
      </div>

      {hasChildren && !node?.loading && (
        <span className="text-xs text-slate-500 ml-2 flex-shrink-0">
          {row.regularCount} deps
          {row.devCount > 0 && <span className="text-purple-600 ml-1">+{row.devCount} dev</span>}
        </span>
      )}
      {canLoad && <span className="text-xs text-blue-600 ml-2 flex-shrink-0">Click to load</span>}
    </div>
  );
});

export const DependencyTree: React.FC<DependencyTreeProps> = ({ rootPackage }) => {
  const dispatch = useAppDispatch();
  const nodes = useAppSelector(state => state.dependencies.nodes);
  const expanded = useAppSelector(state => state.dependencies.expanded);
  const showDevDependencies = useAppSelector(state => state.dependencies.showDevDependencies);
  const analysisRunning = useAppSelector(state => state.dependencies.loading);

  const rows = useMemo(
    () => buildRows(nodes, expanded, rootPackage, showDevDependencies),
    [nodes, expanded, rootPackage, showDevDependencies]
  );

  // Only the rows inside the viewport are rendered.
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(600);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setViewportHeight(el.clientHeight));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const last = Math.min(rows.length, Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + OVERSCAN);

  if (!nodes[rootPackage]) {
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
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500 mr-2">{rows.length} rows</span>
          <button
            onClick={() => dispatch(expandAll())}
            className="px-3 py-1 text-sm text-blue-600 hover:bg-blue-50 rounded transition-colors"
            title="Expands each package at its first occurrence"
          >
            Expand All
          </button>
          <button
            onClick={() => dispatch(collapseAll())}
            className="px-3 py-1 text-sm text-slate-600 hover:bg-slate-50 rounded transition-colors"
          >
            Collapse All
          </button>
        </div>
      </div>

      {/* Tree */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-auto"
        onScroll={e => setScrollTop(e.currentTarget.scrollTop)}
      >
        <div className="relative" style={{ height: rows.length * ROW_HEIGHT }}>
          {rows.slice(first, last).map((row, i) => (
            <TreeRow
              key={row.path}
              row={row}
              top={(first + i) * ROW_HEIGHT}
              showDevDependencies={showDevDependencies}
              analysisRunning={analysisRunning}
            />
          ))}
        </div>
      </div>
    </div>
  );
};
