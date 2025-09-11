import React, { useRef, useEffect, useState, useMemo } from 'react';
import * as d3 from 'd3';
import { DependencyNode } from '../types';

interface DependencyMapProps {
  dependencies: Map<string, DependencyNode>;
  rootPackage: string;
  showDevDependencies: boolean;
}

interface GraphNode {
  id: string;
  name: string;
  version: string;
  x: number;
  y: number;
  level: number;
  isRoot: boolean;
  isDevDependency: boolean;
  referenceCount: number;
  radius: number;
  fx?: number | null;
  fy?: number | null;
}

interface GraphEdge {
  source: string;
  target: string;
  isDevDependency: boolean;
}

export const DependencyMap: React.FC<DependencyMapProps> = ({ dependencies, rootPackage, showDevDependencies }) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const simulationRef = useRef<d3.Simulation<GraphNode, GraphEdge> | null>(null);
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const [isDragging, setIsDragging] = useState(false);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);

  // Calculate reference count for each package
  const referenceCount = useMemo(() => {
    const counts = new Map<string, number>();
    
    dependencies.forEach((node) => {
      // Count regular dependencies
      Object.keys(node.dependencies || {}).forEach(depName => {
        counts.set(depName, (counts.get(depName) || 0) + 1);
      });
      
      // Count dev dependencies if enabled
      if (showDevDependencies) {
        Object.keys(node.devDependencies || {}).forEach(depName => {
          counts.set(depName, (counts.get(depName) || 0) + 1);
        });
      }
    });
    
    return counts;
  }, [dependencies, showDevDependencies]);

  const { nodes, edges } = useMemo(() => {
    const nodeMap = new Map<string, GraphNode>();
    const edgeList: GraphEdge[] = [];
    const visited = new Set<string>();
    
    // Helper function to check if a node has a path through regular dependencies
    const hasRegularDependencyPath = (targetName: string): boolean => {
      const visitedInPath = new Set<string>();
      
      const dfs = (currentName: string): boolean => {
        if (visitedInPath.has(currentName)) return false;
        visitedInPath.add(currentName);
        
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
      
      return dfs(rootPackage);
    };
    
    // Process all dependencies that should be shown
    dependencies.forEach((node, name) => {
      // Skip if not showing dev dependencies and this is a dev-only dependency
      if (!showDevDependencies) {
        const isRoot = name === rootPackage;
        const rootNode = dependencies.get(rootPackage);
        const isInRegularDeps = rootNode?.dependencies?.[name];
        
        if (!isRoot && !isInRegularDeps && !hasRegularDependencyPath(name)) {
          return;
        }
      }
      
      const refCount = referenceCount.get(name) || 0;
      const isRoot = name === rootPackage;
      
      // Calculate node radius based on reference count
      let radius;
      if (isRoot) {
        radius = 25; // Root node is always large
      } else if (refCount === 0) {
        radius = 8; // Leaf nodes
      } else {
        // Scale radius based on reference count (8-20px range)
        radius = Math.min(20, 8 + (refCount * 2));
      }
      
      nodeMap.set(name, {
        id: name,
        name,
        version: node.version,
        x: 0,
        y: 0,
        level: 0,
        isRoot,
        isDevDependency: false, // We'll determine this from edges
        referenceCount: refCount,
        radius
      });
    });
    
    // Create edges and mark dev dependencies
    nodeMap.forEach((node, name) => {
      const depNode = dependencies.get(name);
      if (!depNode) return;
      
      // Regular dependencies
      Object.keys(depNode.dependencies || {}).forEach(depName => {
        if (nodeMap.has(depName)) {
          edgeList.push({ source: name, target: depName, isDevDependency: false });
        }
      });
      
      // Dev dependencies
      if (showDevDependencies) {
        Object.keys(depNode.devDependencies || {}).forEach(depName => {
          if (nodeMap.has(depName)) {
            edgeList.push({ source: name, target: depName, isDevDependency: true });
            // Mark target node as dev dependency if it's only reached through dev deps
            const targetNode = nodeMap.get(depName);
            if (targetNode && !targetNode.isRoot) {
              // Check if this node is only reachable through dev dependencies
              const hasRegularPath = edgeList.some(edge => 
                edge.target === depName && !edge.isDevDependency
              );
              if (!hasRegularPath) {
                nodeMap.set(depName, { ...targetNode, isDevDependency: true });
              }
            }
          }
        });
      }
    });
    
    return { nodes: Array.from(nodeMap.values()), edges: edgeList };
  }, [dependencies, rootPackage, showDevDependencies, referenceCount]);

  // D3 Force Simulation
  useEffect(() => {
    if (!svgRef.current || nodes.length === 0) return;

    const svg = d3.select(svgRef.current);
    const width = 800;
    const height = 600;
    
    // Clear previous content
    svg.selectAll("*").remove();
    
    // Create zoom behavior
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 4])
      .on("zoom", (event) => {
        container.attr("transform", event.transform);
      });
    
    svg.call(zoom);
    
    // Create container for zoomable content
    const container = svg.append("g");
    
    // Create simulation
    const simulation = d3.forceSimulation<GraphNode>(nodes)
      .force("link", d3.forceLink<GraphNode, GraphEdge>(edges)
        .id(d => d.id)
        .distance(d => {
          const sourceNode = nodes.find(n => n.id === d.from);
          const targetNode = nodes.find(n => n.id === d.to);
          const baseDistance = 100;
          const radiusSum = (sourceNode?.radius || 10) + (targetNode?.radius || 10);
          return baseDistance + radiusSum;
        })
        .strength(0.3)
      )
      .force("charge", d3.forceManyBody()
        .strength(d => d.isRoot ? -1000 : -300 - (d.referenceCount * 50))
      )
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collision", d3.forceCollide<GraphNode>()
        .radius(d => d.radius + 5)
        .strength(0.7)
      );
    
    simulationRef.current = simulation;
    
    // Create arrow markers
    const defs = container.append("defs");
    
    defs.append("marker")
      .attr("id", "arrowhead")
      .attr("viewBox", "0 -5 10 10")
      .attr("refX", 8)
      .attr("refY", 0)
      .attr("markerWidth", 6)
      .attr("markerHeight", 6)
      .attr("orient", "auto")
      .append("path")
      .attr("d", "M0,-5L10,0L0,5")
      .attr("fill", "#64748b");
    
    defs.append("marker")
      .attr("id", "arrowhead-dev")
      .attr("viewBox", "0 -5 10 10")
      .attr("refX", 8)
      .attr("refY", 0)
      .attr("markerWidth", 6)
      .attr("markerHeight", 6)
      .attr("orient", "auto")
      .append("path")
      .attr("d", "M0,-5L10,0L0,5")
      .attr("fill", "#f97316");
    
    // Create links
    const link = container.append("g")
      .selectAll("line")
      .data(edges)
      .join("line")
      .attr("stroke", d => d.isDevDependency ? "#f97316" : "#64748b")
      .attr("stroke-opacity", 0.6)
      .attr("stroke-width", 1.5)
      .attr("marker-end", d => d.isDevDependency ? "url(#arrowhead-dev)" : "url(#arrowhead)");
    
    // Create nodes
    const node = container.append("g")
      .selectAll("g")
      .data(nodes)
      .join("g")
      .attr("cursor", "pointer")
      .call(d3.drag<SVGGElement, GraphNode>()
        .on("start", (event, d) => {
          if (!event.active) simulation.alphaTarget(0.3).restart();
          d.fx = d.x;
          d.fy = d.y;
        })
        .on("drag", (event, d) => {
          d.fx = event.x;
          d.fy = event.y;
        })
        .on("end", (event, d) => {
          if (!event.active) simulation.alphaTarget(0);
          d.fx = null;
          d.fy = null;
        })
      );
    
    // Add circles to nodes
    node.filter(d => d.referenceCount > 0 && !d.isRoot)
      .append("circle")
      .attr("r", 8)
      .attr("cx", d => d.radius * 0.7)
      .attr("cy", d => -d.radius * 0.7)
      .attr("fill", "#ef4444")
      .attr("stroke", "#fff")
      .attr("stroke-width", 1);
    
    node.filter(d => d.referenceCount > 0 && !d.isRoot)
      .append("text")
      .attr("x", d => d.radius * 0.7)
      .attr("y", d => -d.radius * 0.7)
      .attr("text-anchor", "middle")
      .attr("dominant-baseline", "central")
      .attr("fill", "white")
      .attr("font-size", "10px")
      .attr("font-weight", "bold")
      .text(d => d.referenceCount);
    
    // Add labels
    node.append("text")
      .attr("x", 0)
      .attr("y", d => d.radius + 15)
      .attr("text-anchor", "middle")
      .attr("font-size", d => d.isRoot ? "14px" : "12px")
      .attr("font-weight", d => d.isRoot ? "bold" : "normal")
      .attr("fill", d => d.isDevDependency ? "#ea580c" : "#1e293b")
      .text(d => d.name);
    
    // Add version labels
    node.append("text")
      .attr("x", 0)
      .attr("y", d => d.radius + 28)
      .attr("text-anchor", "middle")
      .attr("font-size", "10px")
      .attr("fill", d => d.isDevDependency ? "#c2410c" : "#64748b")
      .text(d => `v${d.version}`);
    
    // Update positions on simulation tick
    simulation.on("tick", () => {
      link
        .attr("x1", d => {
          const sourceNode = nodes.find(n => n.id === d.from);
          return sourceNode?.x || 0;
        })
        .attr("y1", d => {
          const sourceNode = nodes.find(n => n.id === d.from);
          return sourceNode?.y || 0;
        })
        .attr("x2", d => {
          const targetNode = nodes.find(n => n.id === d.to);
          return targetNode?.x || 0;
        })
        .attr("y2", d => {
          const targetNode = nodes.find(n => n.id === d.to);
          return targetNode?.y || 0;
        });
      
      node.attr("transform", d => `translate(${d.x},${d.y})`);
    });
    
    // Reset zoom on double click
    svg.on("dblclick.zoom", () => {
      svg.transition().duration(750).call(
        zoom.transform,
        d3.zoomIdentity
      );
    });
    
    return () => {
      simulation.stop();
    };
  }, [nodes, edges, selectedNode]);

  const resetSimulation = () => {
    if (simulationRef.current) {
      simulationRef.current.alpha(1).restart();
    }
  };

  const selectedNodeData = selectedNode ? dependencies.get(selectedNode) : null;
  const selectedNodeRef = selectedNode ? referenceCount.get(selectedNode) || 0 : 0;

  return (
    <div className="h-[600px] relative bg-slate-50">
      {/* Controls */}
      <div className="absolute top-4 left-4 z-10 bg-white rounded-lg shadow-sm border border-slate-200 p-3">
        <div className="flex flex-col gap-2">
          <button
            onClick={resetSimulation}
            className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
          >
            Restart Simulation
          </button>
          <div className="text-xs text-slate-600">
            <div>Nodes: {nodes.length}</div>
            <div>Edges: {edges.length}</div>
            <div className="mt-2 pt-2 border-t border-slate-200">
              <div className="mb-1 font-medium">Legend:</div>
              <div className="flex items-center gap-1 mb-1">
                <div className="w-3 h-3 bg-blue-600 rounded-full"></div>
                <span>Root</span>
              </div>
              <div className="flex items-center gap-1 mb-1">
                <div className="w-2 h-2 bg-indigo-600 rounded-full"></div>
                <span>Regular</span>
              </div>
              {showDevDependencies && (
                <div className="flex items-center gap-1 mb-1">
                  <div className="w-2 h-2 bg-orange-500 rounded-full"></div>
                  <span>Dev Deps</span>
                </div>
              )}
              <div className="flex items-center gap-1">
                <div className="w-3 h-3 bg-red-500 rounded-full flex items-center justify-center">
                  <span className="text-white text-xs font-bold">N</span>
                </div>
                <span>Ref Count</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Node Details */}
      {selectedNodeData && (
        <div className="absolute top-4 right-4 z-10 bg-white rounded-lg shadow-lg border border-slate-200 p-4 max-w-xs">
          <div className="flex items-center justify-between mb-2">
            <h4 className="font-medium text-slate-900">{selectedNodeData.name}</h4>
            <button
              onClick={() => setSelectedNode(null)}
              className="text-slate-400 hover:text-slate-600"
            >
              ×
            </button>
          </div>
          <div className="text-sm space-y-1">
            <div><span className="text-slate-500">Version:</span> {selectedNodeData.version}</div>
            <div><span className="text-slate-500">Referenced by:</span> {selectedNodeRef} packages</div>
            {selectedNodeData.description && (
              <div><span className="text-slate-500">Description:</span> {selectedNodeData.description}</div>
            )}
            {selectedNodeData.dependencies && (
              <div>
                <span className="text-slate-500">Dependencies:</span> {Object.keys(selectedNodeData.dependencies).length}
              </div>
            )}
            {showDevDependencies && selectedNodeData.devDependencies && Object.keys(selectedNodeData.devDependencies).length > 0 && (
              <div>
                <span className="text-slate-500">Dev Dependencies:</span> {Object.keys(selectedNodeData.devDependencies).length}
              </div>
            )}
          </div>
        </div>
      )}

      {/* SVG Container */}
      <svg
        ref={svgRef}
        className="w-full h-full"
        viewBox="0 0 800 600"
        style={{ background: 'transparent' }}
      />
      
      {/* Instructions */}
      <div className="absolute bottom-4 left-4 text-xs text-slate-500 bg-white/80 rounded px-2 py-1">
        Drag nodes • Double-click to reset zoom • Scroll to zoom
      </div>
    </div>
  );
};