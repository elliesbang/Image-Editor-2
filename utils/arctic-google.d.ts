export type GoogleTokenResponse = {
  accessToken: string
  idToken?: string
  refreshToken?: string
  tokenType?: string
  scope?: string
  expiresIn?: number
  raw: Record<string, unknown>
}

export declare class OAuthError extends Error {
  status: number
  response?: string
  constructor(message: string, status?: number, responseBody?: string)
}

export type AuthorizationUrlOptions = {
  scopes?: string[]
  accessType?: 'online' | 'offline'
  prompt?: string
  includeGrantedScopes?: 'true' | 'false'
  additionalParams?: Record<string, string>
}

export declare class Google {
  constructor(clientId: string, clientSecret: string, redirectUri: string)
  createAuthorizationURL(state: string, options?: AuthorizationUrlOptions): URL
  validateAuthorizationCode(code: string): Promise<GoogleTokenResponse>
}
