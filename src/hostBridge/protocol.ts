import { TextDecoder } from 'util';

export const HOST_BRIDGE_PROTOCOL_VERSION = 1;
export const HOST_BRIDGE_MAX_FRAME_BYTES = 16 * 1024 * 1024;
export const HOST_BRIDGE_MAX_IN_FLIGHT_REQUESTS = 64;
export const HOST_BRIDGE_HEARTBEAT_INTERVAL_MS = 10_000;

export type JsonRpcId = string | number;
export type JsonObject = Record<string, unknown>;

export class HostBridgeProtocolError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'HostBridgeProtocolError';
    }
}

export class HostBridgeFrameDecoder {
    private buffer = Buffer.alloc(0);
    private readonly decoder = new TextDecoder('utf-8', { fatal: true });

    constructor(private readonly maxFrameBytes = HOST_BRIDGE_MAX_FRAME_BYTES) {}

    public push(chunk: Buffer): JsonObject[] {
        if (chunk.length === 0) {
            return [];
        }

        this.buffer = this.buffer.length === 0
            ? Buffer.from(chunk)
            : Buffer.concat([this.buffer, chunk]);

        const messages: JsonObject[] = [];
        let offset = 0;

        while (this.buffer.length - offset >= 4) {
            const length = this.buffer.readUInt32BE(offset);
            if (length === 0 || length > this.maxFrameBytes) {
                throw new HostBridgeProtocolError(`Invalid Host Bridge frame length: ${length}`);
            }
            if (this.buffer.length - offset - 4 < length) {
                break;
            }

            const payload = this.buffer.subarray(offset + 4, offset + 4 + length);
            let decoded: string;
            try {
                decoded = this.decoder.decode(payload);
            } catch {
                throw new HostBridgeProtocolError('Host Bridge frame is not valid UTF-8');
            }

            let message: unknown;
            try {
                message = JSON.parse(decoded);
            } catch {
                throw new HostBridgeProtocolError('Host Bridge frame is not valid JSON');
            }
            if (!isJsonObject(message)) {
                throw new HostBridgeProtocolError('Host Bridge payload must be a JSON object');
            }

            messages.push(message);
            offset += 4 + length;
        }

        if (offset > 0) {
            this.buffer = Buffer.from(this.buffer.subarray(offset));
        }
        return messages;
    }

    public reset(): void {
        this.buffer = Buffer.alloc(0);
    }
}

export function encodeHostBridgeFrame(
    message: JsonObject,
    maxFrameBytes = HOST_BRIDGE_MAX_FRAME_BYTES
): Buffer {
    const payload = Buffer.from(JSON.stringify(message), 'utf8');
    if (payload.length === 0 || payload.length > maxFrameBytes) {
        throw new HostBridgeProtocolError(`Host Bridge payload is ${payload.length} bytes`);
    }
    const frame = Buffer.allocUnsafe(4 + payload.length);
    frame.writeUInt32BE(payload.length, 0);
    payload.copy(frame, 4);
    return frame;
}

export function isJsonObject(value: unknown): value is JsonObject {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isJsonRpcId(value: unknown): value is JsonRpcId {
    return (typeof value === 'string' && value.length > 0)
        || (typeof value === 'number' && Number.isSafeInteger(value));
}

export function rpcIdKey(id: JsonRpcId): string {
    return `${typeof id}:${String(id)}`;
}

export function getString(value: unknown): string | undefined {
    return typeof value === 'string' ? value : undefined;
}

export function getInteger(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isSafeInteger(value) ? value : undefined;
}

