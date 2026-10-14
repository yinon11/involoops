declare module "oidc-provider" {
  import type { IncomingMessage, ServerResponse } from "node:http";

  export class Provider {
    constructor(issuer: string, configuration: Record<string, unknown>);
    proxy: boolean;
    callback(): (req: IncomingMessage, res: ServerResponse) => void;
    interactionDetails(req: unknown, res: unknown): Promise<{
      uid: string;
      grantId?: string;
      prompt: { name: string };
      params: Record<string, unknown>;
    }>;
    interactionFinished(
      req: unknown,
      res: unknown,
      result: Record<string, unknown>,
    ): Promise<void>;
    AccessToken: {
      find(token: string): Promise<
        | {
            accountId?: string;
            clientId?: string;
            scope?: string;
            exp?: number;
          }
        | undefined
      >;
    };
    Client: {
      find(id: string): Promise<{ clientName?: string } | undefined>;
    };
    Grant: {
      new (props: { accountId: string; clientId: string }): OauthGrant;
      find(id: string): Promise<OauthGrant | undefined>;
    };
  }

  export interface OauthGrant {
    accountId?: string;
    addOIDCScope(scope: string): void;
    addResourceScope(resource: string, scope: string): void;
    save(): Promise<string>;
  }

  export const errors: {
    InvalidTarget: new (description?: string) => Error;
  };
}
