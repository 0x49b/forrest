import React, { useState, useEffect } from 'react';
import { Activity, Users, Clock, List } from 'lucide-react';
import { workerPool } from '../services/workerPool';

export const WorkerStats: React.FC = () => {
  const [stats, setStats] = useState(workerPool.getStats());
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => {
      setStats(workerPool.getStats());
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  if (!isVisible) {
    return (
      <button
        onClick={() => setIsVisible(true)}
        className="fixed bottom-4 right-4 bg-blue-600 text-white p-3 rounded-full shadow-lg hover:bg-blue-700 transition-colors z-50"
        title="Show worker stats"
      >
        <Activity className="w-5 h-5" />
      </button>
    );
  }

  return (
    <div className="fixed bottom-4 right-4 bg-white rounded-lg shadow-lg border border-slate-200 p-4 min-w-[280px] z-50">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-medium text-slate-900 flex items-center gap-2">
          <Activity className="w-4 h-4" />
          Worker Pool Stats
        </h4>
        <button
          onClick={() => setIsVisible(false)}
          className="text-slate-400 hover:text-slate-600 text-lg leading-none"
        >
          ×
        </button>
      </div>

      <div className="space-y-2 text-sm">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2 text-slate-600">
            <Users className="w-3 h-3" />
            Total Workers:
          </span>
          <span className="font-medium text-slate-900">{stats.totalWorkers}</span>
        </div>

        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2 text-slate-600">
            <div className="w-3 h-3 bg-green-500 rounded-full" />
            Available:
          </span>
          <span className="font-medium text-green-600">{stats.availableWorkers}</span>
        </div>

        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2 text-slate-600">
            <Clock className="w-3 h-3" />
            Active:
          </span>
          <span className="font-medium text-blue-600">{stats.activeRequests}</span>
        </div>

        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2 text-slate-600">
            <List className="w-3 h-3" />
            Queued:
          </span>
          <span className="font-medium text-orange-600">{stats.queuedTasks}</span>
        </div>

        <div className="pt-2 border-t border-slate-200">
          <div className="text-xs text-slate-500">
            Pool Size: {import.meta.env.VITE_FETCHING_WORKERS || '10'} workers
          </div>
        </div>
      </div>
    </div>
  );
};