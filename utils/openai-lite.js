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

const resolveFileName = (value, fallback) => {
  if (!value || typeof value !== 'object') {
    return fallback
  }
  if (typeof value.name === 'string' && value.name.trim()) {
    return value.name.trim()
  }
  return fallback
}

class OpenAI {
  constructor(options = {}) {
    const { apiKey, baseURL, organization } = options
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY_REQUIRED')
    }
    this.apiKey = apiKey
    this.baseURL = normalizeBaseUrl(baseURL)
    this.organization = organization ?? null
  }

  #buildAuthHeaders() {
    const headers = {
      Authorization: `Bearer ${this.apiKey}`,
    }
    if (this.organization) {
      headers['OpenAI-Organization'] = this.organization
    }
    return headers
  }

  async #request(path, body) {
    const response = await fetch(`${this.baseURL}${path}`, {
      method: 'POST',
      headers: {
        ...this.#buildAuthHeaders(),
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

  async #multipartRequest(path, formData) {
    const response = await fetch(`${this.baseURL}${path}`, {
      method: 'POST',
      headers: {
        ...this.#buildAuthHeaders(),
      },
      body: formData,
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

    return payload
  }

  get responses() {
    return {
      create: (body) => this.#request('/responses', body),
    }
  }

  get images() {
    return {
      edit: async (options = {}) => {
        const { image, mask, prompt, size, model, response_format: responseFormat, user } = options
        if (!image) {
          throw new Error('OPENAI_IMAGE_REQUIRED')
        }

        const form = new FormData()
        form.append('image', image, resolveFileName(image, 'image.png'))

        if (mask instanceof Blob) {
          form.append('mask', mask, resolveFileName(mask, 'mask.png'))
        }

        if (typeof prompt === 'string' && prompt.trim()) {
          form.append('prompt', prompt.trim())
        }

        if (typeof size === 'string' && size.trim()) {
          form.append('size', size.trim())
        }

        if (typeof model === 'string' && model.trim()) {
          form.append('model', model.trim())
        }

        if (typeof responseFormat === 'string' && responseFormat.trim()) {
          form.append('response_format', responseFormat.trim())
        }

        if (typeof user === 'string' && user.trim()) {
          form.append('user', user.trim())
        }

        return this.#multipartRequest('/images/edits', form)
      },
    }
  }
}

export default OpenAI
export { OpenAIResponseError }
