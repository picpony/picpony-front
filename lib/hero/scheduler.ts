'use client';

type FrameTask<T> = {
  read: () => T;
  write: (value: T) => void;
};

type PendingFrameTask = {
  read: () => unknown;
  write: (value: unknown) => void;
};

const READ_FAILED = Symbol('image-hero-frame-read-failed');

/**
 * Single rAF pass shared by every Hero subsystem, with all reads batched before
 * all writes. One flush per frame means a gesture, a size sync and a scroll
 * residual cannot interleave read-write-read and force repeated layout.
 */
class HeroFrameScheduler {
  private pending = new Map<object, PendingFrameTask>();
  private frame = 0;
  private afterFrame = new Set<() => void>();

  /** One task per owner; a re-request within the same frame replaces it. */
  request<T>(owner: object, task: FrameTask<T>) {
    this.pending.set(owner, task as PendingFrameTask);
    if (!this.frame) this.frame = requestAnimationFrame(this.flush);
  }

  cancel(owner: object) {
    this.pending.delete(owner);
  }

  settled() {
    if (!this.frame && this.pending.size === 0) return Promise.resolve();
    return new Promise<void>((resolve) => {
      this.afterFrame.add(resolve);
    });
  }

  dispose() {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.pending.clear();
    this.releaseWaiters();
  }

  private releaseWaiters() {
    const waiters = [...this.afterFrame];
    this.afterFrame.clear();
    waiters.forEach((resolve) => {
      try {
        resolve();
      } catch {
        // One stale observer must never strand another waiter.
      }
    });
  }

  private flush = () => {
    this.frame = 0;
    const tasks = [...this.pending.values()];
    this.pending.clear();
    const values = new Array<unknown>(tasks.length);

    for (let index = 0; index < tasks.length; index += 1) {
      try {
        values[index] = tasks[index].read();
      } catch {
        // A disconnected node must not strand unrelated work behind a throw.
        values[index] = READ_FAILED;
      }
    }
    for (let index = 0; index < tasks.length; index += 1) {
      if (values[index] === READ_FAILED) continue;
      try {
        tasks[index].write(values[index]);
      } catch {
        // Writes are best-effort: the owner either reschedules or is disposed
        // by its session. Waiters must always be released.
      }
    }

    if (this.pending.size > 0 && !this.frame) {
      this.frame = requestAnimationFrame(this.flush);
      return;
    }
    this.releaseWaiters();
  };
}

export const heroFrameScheduler = new HeroFrameScheduler();
