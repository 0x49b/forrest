import React from 'react';
import {LoadingProgress} from '../types';
import { useAppSelector } from '../store/hooks';

interface ProgressBarProps {
    progress: LoadingProgress;
}

export const ProgressBar: React.FC<ProgressBarProps> = ({progress}) => {
    const activeWorkers = useAppSelector(state => state.dependencies.activeWorkers);
    
    // Calculate actual progress considering active workers
    const actualProgress = activeWorkers > 0 ? 
        Math.min((progress.current / Math.max(progress.total, 1)) * 90, 90) : // Cap at 90% while workers are active
        Math.min((progress.current / Math.max(progress.total, 1)) * 100, 100);
    
    // Progress bar is now integrated into the package info div
    return (
        <div className="bg-blue-50 rounded-lg border border-blue-200 p-4 min-w-[280px]">
            <div className="flex items-center justify-between mb-2">
                <h4 className="text-sm font-medium text-blue-900">Loading Dependencies</h4>
                <span className="text-xs text-blue-600">
                        {progress.current}/{progress.total}
                        {activeWorkers > 0 && ` (+${activeWorkers} active)`}
                      </span>
            </div>

            <div className="w-full bg-blue-200 rounded-full h-2 mb-3">
                <div
                    className="bg-blue-600 h-2 rounded-full transition-all duration-300 ease-out"
                    style={{width: `${actualProgress}%`}}
                />
            </div>

            <div className="space-y-1 text-xs text-blue-700">
                <div className="flex items-center justify-between">
                    <span>Level:</span>
                    <span className="font-medium">{progress.level}/3</span>
                </div>
                {activeWorkers > 0 && (
                    <div className="flex items-center justify-between">
                        <span>Active Workers:</span>
                        <span className="font-medium text-orange-600">{activeWorkers}</span>
                    </div>
                )}
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
                    <span
                        className="font-medium">{Math.round(actualProgress)}%</span>
                </div>
            </div>
        </div>
    );
};