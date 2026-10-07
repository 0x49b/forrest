import type { DependencyNode, PackageJson } from '../types';

export interface AnalyzeConfig {
  includeDevDependencies: boolean;
  maxDepth: number;
}

export interface AnalyzeResponse {
  sessionId: string;
  streamUrl: string;
}

export interface CompleteEvent {
  totalProcessed: number;
  duration: string;
}

export interface PackageErrorEvent {
  package: string;
  error: string;
}

async function errorMessage(response: Response): Promise<string> {
  const body = await response.json().catch(() => null);
  return body?.error || response.statusText;
}

export class BackendService {
  constructor(private baseUrl: string = '/api') {}

  async startAnalysis(packageJson: PackageJson, config: AnalyzeConfig): Promise<AnalyzeResponse> {
    const response = await fetch(`${this.baseUrl}/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ packageJson, ...config }),
    });

    if (!response.ok) {
      throw new Error(`Analysis failed: ${await errorMessage(response)}`);
    }
    return response.json();
  }

  createEventSource(sessionId: string): EventSource {
    return new EventSource(`${this.baseUrl}/events/${sessionId}`);
  }

  async fetchPackage(name: string, version: string): Promise<DependencyNode> {
    const params = new URLSearchParams({ name, version });
    const response = await fetch(`${this.baseUrl}/package?${params}`);
    if (!response.ok) {
      throw new Error(await errorMessage(response));
    }
    return response.json();
  }
}

export const backendService = new BackendService();
