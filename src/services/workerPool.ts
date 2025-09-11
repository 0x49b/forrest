import { WorkerMessage, WorkerResponse } from '../workers/dependencyWorker';

export interface WorkerTask {
  id: string;
  message: WorkerMessage;
  resolve: (value: any) => void;
  reject: (error: any) => void;
}

export class WorkerPool {
  private workers: Worker[] = [];
  private availableWorkers: Worker[] = [];
  private taskQueue: WorkerTask[] = [];
  private activeRequests = new Map<string, WorkerTask>();
  private maxWorkers: number;

  constructor(maxWorkers: number = 10) {
    this.maxWorkers = maxWorkers;
    this.initializeWorkers();
  }

  private initializeWorkers() {
    for (let i = 0; i < this.maxWorkers; i++) {
      const worker = new Worker(
        new URL('../workers/dependencyWorker.ts', import.meta.url),
        { type: 'module' }
      );
      
      worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        this.handleWorkerMessage(worker, event.data);
      };

      worker.onerror = (error) => {
        console.error('Worker error:', error);
        this.handleWorkerError(worker, error);
      };

      this.workers.push(worker);
      this.availableWorkers.push(worker);
    }
  }

  private handleWorkerMessage(worker: Worker, response: WorkerResponse) {
    const task = this.activeRequests.get(response.id);
    if (task) {
      this.activeRequests.delete(response.id);
      
      if (response.type === 'FETCH_SUCCESS') {
        task.resolve(response.payload);
      } else {
        task.reject(response.payload);
      }
      
      // Return worker to available pool
      this.availableWorkers.push(worker);
      
      // Process next task if any
      this.processNextTask();
    }
  }

  private handleWorkerError(worker: Worker, error: ErrorEvent) {
    // Find and reject all tasks assigned to this worker
    for (const [id, task] of this.activeRequests.entries()) {
      task.reject(new Error(`Worker error: ${error.message}`));
      this.activeRequests.delete(id);
    }
    
    // Return worker to available pool (it might still be usable)
    if (!this.availableWorkers.includes(worker)) {
      this.availableWorkers.push(worker);
    }
    
    this.processNextTask();
  }

  private processNextTask() {
    if (this.taskQueue.length === 0 || this.availableWorkers.length === 0) {
      return;
    }

    const task = this.taskQueue.shift()!;
    const worker = this.availableWorkers.shift()!;

    this.activeRequests.set(task.id, task);
    worker.postMessage(task.message);
  }

  public async fetchDependency(
    packageName: string, 
    version: string, 
    showDevDeps: boolean
  ): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = `${packageName}-${version}-${Date.now()}-${Math.random()}`;
      
      const task: WorkerTask = {
        id,
        message: {
          id,
          type: 'FETCH_DEPENDENCY',
          payload: { packageName, version, showDevDeps }
        },
        resolve,
        reject
      };

      if (this.availableWorkers.length > 0) {
        const worker = this.availableWorkers.shift()!;
        this.activeRequests.set(id, task);
        worker.postMessage(task.message);
      } else {
        this.taskQueue.push(task);
      }
    });
  }

  public getStats() {
    return {
      totalWorkers: this.workers.length,
      availableWorkers: this.availableWorkers.length,
      activeRequests: this.activeRequests.size,
      queuedTasks: this.taskQueue.length
    };
  }

  public terminate() {
    this.workers.forEach(worker => worker.terminate());
    this.workers = [];
    this.availableWorkers = [];
    this.taskQueue = [];
    this.activeRequests.clear();
  }
}

// Create singleton instance
const maxWorkers = parseInt(import.meta.env.VITE_FETCHING_WORKERS || '10', 10);
export const workerPool = new WorkerPool(maxWorkers);