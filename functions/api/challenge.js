export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    // 프론트에서 넘어온 JSON 받기
    const { day, start_at, end_at } = await request.json();

    // D1에 저장
    await env.DB_MAIN
      .prepare(
        "INSERT INTO challenge_periods (day, start_at, end_at) VALUES (?, ?, ?)"
      )
      .bind(day, start_at, end_at)
      .run();

    return new Response(
      JSON.stringify({ success: true, message: "챌린지 기간이 저장되었습니다." }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ success: false, message: error.message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}

// 👉 삭제 기능도 함께 넣고 싶다면 아래 추가
export async function onRequestDelete(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const id = url.searchParams.get("id"); // ?id=1 형태로 전달

  if (!id)
    return new Response(
      JSON.stringify({ success: false, message: "삭제할 ID가 없습니다." }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );

  try {
    await env.DB_MAIN
      .prepare("DELETE FROM challenge_periods WHERE id = ?")
      .bind(id)
      .run();

    return new Response(
      JSON.stringify({ success: true, message: "삭제되었습니다." }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ success: false, message: error.message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
