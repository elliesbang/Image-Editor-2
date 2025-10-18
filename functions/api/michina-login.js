const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

function normalizeName(input) {
  if (typeof input !== "string") {
    return "";
  }
  return input.trim().replace(/\s+/g, " ");
}

function resolveOrderList(payload) {
  if (!payload || typeof payload !== "object") {
    return [];
  }

  if (Array.isArray(payload.orders)) {
    return payload.orders;
  }

  if (payload.data) {
    if (Array.isArray(payload.data.orders)) {
      return payload.data.orders;
    }
    if (Array.isArray(payload.data)) {
      return payload.data;
    }
  }

  return [];
}

function extractOrdererName(order) {
  if (!order || typeof order !== "object") {
    return "";
  }
  if (typeof order.orderer_name === "string") {
    return normalizeName(order.orderer_name);
  }
  if (order.buyer && typeof order.buyer.name === "string") {
    return normalizeName(order.buyer.name);
  }
  return "";
}

function extractOrdererEmail(order) {
  if (!order || typeof order !== "object") {
    return "";
  }
  if (typeof order.orderer_email === "string") {
    return order.orderer_email.trim().toLowerCase();
  }
  if (order.buyer && typeof order.buyer.email === "string") {
    return order.buyer.email.trim().toLowerCase();
  }
  return "";
}

function extractOrderId(order) {
  if (!order || typeof order !== "object") {
    return undefined;
  }
  return (
    order.order_id ||
    order.order_no ||
    order.id ||
    order.uid ||
    undefined
  );
}

function extractOrderDate(order) {
  if (!order || typeof order !== "object") {
    return undefined;
  }
  return (
    order.order_date ||
    order.payment_date ||
    order.created_at ||
    undefined
  );
}

function createSessionCookie(payload) {
  const encoded = encodeURIComponent(JSON.stringify(payload));
  const maxAge = 60 * 60 * 24 * 7;
  return `michina_session=${encoded}; Max-Age=${maxAge}; Path=/; HttpOnly; SameSite=Lax; Secure`;
}

export async function onRequestPost(context) {
  let body;
  try {
    body = await context.request.json();
  } catch (error) {
    console.error("[michina] Failed to parse request body", error);
    return new Response(
      JSON.stringify({ success: false, message: "잘못된 요청입니다." }),
      { status: 400, headers: JSON_HEADERS }
    );
  }

  const normalizedName = normalizeName(body?.name);
  if (!normalizedName) {
    return new Response(
      JSON.stringify({ success: false, message: "구매자 이름을 입력해주세요." }),
      { status: 400, headers: JSON_HEADERS }
    );
  }

  const { IMWEB_API_KEY, elliesbang_main: db } = context.env;
  if (!IMWEB_API_KEY) {
    console.error("[michina] IMWEB_API_KEY is not configured");
    return new Response(
      JSON.stringify({ success: false, message: "서버 오류" }),
      { status: 500, headers: JSON_HEADERS }
    );
  }

  if (!db) {
    console.error("[michina] D1 database binding 'elliesbang_main' is missing");
    return new Response(
      JSON.stringify({ success: false, message: "서버 오류" }),
      { status: 500, headers: JSON_HEADERS }
    );
  }

  const query = `?orderer_name=${encodeURIComponent(normalizedName)}`;
  const requestUrl = `https://api.imweb.me/v2/orders${query}`;

  let orderRes;
  try {
    orderRes = await fetch(requestUrl, {
      headers: {
        Authorization: IMWEB_API_KEY,
      },
    });
  } catch (error) {
    console.error("[michina] Failed to request Imweb orders", error);
    return new Response(
      JSON.stringify({ success: false, message: "서버 오류" }),
      { status: 502, headers: JSON_HEADERS }
    );
  }

  if (!orderRes.ok) {
    const errorText = await orderRes.text().catch(() => "");
    console.error(
      "[michina] Imweb order API responded with an error",
      orderRes.status,
      errorText
    );
    return new Response(
      JSON.stringify({ success: false, message: "서버 오류" }),
      { status: 502, headers: JSON_HEADERS }
    );
  }

  let orderPayload;
  try {
    orderPayload = await orderRes.json();
  } catch (error) {
    console.error("[michina] Failed to parse Imweb order response", error);
    return new Response(
      JSON.stringify({ success: false, message: "서버 오류" }),
      { status: 502, headers: JSON_HEADERS }
    );
  }

  const orders = resolveOrderList(orderPayload);
  if (!Array.isArray(orders) || orders.length === 0) {
    return new Response(
      JSON.stringify({ success: false, message: "구매 내역을 찾을 수 없습니다." }),
      { status: 404, headers: JSON_HEADERS }
    );
  }

  const matchedOrder = orders.find((order) => extractOrdererName(order).toLowerCase() === normalizedName.toLowerCase());

  if (!matchedOrder) {
    console.log(`🚫 ${normalizedName} 미치나 결제내역 없음`);
    return new Response(
      JSON.stringify({ success: false, message: "구매 내역을 찾을 수 없습니다." }),
      { status: 404, headers: JSON_HEADERS }
    );
  }

  const buyerEmail = extractOrdererEmail(matchedOrder);

  if (buyerEmail) {
    try {
      await db
        .prepare(`
        INSERT INTO users (email, grade, order_id, order_date)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(email) DO UPDATE SET grade = excluded.grade, order_id = excluded.order_id, order_date = excluded.order_date
      `)
        .bind(
          buyerEmail,
          "michina",
          extractOrderId(matchedOrder),
          extractOrderDate(matchedOrder)
        )
        .run();
    } catch (error) {
      console.error("[michina] Failed to persist user record", error);
    }
  }

  const sessionPayload = {
    grade: "michina",
    name: extractOrdererName(matchedOrder) || normalizedName,
    email: buyerEmail || null,
    issuedAt: Date.now(),
  };

  console.log(`✅ ${normalizedName} → 미치나 로그인 성공`);

  return new Response(
    JSON.stringify({
      success: true,
      grade: "michina",
      name: sessionPayload.name,
      email: buyerEmail,
    }),
    {
      status: 200,
      headers: {
        ...JSON_HEADERS,
        "set-cookie": createSessionCookie(sessionPayload),
      },
    }
  );
}
