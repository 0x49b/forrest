import type { PackageJson, DependencyNode, LoadingProgress } from '../types';

export interface AnalyzeConfig {
  includeDevDependencies: boolean;
  maxDepth: number;
  parallelWorkers: number;
}

export interface AnalyzeResponse {
  sessionId: string;
  streamUrl: string;
}

export interface ProgressEvent {
  current: number;
  total: number;
  level: number;
  currentPackage: string;
}

export interface CompleteEvent {
  totalProcessed: number;
  duration: string;
}

export interface ErrorEvent {
  package: string;
  error: string;
}

export class BackendService {
  private baseUrl: string;

  constructor(baseUrl: string = '/api') {
    this.baseUrl = baseUrl;
  }

  async startAnalysis(
    packageJson: PackageJson,
    config: AnalyzeConfig
  ): Promise<AnalyzeResponse> {
    const response = await fetch(`${this.baseUrl}/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        packageJson,
        includeDevDependencies: config.includeDevDependencies,
        maxDepth: config.maxDepth,
        parallelWorkers: config.parallelWorkers,
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error(`Analysis failed: ${error.error || response.statusText}`);
    }

    return response.json();
  }

  createEventSource(sessionId: string): EventSource {
    return new EventSource(`${this.baseUrl}/events/${sessionId}`);
  }

  async checkHealth(): Promise<{ status: string }> {
    const response = await fetch(`${this.baseUrl}/health`);
    if (!response.ok) {
      throw new Error('Health check failed');
    }
    return response.json();
  }
}

export const backendService = new BackendService();
