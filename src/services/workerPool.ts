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
  private idleTimeout: number = 30000; // 30 seconds
  private workerTimers = new Map<Worker, NodeJS.Timeout>();

  constructor(maxWorkers: number = 15) {
    this.maxWorkers = maxWorkers;
    this.initializeWorkers();

    // Cleanup on page unload
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', () => this.terminate());
    }
  }

  private initializeWorkers() {
    // Start with a smaller number of workers and create more as needed
    const initialWorkers = Math.min(3, this.maxWorkers);
    for (let i = 0; i < initialWorkers; i++) {
      const worker = this.createWorker();
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

      // Schedule cleanup for idle worker
      this.scheduleWorkerCleanup(worker);

      // Process next task if any
      this.processNextTask();
    }
  }

  private scheduleWorkerCleanup(worker: Worker) {
    // Clear existing timer if any
    const existingTimer = this.workerTimers.get(worker);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Schedule new cleanup after idle timeout
    const timer = setTimeout(() => {
      this.cleanupIdleWorker(worker);
    }, this.idleTimeout);

    this.workerTimers.set(worker, timer);
  }

  private cleanupIdleWorker(worker: Worker) {
    // Only cleanup if worker is still idle
    const index = this.availableWorkers.indexOf(worker);
    if (index === -1) {
      // Worker is busy, don't cleanup
      return;
    }

    // Remove from available workers
    this.availableWorkers.splice(index, 1);

    // Remove from workers array
    const workerIndex = this.workers.indexOf(worker);
    if (workerIndex !== -1) {
      this.workers.splice(workerIndex, 1);
    }

    // Clear timer
    this.workerTimers.delete(worker);

    // Terminate the worker
    worker.terminate();

    console.log(`Terminated idle worker. Active workers: ${this.workers.length}/${this.maxWorkers}`);
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

    // Cancel cleanup timer for this worker
    const timer = this.workerTimers.get(worker);
    if (timer) {
      clearTimeout(timer);
      this.workerTimers.delete(worker);
    }

    this.activeRequests.set(task.id, task);
    worker.postMessage(task.message);
  }

  private createWorker(): Worker {
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

    return worker;
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

        // Cancel cleanup timer for this worker
        const timer = this.workerTimers.get(worker);
        if (timer) {
          clearTimeout(timer);
          this.workerTimers.delete(worker);
        }

        this.activeRequests.set(id, task);
        worker.postMessage(task.message);
      } else if (this.workers.length < this.maxWorkers) {
        // Create a new worker if we haven't reached the limit
        const worker = this.createWorker();
        this.workers.push(worker);
        this.activeRequests.set(id, task);
        worker.postMessage(task.message);
        console.log(`Created new worker. Active workers: ${this.workers.length}/${this.maxWorkers}`);
      } else {
        // Queue the task
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
    // Clear all timers
    this.workerTimers.forEach((timer) => clearTimeout(timer));
    this.workerTimers.clear();

    // Terminate all workers
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