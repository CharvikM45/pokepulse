declare module "pg" {
  export class Client {
    constructor(config: Record<string, unknown>);
    connect(): Promise<void>;
    query(
      text: string,
      values?: unknown[],
    ): Promise<{ rows: Record<string, unknown>[] }>;
    end(): Promise<void>;
  }
}
