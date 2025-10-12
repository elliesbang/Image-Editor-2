const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
const AUTHORIZATION_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'

class OAuthError extends Error {
  constructor(message, status = 500, responseBody = '') {
    super(message)
    this.name = 'OAuthError'
    this.status = status
    this.response = responseBody
  }
}

class Google {
  constructor(clientId, clientSecret, redirectUri) {
    if (!clientId || !clientSecret || !redirectUri) {
      throw new Error('Google OAuth requires clientId, clientSecret, and redirectUri')
    }
    this.clientId = clientId
    this.clientSecret = clientSecret
    this.redirectUri = redirectUri
  }

  createAuthorizationURL(state, options = {}) {
    if (!state) {
      throw new Error('State parameter is required to create Google authorization URL')
    }

    const scopes = Array.isArray(options.scopes) && options.scopes.length > 0
      ? options.scopes
      : ['openid', 'email', 'profile']

    const url = new URL(AUTHORIZATION_ENDPOINT)
    url.searchParams.set('client_id', this.clientId)
    url.searchParams.set('redirect_uri', this.redirectUri)
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('scope', scopes.join(' '))
    url.searchParams.set('state', state)

    const accessType = options.accessType || 'offline'
    url.searchParams.set('access_type', accessType)

    if (options.prompt) {
      url.searchParams.set('prompt', options.prompt)
    }

    if (options.includeGrantedScopes) {
      url.searchParams.set('include_granted_scopes', options.includeGrantedScopes)
    }

    if (options.additionalParams && typeof options.additionalParams === 'object') {
      for (const [key, value] of Object.entries(options.additionalParams)) {
        if (typeof value === 'string') {
          url.searchParams.set(key, value)
        }
      }
    }

    return url
  }

  async validateAuthorizationCode(code) {
    if (!code) {
      throw new OAuthError('Authorization code is required', 400)
    }

    const body = new URLSearchParams({
      code,
      client_id: this.clientId,
      client_secret: this.clientSecret,
      redirect_uri: this.redirectUri,
      grant_type: 'authorization_code',
    })

    const response = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    })

    const text = await response.text()
    if (!response.ok) {
      throw new OAuthError('Failed to exchange authorization code', response.status, text)
    }

    let parsed
    try {
      parsed = JSON.parse(text)
    } catch (error) {
      throw new OAuthError('Invalid token response from Google', response.status, text)
    }

    const accessToken = typeof parsed.access_token === 'string' ? parsed.access_token : ''
    if (!accessToken) {
      throw new OAuthError('Missing access token in Google response', response.status, text)
    }

    return {
      accessToken,
      idToken: typeof parsed.id_token === 'string' ? parsed.id_token : undefined,
      refreshToken: typeof parsed.refresh_token === 'string' ? parsed.refresh_token : undefined,
      tokenType: typeof parsed.token_type === 'string' ? parsed.token_type : undefined,
      scope: typeof parsed.scope === 'string' ? parsed.scope : undefined,
      expiresIn: typeof parsed.expires_in === 'number' ? parsed.expires_in : undefined,
      raw: parsed,
    }
  }
}

export { Google, OAuthError }
