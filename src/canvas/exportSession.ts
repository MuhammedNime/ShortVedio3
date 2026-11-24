export type ExportSessionState =
  | 'idle'
  | 'preparing'
  | 'rendering'
  | 'finalizing'
  | 'saving'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface ExportSessionSnapshot {
  sessionId: string | null;
  projectId: string | null;
  state: ExportSessionState;
  progress: number;
  elapsedMs: number;
  estimatedRemainingMs: number | null;
  engineLabel: string;
  statusText: string;
  fallbackNotice: string | null;
  errorMessage: string | null;
}

export function isExportSessionActive(state: ExportSessionState): boolean {
  return (
    state === 'preparing' ||
    state === 'rendering' ||
    state === 'finalizing' ||
    state === 'saving'
  );
}

export function estimateRemainingMs(
  elapsedMs: number,
  progressRatio: number,
  state: ExportSessionState
): number | null {
  if (state === 'completed' || state === 'failed' || state === 'cancelled' || state === 'idle') {
    return null;
  }
  if (state === 'preparing') {
    return null;
  }
  if (state === 'finalizing' || state === 'saving') {
    return 1500;
  }
  const clamped = Math.max(0, Math.min(0.995, progressRatio));
  if (clamped < 0.06 || elapsedMs < 900) {
    return null;
  }
  const totalEstimatedMs = elapsedMs / clamped;
  const remaining = Math.max(0, totalEstimatedMs - elapsedMs);
  return Number.isFinite(remaining) ? remaining : null;
}

export function formatDurationCompact(ms: number): string {
  const totalSec = Math.max(0, Math.round(ms / 1000));
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  if (mins === 0) {
    return `${secs} ث`;
  }
  return `${mins}:${secs.toString().padStart(2, '0')} د`;
}

export interface ManagedExportSession {
  sessionId: string;
  projectId: string;
  controller: AbortController;
  startedAt: number;
  registerCleanup: (fn: () => void) => void;
  cleanup: () => void;
  isCurrent: () => boolean;
}

class ExportSessionManager {
  private activeByProject = new Map<string, ManagedExportSession>();
  private seq = 0;

  public hasActiveSession(projectId: string): boolean {
    return this.activeByProject.has(projectId);
  }

  public beginSession(projectId: string): ManagedExportSession {
    const existing = this.activeByProject.get(projectId);
    if (existing) {
      try {
        existing.controller.abort();
      } catch {
        // ignore
      }
      existing.cleanup();
      this.activeByProject.delete(projectId);
    }

    this.seq += 1;
    const sessionId = `exp_${Date.now()}_${this.seq}`;
    const controller = new AbortController();
    const cleanups: Array<() => void> = [];
    let cleaned = false;

    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      for (let i = cleanups.length - 1; i >= 0; i--) {
        try {
          cleanups[i]();
        } catch {
          // ignore individual cleanup errors
        }
      }
      cleanups.length = 0;
    };

    const session: ManagedExportSession = {
      sessionId,
      projectId,
      controller,
      startedAt: performance.now(),
      registerCleanup: (fn) => {
        if (cleaned) {
          try {
            fn();
          } catch {
            // ignore
          }
          return;
        }
        cleanups.push(fn);
      },
      cleanup,
      isCurrent: () => this.activeByProject.get(projectId)?.sessionId === sessionId,
    };

    controller.signal.addEventListener(
      'abort',
      () => {
        cleanup();
      },
      { once: true }
    );

    this.activeByProject.set(projectId, session);
    return session;
  }

  public cancelSession(projectId: string, sessionId?: string | null): boolean {
    const existing = this.activeByProject.get(projectId);
    if (!existing) return false;
    if (sessionId && existing.sessionId !== sessionId) return false;

    try {
      existing.controller.abort();
    } catch {
      // ignore
    }
    existing.cleanup();
    this.activeByProject.delete(projectId);
    return true;
  }

  public finishSession(projectId: string, sessionId: string): void {
    const existing = this.activeByProject.get(projectId);
    if (!existing || existing.sessionId !== sessionId) return;
    existing.cleanup();
    this.activeByProject.delete(projectId);
  }
}

export const exportSessionManager = new ExportSessionManager();
