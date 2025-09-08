import React from 'react';
import { LoadingProgress } from '../types';

interface ProgressBarProps {
  progress: LoadingProgress;
  loading: boolean;
}

export const ProgressBar: React.FC<ProgressBarProps> = ({ progress, loading }) => {
  if (!loading || progress.total === 0) return null;

  const percentage = Math.min((progress.current / progress.total) * 100, 100);

  return (
    <div className="fixed top-4 right-4 z-50 bg-white rounded-lg shadow-lg border border-slate-200 p-4 min-w-[280px]">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-sm font-medium text-slate-900">Loading Dependencies</h4>
        <span className="text-xs text-slate-500">
          {progress.current}/{progress.total}
        </span>
      </div>
      
      <div className="w-full bg-slate-200 rounded-full h-2 mb-3">
        <div 
          className="bg-blue-600 h-2 rounded-full transition-all duration-300 ease-out"
          style={{ width: `${percentage}%` }}
        />
      </div>
      
      <div className="space-y-1 text-xs text-slate-600">
        <div className="flex items-center justify-between">
          <span>Level:</span>
          <span className="font-medium">{progress.level}/5</span>
        </div>
        {progress.currentPackage && (
          <div className="flex items-center justify-between">
            <span>Current:</span>
            <span className="font-mono text-blue-600 truncate max-w-[150px]">
              {progress.currentPackage}
            </span>
          </div>
        )}
        <div className="flex items-center justify-between">
          <span>Progress:</span>
          <span className="font-medium">{Math.round(percentage)}%</span>
        </div>
      </div>
    </div>
  );
};