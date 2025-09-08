import React, { useState } from 'react';
import { Upload, FileText } from 'lucide-react';

interface PackageJsonInputProps {
  onSubmit: (content: string) => void;
}

export const PackageJsonInput: React.FC<PackageJsonInputProps> = ({ onSubmit }) => {
  const [content, setContent] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!content.trim()) {
      setError('Please paste your package.json content');
      return;
    }

    try {
      const parsed = JSON.parse(content);
      if (!parsed.name) {
        setError('Invalid package.json: missing "name" field');
        return;
      }
      onSubmit(content);
    } catch (err) {
      setError('Invalid JSON format. Please check your syntax.');
    }
  };

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setContent(text);
      setError('');
    } catch (err) {
      setError('Could not access clipboard. Please paste manually.');
    }
  };

  return (
    <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-8">
      <div className="text-center mb-8">
        <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-100 rounded-full mb-4">
          <FileText className="w-8 h-8 text-blue-600" />
        </div>
        <h2 className="text-2xl font-semibold text-slate-900 mb-2">Analyze Your Package Dependencies</h2>
        <p className="text-slate-600">Paste your package.json content to visualize the dependency tree</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <div className="flex items-center justify-between mb-3">
            <label htmlFor="packagejson" className="block text-sm font-medium text-slate-700">
              package.json Content
            </label>
            <button
              type="button"
              onClick={handlePaste}
              className="inline-flex items-center gap-2 text-sm text-blue-600 hover:text-blue-700 transition-colors"
            >
              <Upload className="w-4 h-4" />
              Paste from clipboard
            </button>
          </div>
          <textarea
            id="packagejson"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            className="w-full h-64 px-4 py-3 border border-slate-300 rounded-lg font-mono text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors resize-none"
            placeholder="Paste your package.json content here..."
          />
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <p className="text-red-800 text-sm">{error}</p>
          </div>
        )}

        <button
          type="submit"
          disabled={!content.trim()}
          className="w-full bg-blue-600 text-white py-3 px-6 rounded-lg font-medium hover:bg-blue-700 disabled:bg-slate-300 disabled:text-slate-500 transition-colors"
        >
          Analyze Dependencies
        </button>
      </form>

      <div className="mt-8 p-4 bg-slate-50 rounded-lg">
        <h3 className="text-sm font-medium text-slate-700 mb-2">Example package.json:</h3>
        <pre className="text-xs text-slate-600 overflow-x-auto">
{`{
  "name": "my-app",
  "version": "1.0.0",
  "dependencies": {
    "react": "^18.0.0",
    "lodash": "^4.17.21"
  }
}`}
        </pre>
      </div>
    </div>
  );
};