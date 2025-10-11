import type { Context, MiddlewareHandler } from 'hono'

type GoogleAuthBaseOptions = {
  clientId: string | ((c: Context) => string | undefined)
  redirectUri: string | ((c: Context) => string | undefined)
  scope?: string | string[]
  accessType?: 'online' | 'offline'
  prompt?: string
  includeGrantedScopes?: boolean
  responseType?: 'code' | 'token'
}

type GoogleAuthAuthorizeOptions = {
  state?: string
  loginHint?: string
  hd?: string
  extraParams?: Record<string, string | undefined>
}

type GoogleAuthHandler = MiddlewareHandler

function resolveDynamic<T>(value: T | ((c: Context) => T | undefined), c: Context): T | undefined {
  if (typeof value === 'function') {
    return (value as (c: Context) => T | undefined)(c)
  }
  return value
}

export function createGoogleAuthorizationUrl(
  base: GoogleAuthBaseOptions,
  c: Context,
  overrides: GoogleAuthAuthorizeOptions = {}
) {
  const clientId = resolveDynamic(base.clientId, c)?.trim()
  const redirectUri = resolveDynamic(base.redirectUri, c)?.trim()

  if (!clientId || !redirectUri) {
    throw new Error('Google OAuth client configuration is missing')
  }

  const params = new URLSearchParams()
  params.set('client_id', clientId)
  params.set('redirect_uri', redirectUri)
  params.set('response_type', base.responseType ?? 'code')

  const scopes = Array.isArray(base.scope) ? base.scope : base.scope?.split(/\s+/).filter(Boolean)
  const scopeList = scopes && scopes.length > 0 ? scopes : ['openid', 'email', 'profile']
  params.set('scope', scopeList.join(' '))

  if (base.accessType) {
    params.set('access_type', base.accessType)
  }

  if (base.prompt) {
    params.set('prompt', base.prompt)
  }

  if (base.includeGrantedScopes) {
    params.set('include_granted_scopes', 'true')
  }

  if (overrides.state) {
    params.set('state', overrides.state)
  }

  if (overrides.loginHint) {
    params.set('login_hint', overrides.loginHint)
  }

  if (overrides.hd) {
    params.set('hd', overrides.hd)
  }

  if (overrides.extraParams) {
    for (const [key, value] of Object.entries(overrides.extraParams)) {
      if (typeof value === 'string' && value.length > 0) {
        params.set(key, value)
      }
    }
  }

  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
}

export function googleAuth(base: GoogleAuthBaseOptions, authorizeOverrides: GoogleAuthAuthorizeOptions = {}): GoogleAuthHandler {
  return (c) => {
    const url = createGoogleAuthorizationUrl(base, c, authorizeOverrides)
    return c.redirect(url, 302)
  }
}

export type { GoogleAuthAuthorizeOptions, GoogleAuthBaseOptions, GoogleAuthHandler }
