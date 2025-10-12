const MAILCHANNELS_ENDPOINT = 'https://api.mailchannels.net/tx/v1/send'

function parseFromAddress(input) {
  if (!input) {
    return { name: 'Easy Image Editor', email: '' }
  }

  const match = input.match(/^(.*)<([^>]+)>\s*$/)
  if (match) {
    const name = match[1].trim().replace(/^"|"$/g, '')
    const email = match[2].trim()
    return { name: name || undefined, email }
  }

  return { name: undefined, email: input.trim() }
}

function buildEmailContent(code, expiresInMinutes) {
  return `안녕하세요, 엘리의방 이미지 에디터입니다.\n\n아래 인증코드를 로그인 화면에 입력해주세요.\n\n인증코드: ${code}\n유효시간: ${expiresInMinutes}분\n\n감사합니다.\n엘리의방 이미지 에디터 드림`
}

export async function sendLoginCodeEmail({ env, to, code, expiresInMinutes }) {
  const { SMTP_FROM } = env

  if (!SMTP_FROM) {
    throw new Error('SMTP_FROM_NOT_CONFIGURED')
  }

  const from = parseFromAddress(SMTP_FROM)
  if (!from.email) {
    throw new Error('SMTP_FROM_INVALID')
  }

  const subject = '[엘리의방 이미지 에디터] 로그인 인증코드'
  const content = buildEmailContent(code, expiresInMinutes)

  const requestBody = {
    personalizations: [
      {
        to: [{ email: to }],
      },
    ],
    from: {
      email: from.email,
      name: from.name,
    },
    subject,
    content: [
      {
        type: 'text/plain; charset=UTF-8',
        value: content,
      },
    ],
  }

  const response = await fetch(MAILCHANNELS_ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`MAILCHANNELS_DELIVERY_FAILED:${response.status}:${text}`)
  }
}
