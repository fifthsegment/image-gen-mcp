import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  JSONRPCMessage,
  JSONRPCNotification,
  JSONRPCResponse,
  JSONRPCError,
  JSONRPCRequest,
  ListToolsResult,
  isJSONRPCResponse,
  isJSONRPCError,
} from "@modelcontextprotocol/sdk/types.js";

type RPCResponse = JSONRPCResponse | JSONRPCError | JSONRPCNotification;

class TestTransport implements Transport {
  private receiverCb: (message: JSONRPCMessage) => void;

  constructor(receiverCb: (message: JSONRPCMessage) => void) {
    this.receiverCb = receiverCb;
  }

  async send(message: JSONRPCMessage): Promise<void> {
    this.receiverCb(message);
  }

  async start(): Promise<void> {}

  async close(): Promise<void> {}

  onmessage?: (message: JSONRPCMessage) => void;
  onerror?: (error: Error) => void;
  onclose?: () => void;
}

export interface TestClient {
  listTools: () => Promise<ListToolsResult>;
  callTool: (toolName: string, args?: Record<string, unknown>) => Promise<{
    content: Array<{ type: string; text: string }>;
    isError?: boolean;
  }>;
  close: () => Promise<void>;
}

export async function connectTestClient(server: Server): Promise<TestClient> {
  let resolveResponse: ((value: RPCResponse) => void) | null = null;
  let requestId = 1;

  const transport = new TestTransport((message: JSONRPCMessage) => {
    if (resolveResponse && (isJSONRPCResponse(message) || isJSONRPCError(message))) {
      resolveResponse(message as RPCResponse);
      resolveResponse = null;
    }
  });

  await server.connect(transport);

  async function sendRequest<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const id = requestId++;
    const request: JSONRPCRequest = {
      jsonrpc: "2.0",
      id,
      method,
      params,
    };

    const responsePromise = new Promise<RPCResponse>((resolve) => {
      resolveResponse = resolve;
    });

    transport.onmessage?.(request);

    const response = await responsePromise;

    if (isJSONRPCError(response)) {
      throw new Error(`RPC Error: ${JSON.stringify(response.error)}`);
    }

    return (response as JSONRPCResponse).result as T;
  }

  return {
    listTools: async () => {
      return sendRequest<ListToolsResult>("tools/list", {});
    },

    callTool: async (toolName: string, args: Record<string, unknown> = {}) => {
      return sendRequest("tools/call", {
        name: toolName,
        arguments: args,
      });
    },

    close: async () => {
      await server.close();
    },
  };
}
