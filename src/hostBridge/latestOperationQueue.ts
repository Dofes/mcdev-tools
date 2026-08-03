interface PendingLatestOperation {
    epoch: number;
    operation: () => Promise<void>;
    resolve: () => void;
    reject: (error: unknown) => void;
}

export class LatestOperationQueue {
    private readonly operations = new Map<string, Promise<unknown>>();
    private readonly pendingLatest = new Map<string, PendingLatestOperation>();
    private readonly latestDrains = new Map<string, Promise<void>>();
    private readonly epochs = new Map<string, number>();

    public run<T>(key: string, operation: () => Promise<T>): Promise<T> {
        const previous = this.operations.get(key) ?? Promise.resolve();
        const current = previous.catch(() => undefined).then(operation);
        this.operations.set(key, current);
        return current.finally(() => {
            if (this.operations.get(key) === current) {
                this.operations.delete(key);
            }
        });
    }

    public runLatest(key: string, operation: () => Promise<void>): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            this.discardPending(key);
            const epoch = this.epochs.get(key) ?? 0;
            this.pendingLatest.set(key, { epoch, operation, resolve, reject });
            this.startDrain(key);
        });
    }

    public invalidateLatest(key: string): void {
        this.epochs.set(key, (this.epochs.get(key) ?? 0) + 1);
        this.discardPending(key);
    }

    public keys(): Set<string> {
        return new Set([
            ...this.operations.keys(),
            ...this.pendingLatest.keys(),
            ...this.latestDrains.keys()
        ]);
    }

    private startDrain(key: string): void {
        if (this.latestDrains.has(key)) {
            return;
        }
        const epoch = this.epochs.get(key) ?? 0;
        const drain = this.run(key, async () => {
            while (true) {
                const pending = this.pendingLatest.get(key);
                if (!pending || pending.epoch !== epoch) {
                    return;
                }
                this.pendingLatest.delete(key);
                try {
                    await pending.operation();
                    pending.resolve();
                } catch (error) {
                    pending.reject(error);
                }
            }
        }).then(() => undefined);
        this.latestDrains.set(key, drain);
        void drain.finally(() => {
            if (this.latestDrains.get(key) === drain) {
                this.latestDrains.delete(key);
            }
            if (this.pendingLatest.has(key)) {
                this.startDrain(key);
            }
        });
    }

    private discardPending(key: string): void {
        const pending = this.pendingLatest.get(key);
        if (!pending) {
            return;
        }
        this.pendingLatest.delete(key);
        pending.resolve();
    }
}
