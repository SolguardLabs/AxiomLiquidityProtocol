export type EventName =
    | "account.registered"
    | "vault.deposit"
    | "vault.withdraw"
    | "vault.share-transfer"
    | "strategy.created"
    | "strategy.range-added"
    | "strategy.allocated"
    | "strategy.recalled"
    | "strategy.reported"
    | "strategy.value-adjusted"
    | "fees.crystallized"
    | "pool.created"
    | "pool.position-opened"
    | "pool.position-increased"
    | "pool.position-reduced"
    | "pool.fees-accrued"
    | "pool.loss-recorded"
    | "pool.market-updated"
    | "risk.limit-updated";

export interface EventRecord<TPayload extends Record<string, unknown> = Record<string, unknown>> {
    readonly id: number;
    readonly name: EventName;
    readonly timestamp: number;
    readonly payload: TPayload;
}

export interface EventFilter {
    readonly name?: EventName;
    readonly fromId?: number;
    readonly toId?: number;
}

export class EventLog {
    #nextId = 1;
    #records: EventRecord[] = [];

    emit<TPayload extends Record<string, unknown>>(
        name: EventName,
        payload: TPayload,
        timestamp = Date.now(),
    ): EventRecord<TPayload> {
        const record = {
            id: this.#nextId,
            name,
            timestamp,
            payload,
        } satisfies EventRecord<TPayload>;
        this.#nextId += 1;
        this.#records.push(record);
        return record;
    }

    all(): readonly EventRecord[] {
        return this.#records.slice();
    }

    query(filter: EventFilter): readonly EventRecord[] {
        return this.#records.filter((record) => {
            if (filter.name !== undefined && record.name !== filter.name) {
                return false;
            }
            if (filter.fromId !== undefined && record.id < filter.fromId) {
                return false;
            }
            if (filter.toId !== undefined && record.id > filter.toId) {
                return false;
            }
            return true;
        });
    }

    latest(name?: EventName): EventRecord | undefined {
        for (let i = this.#records.length - 1; i >= 0; i -= 1) {
            const record = this.#records[i];
            if (name === undefined || record.name === name) {
                return record;
            }
        }
        return undefined;
    }

    count(name?: EventName): number {
        if (name === undefined) {
            return this.#records.length;
        }
        return this.#records.filter((record) => record.name === name).length;
    }

    checkpoint(): number {
        return this.#nextId;
    }

    since(checkpoint: number): readonly EventRecord[] {
        return this.#records.filter((record) => record.id >= checkpoint);
    }

    clear(): void {
        this.#records = [];
        this.#nextId = 1;
    }
}
