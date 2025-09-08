import React from 'react';
import { ChevronRight, Home } from 'lucide-react';
import { BreadcrumbItem } from '../types';

interface BreadcrumbsProps {
  items: BreadcrumbItem[];
  onNavigate: (index: number) => void;
}

export const Breadcrumbs: React.FC<BreadcrumbsProps> = ({ items, onNavigate }) => {
  if (items.length === 0) return null;

  return (
    <div className="bg-white border-b border-slate-200 px-6 py-3">
      <nav className="flex items-center space-x-2 text-sm">
        <Home className="w-4 h-4 text-slate-400" />
        {items.map((item, index) => (
          <React.Fragment key={`${item.name}-${index}`}>
            {index > 0 && <ChevronRight className="w-4 h-4 text-slate-400" />}
            <button
              onClick={() => onNavigate(index)}
              className={`px-2 py-1 rounded transition-colors ${
                index === items.length - 1
                  ? 'text-slate-900 font-medium bg-slate-100'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
              }`}
            >
              <span className="font-medium">{item.name}</span>
              <span className="text-xs text-slate-500 ml-1">v{item.version}</span>
            </button>
          </React.Fragment>
        ))}
      </nav>
    </div>
  );
};