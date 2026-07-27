export type DisposableModel = { dispose: () => void };

type ModelEntry<T extends DisposableModel> = {
  model: T;
  references: number;
};

/** One model per stable resource, with disposal after the last pane closes. */
export class SourceModelRegistry<T extends DisposableModel> {
  private readonly models = new Map<string, ModelEntry<T>>();

  acquire(resourceId: string, create: () => T): T {
    const existing = this.models.get(resourceId);
    if (existing) {
      existing.references += 1;
      return existing.model;
    }
    const model = create();
    this.models.set(resourceId, { model, references: 1 });
    return model;
  }

  release(resourceId: string): void {
    const entry = this.models.get(resourceId);
    if (!entry) return;
    entry.references -= 1;
    if (entry.references <= 0) {
      entry.model.dispose();
      this.models.delete(resourceId);
    }
  }

  get(resourceId: string): T | undefined {
    return this.models.get(resourceId)?.model;
  }

  get size(): number {
    return this.models.size;
  }
}
