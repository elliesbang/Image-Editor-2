export async function onRequestPost(context) {
  try {
    const { email } = await context.request.json();
    if (!email) return new Response("Missing email", { status: 400 });

    const tokenRes = await fetch("https://api.imweb.me/v2/auth/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: context.env.IMWEB_CLIENT_ID,
        client_secret: context.env.IMWEB_CLIENT_SECRET
      }),
    });

    if (!tokenRes.ok) {
      console.error("❌ 토큰 발급 실패:", await tokenRes.text());
      return new Response("Token fetch failed", { status: 500 });
    }

    const tokenData = await tokenRes.json();
    const accessToken = tokenData?.data?.access_token;

    if (!accessToken) {
      console.error("❌ Access Token 누락");
      return new Response("Access Token missing", { status: 500 });
    }

    const orderRes = await fetch("https://api.imweb.me/v2/orders?status=paid", {
      headers: { "Authorization": `Bearer ${accessToken}` },
    });

    if (!orderRes.ok) {
      console.error("❌ 주문 조회 실패:", await orderRes.text());
      return new Response("Order fetch failed", { status: 500 });
    }

    const data = await orderRes.json();
    const orders = data.data || data.orders || [];

    const matchedOrder = orders.find(order =>
      order.buyer?.email?.trim().toLowerCase() === email.trim().toLowerCase() &&
      order.order_name?.includes("미치나")
    );

    if (!matchedOrder) {
      console.log(`🚫 ${email} 미치나 결제내역 없음`);
      return new Response(JSON.stringify({ success: false, message: "미치나 결제 내역이 없습니다." }), { status: 403 });
    }

    await context.env.elliesbang_main.prepare(`
      INSERT INTO users (email, grade, order_id, order_date)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(email) DO UPDATE SET grade = excluded.grade, order_id = excluded.order_id, order_date = excluded.order_date
    `).bind(
      email,
      "michina",
      matchedOrder.order_id,
      matchedOrder.order_date
    ).run();

    console.log(`✅ ${email} → 미치나 로그인 성공`);
    return new Response(JSON.stringify({ success: true, grade: "michina" }), { status: 200 });

  } catch (err) {
    console.error("🔥 Michina login error:", err);
    return new Response("Internal Server Error", { status: 500 });
  }
}
