import React, {useEffect, useMemo, useRef, useState} from 'react';
import {useAppSelector} from '../store/hooks';

interface DependencyMapProps {
    rootPackage: string;
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
}

interface GraphEdge {
    from: string;
    to: string;
    isDevDependency: boolean;
}

// Deterministic pseudo random offset in [-0.5, 0.5) so the layout stays
// stable while nodes stream in.
const jitter = (name: string, salt: number) => {
    let hash = 2166136261 ^ salt;
    for (let i = 0; i < name.length; i++) {
        hash = Math.imul(hash ^ name.charCodeAt(i), 16777619);
    }
    return ((hash >>> 0) % 1000) / 1000 - 0.5;
};

export const DependencyMap: React.FC<DependencyMapProps> = ({rootPackage}) => {
    const dependencies = useAppSelector(state => state.dependencies.nodes);
    const showDevDependencies = useAppSelector(state => state.dependencies.showDevDependencies);
    const svgRef = useRef<SVGSVGElement>(null);
    const [transform, setTransform] = useState({x: 0, y: 0, scale: 1});
    const [isDragging, setIsDragging] = useState(false);
    const [selectedNode, setSelectedNode] = useState<string | null>(null);

    const {nodes, edges} = useMemo(() => {
        const nodeMap = new Map<string, GraphNode>();
        const edgeList: GraphEdge[] = [];
        const processedNodes = new Set<string>();

        const processNode = (name: string, level: number, parentX = 0, parentY = 0, angle = 0, isDevDep = false, siblingIndex = 0) => {
            if (processedNodes.has(name) || level > 3) return; // Limit depth to prevent infinite recursion

            const node = dependencies[name];
            if (!node || !node.loaded) return;

            processedNodes.add(name);

            let x, y;

            if (level === 0) {
                x = 0;
                y = 0;
            } else {
                // Improved spacing algorithm
                const baseRadius = Math.max(250, level * 180);
                const radiusVariation = level * 50; // Add some variation based on sibling position
                const radius = baseRadius + (siblingIndex % 3) * radiusVariation;

                // Add some spiral effect to prevent overlapping
                const spiralOffset = (siblingIndex * 0.3) + (level * 0.2);
                const adjustedAngle = angle + spiralOffset;

                x = parentX + Math.cos(adjustedAngle) * radius;
                y = parentY + Math.sin(adjustedAngle) * radius;

                // Add some randomization to prevent perfect alignment
                const jitterSize = 30;
                x += jitter(name, 1) * jitterSize;
                y += jitter(name, 2) * jitterSize;
            }

            nodeMap.set(name, {
                id: name,
                name,
                version: node.version,
                x,
                y,
                level,
                isRoot: level === 0,
                isDevDependency: isDevDep
            });

            // Collect regular dependencies
            const regularDeps = Object.keys(node.dependencies || {});

            // Collect dev dependencies if enabled
            const devDeps = showDevDependencies ? Object.keys(node.devDependencies || {}) : [];

            const allDeps = [...regularDeps, ...devDeps];

            if (allDeps.length > 0) {
                // Improved angle distribution
                const angleStep = (Math.PI * 1.8) / Math.max(allDeps.length, 1); // Use 1.8 instead of 2 to create gaps
                const startAngle = angle - (Math.PI * 0.9); // Start from a better position

                // Process regular dependencies
                regularDeps.forEach((depName, index) => {
                    edgeList.push({from: name, to: depName, isDevDependency: false});

                    const childAngle = startAngle + index * angleStep;
                    processNode(depName, level + 1, x, y, childAngle, false, index);
                });

                // Process dev dependencies
                devDeps.forEach((depName, index) => {
                    edgeList.push({from: name, to: depName, isDevDependency: true});

                    const childAngle = startAngle + (regularDeps.length + index) * angleStep;
                    processNode(depName, level + 1, x, y, childAngle, true, regularDeps.length + index);
                });
            }
        };

        processNode(rootPackage, 0, 0, 0, 0, false, 0);

        return {nodes: nodeMap, edges: edgeList};
    }, [dependencies, rootPackage, showDevDependencies]);

    // Add wheel event listener with passive: false to allow preventDefault
    useEffect(() => {
        const svgElement = svgRef.current;
        if (!svgElement) return;

        const handleWheelEvent = (e: WheelEvent) => {
            e.preventDefault();
            const scaleFactor = e.deltaY > 0 ? 0.9 : 1.1;
            setTransform(prev => ({
                ...prev,
                scale: Math.max(0.1, Math.min(3, prev.scale * scaleFactor))
            }));
        };

        svgElement.addEventListener('wheel', handleWheelEvent, {passive: false});

        return () => {
            svgElement.removeEventListener('wheel', handleWheelEvent);
        };
    }, []);

    const handleMouseDown = (e: React.MouseEvent) => {
        if (e.button === 0) {
            setIsDragging(true);
        }
    };

    const handleMouseMove = (e: React.MouseEvent) => {
        if (isDragging) {
            setTransform(prev => ({
                ...prev,
                x: prev.x + e.movementX,
                y: prev.y + e.movementY
            }));
        }
    };

    const handleMouseUp = () => {
        setIsDragging(false);
    };

    const resetView = () => {
        setTransform({x: 0, y: 0, scale: 1});
    };

    useEffect(() => {
        const handleGlobalMouseUp = () => setIsDragging(false);
        document.addEventListener('mouseup', handleGlobalMouseUp);
        return () => document.removeEventListener('mouseup', handleGlobalMouseUp);
    }, []);

    const selectedNodeData = selectedNode ? dependencies[selectedNode] : null;

    // The graph only changes with the data or the selection, not while
    // panning or zooming, so its elements are built once per change.
    const graph = useMemo(() => {
        const nodeList = Array.from(nodes.values());
        return (
            <>
                {/* Edges */}
                {edges.map((edge, index) => {
                    const fromNode = nodes.get(edge.from);
                    const toNode = nodes.get(edge.to);

                    if (!fromNode || !toNode) return null;

                    return (
                        <line
                            key={`${edge.from}-${edge.to}-${index}`}
                            x1={fromNode.x}
                            y1={fromNode.y}
                            x2={toNode.x}
                            y2={toNode.y}
                            stroke="#64748b"
                            strokeWidth="1"
                            opacity="0.6"
                            markerEnd="url(#arrowhead)"
                        />
                    );
                })}

                {/* Nodes */}
                {nodeList.map(node => (
                    <g key={node.id}>
                        <circle
                            cx={node.x}
                            cy={node.y}
                            r={node.isRoot ? 20 : 12}
                            fill={
                                node.isRoot
                                    ? '#3b82f6'
                                    : selectedNode === node.id
                                        ? '#10b981'
                                        : node.isDevDependency
                                            ? '#f97316'
                                            : '#6366f1'
                            }
                            stroke="#fff"
                            strokeWidth="2"
                            className="cursor-pointer hover:opacity-80 transition-opacity"
                            onClick={() => setSelectedNode(prev => (prev === node.id ? null : node.id))}
                        />
                        {node.isDevDependency && (
                            <circle
                                cx={node.x + 8}
                                cy={node.y - 8}
                                r="4"
                                fill="#ea580c"
                                stroke="#fff"
                                strokeWidth="1"
                                className="pointer-events-none"
                            />
                        )}
                        <text
                            x={node.x}
                            y={node.y + (node.isRoot ? 35 : 25)}
                            textAnchor="middle"
                            fontSize={node.isRoot ? "14" : "12"}
                            fill={node.isDevDependency ? "#ea580c" : "#1e293b"}
                            className="pointer-events-none font-medium"
                        >
                            {node.name}
                        </text>
                        {node.version && (
                            <text
                                x={node.x}
                                y={node.y + (node.isRoot ? 50 : 38)}
                                textAnchor="middle"
                                fontSize="10"
                                fill={node.isDevDependency ? "#c2410c" : "#64748b"}
                                className="pointer-events-none"
                            >
                                v{node.version}
                            </text>
                        )}
                    </g>
                ))}
            </>
        );
    }, [nodes, edges, selectedNode]);

    return (
        <div className="h-[600px] relative bg-slate-50">
            {/* Controls */}
            <div
                className="absolute top-4 left-4 z-10 bg-white rounded-lg shadow-sm border border-slate-200 p-3">
                <div className="flex flex-col gap-2">
                    <button
                        onClick={resetView}
                        className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
                    >
                        Reset View
                    </button>
                    <div className="text-xs text-slate-600">
                        <div>Zoom: {Math.round(transform.scale * 100)}%</div>
                        <div>Nodes: {nodes.size}</div>
                        {showDevDependencies && (
                            <div className="mt-2 pt-2 border-t border-slate-200">
                                <div className="flex items-center gap-1 mb-1">
                                    <div className="w-2 h-2 bg-blue-600 rounded-full"></div>
                                    <span>Regular</span>
                                </div>
                                <div className="flex items-center gap-1">
                                    <div className="w-2 h-2 bg-orange-500 rounded-full"></div>
                                    <span>Dev Deps</span>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Node Details */}
            {selectedNodeData && (
                <div
                    className="absolute top-4 right-4 z-10 bg-white rounded-lg shadow-lg border border-slate-200 p-4 max-w-xs">
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
                        <div><span
                            className="text-slate-500">Version:</span> {selectedNodeData.version}
                        </div>
                        {selectedNodeData.description && (
                            <div><span
                                className="text-slate-500">Description:</span> {selectedNodeData.description}
                            </div>
                        )}
                        {selectedNodeData.dependencies && (
                            <div>
                                <span
                                    className="text-slate-500">Dependencies:</span> {Object.keys(selectedNodeData.dependencies).length}
                            </div>
                        )}
                        {showDevDependencies && selectedNodeData.devDependencies && Object.keys(selectedNodeData.devDependencies).length > 0 && (
                            <div>
                                <span
                                    className="text-slate-500">Dev Dependencies:</span> {Object.keys(selectedNodeData.devDependencies).length}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* SVG Map */}
            <svg
                ref={svgRef}
                className="w-full h-full cursor-grab active:cursor-grabbing"
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                style={{cursor: isDragging ? 'grabbing' : 'grab'}}
            >
                <defs>
                    <marker
                        id="arrowhead"
                        markerWidth="10"
                        markerHeight="7"
                        refX="9"
                        refY="3.5"
                        orient="auto"
                    >
                        <polygon
                            points="0 0, 10 3.5, 0 7"
                            fill="#64748b"
                        />
                    </marker>
                </defs>

                <g
                    transform={`translate(${400 + transform.x}, ${300 + transform.y}) scale(${transform.scale})`}
                >
                    {graph}
                </g>
            </svg>
        </div>
    );
};