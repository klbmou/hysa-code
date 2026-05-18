import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { Task, AgentMode } from './types.js';

const TASKS_DIR = join(homedir(), '.hysa');
const TASKS_PATH = join(TASKS_DIR, 'tasks.json');

function ensureDir(): void {
  if (!existsSync(TASKS_DIR)) mkdirSync(TASKS_DIR, { recursive: true });
}

export function loadTasks(): Task[] {
  try {
    if (!existsSync(TASKS_PATH)) return [];
    const data = readFileSync(TASKS_PATH, 'utf-8');
    return JSON.parse(data) as Task[];
  } catch {
    return [];
  }
}

export function saveTasks(tasks: Task[]): void {
  ensureDir();
  writeFileSync(TASKS_PATH, JSON.stringify(tasks, null, 2), 'utf-8');
}

export function createTask(description: string, mode: AgentMode): Task {
  const task: Task = {
    id: Date.now().toString(36),
    description,
    status: 'in_progress',
    steps: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    mode,
  };
  const tasks = loadTasks();
  tasks.unshift(task);
  saveTasks(tasks);
  return task;
}

export function updateTask(id: string, updates: Partial<Task>): void {
  const tasks = loadTasks();
  const idx = tasks.findIndex(t => t.id === id);
  if (idx !== -1) {
    tasks[idx] = { ...tasks[idx], ...updates, updatedAt: new Date().toISOString() };
    saveTasks(tasks);
  }
}

export function getActiveTask(): Task | null {
  const tasks = loadTasks();
  return tasks.find(t => t.status === 'in_progress') || null;
}

export function showTaskStatus(task: Task): string {
  const stepCount = task.steps.length;
  const doneCount = task.steps.filter(s => s.status === 'completed').length;
  return `[${task.status}] ${task.description} (${doneCount}/${stepCount} steps)`;
}
