type Snapshot = any;

interface HistoryStack {
  undo: Snapshot[];
  redo: Snapshot[];
}

class UndoRedoModule {
  private stacks = new Map<string, HistoryStack>();
  private maxDepth = 50;

  register(key: string): void {
    if (!this.stacks.has(key)) {
      this.stacks.set(key, { undo: [], redo: [] });
    }
  }

  push(key: string, snapshot: Snapshot): void {
    const stack = this.stacks.get(key);
    if (!stack) return;
    stack.undo.push(this.clone(snapshot));
    if (stack.undo.length > this.maxDepth) stack.undo.shift();
    stack.redo = [];
  }

  undo(key: string, currentSnapshot: Snapshot): Snapshot | null {
    const stack = this.stacks.get(key);
    if (!stack || stack.undo.length === 0) return null;
    const previous = stack.undo.pop()!;
    stack.redo.push(this.clone(currentSnapshot));
    return previous;
  }

  redo(key: string, currentSnapshot: Snapshot): Snapshot | null {
    const stack = this.stacks.get(key);
    if (!stack || stack.redo.length === 0) return null;
    const next = stack.redo.pop()!;
    stack.undo.push(this.clone(currentSnapshot));
    return next;
  }

  canUndo(key: string): boolean {
    return (this.stacks.get(key)?.undo.length ?? 0) > 0;
  }

  canRedo(key: string): boolean {
    return (this.stacks.get(key)?.redo.length ?? 0) > 0;
  }

  clear(key: string): void {
    const stack = this.stacks.get(key);
    if (stack) {
      stack.undo = [];
      stack.redo = [];
    }
  }

  clearAll(): void {
    this.stacks.clear();
  }

  private clone(obj: any): any {
    if (obj === null || typeof obj !== "object") return obj;
    if (obj instanceof Uint8Array) return Uint8Array.from(obj);
    if (obj instanceof Uint16Array) return Uint16Array.from(obj);
    if (obj instanceof Uint32Array) return Uint32Array.from(obj);
    if (obj instanceof Int8Array) return Int8Array.from(obj);
    if (obj instanceof Int16Array) return Int16Array.from(obj);
    if (obj instanceof Float32Array) return Float32Array.from(obj);
    if (obj instanceof Float64Array) return Float64Array.from(obj);
    if (Array.isArray(obj)) return obj.map((item) => this.clone(item));
    const cloned: Record<string, any> = {};
    for (const key of Object.keys(obj)) {
      cloned[key] = this.clone(obj[key]);
    }
    return cloned;
  }
}

declare global {
  var UndoRedo: UndoRedoModule;
}

window.UndoRedo = new UndoRedoModule();
