const DEFAULT_BASE_URL = 'https://api.openai.com/v1'

class OpenAIResponseError extends Error {
  constructor(message, options = {}) {
    super(message)
    this.name = 'OpenAIResponseError'
    this.status = options.status ?? 500
    this.details = options.details
  }
}

function normalizeBaseUrl(url) {
  if (!url) return DEFAULT_BASE_URL
  return url.replace(/\/$/, '')
}

function buildOutputText(payload) {
  if (typeof payload?.output_text === 'string' && payload.output_text) {
    return payload.output_text
  }
  if (!Array.isArray(payload?.output)) {
    return ''
  }
  const segments = []
  for (const item of payload.output) {
    const contents = item?.content
    if (!Array.isArray(contents)) continue
    for (const content of contents) {
      if (typeof content?.text === 'string' && content.text) {
        segments.push(content.text)
      }
      if (Array.isArray(content?.annotations)) {
        for (const annotation of content.annotations) {
          if (typeof annotation?.text === 'string' && annotation.text) {
            segments.push(annotation.text)
          }
        }
      }
    }
  }
  return segments.join('').trim()
}

class OpenAI {
  constructor(options = {}) {
    const { apiKey, baseURL } = options
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY_REQUIRED')
    }
    this.apiKey = apiKey
    this.baseURL = normalizeBaseUrl(baseURL)
  }

  async #request(path, body) {
    const response = await fetch(`${this.baseURL}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    const text = await response.text()
    let payload = null
    try {
      payload = text ? JSON.parse(text) : null
    } catch (error) {
      throw new OpenAIResponseError('Invalid JSON response from OpenAI', {
        status: response.status,
        details: text,
      })
    }

    if (!response.ok) {
      const message = payload?.error?.message || `OpenAI request failed with status ${response.status}`
      throw new OpenAIResponseError(message, {
        status: response.status,
        details: payload,
      })
    }

    const outputText = buildOutputText(payload)
    if (outputText) {
      payload.output_text = outputText
    }
    return payload
  }

  get responses() {
    return {
      create: (body) => this.#request('/responses', body),
    }
  }
}

export default OpenAI
export { OpenAIResponseError }
