export function jsonResponse(status, data) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

export async function parseRequestJSON(request) {
  try {
    return await request.json();
  } catch (error) {
    return {};
  }
}
