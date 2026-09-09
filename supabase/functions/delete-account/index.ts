// Edge Function: 회원탈퇴(계정 완전 삭제)
// auth.users 행을 지우면 public.users(on delete cascade)와 그 아래 모든 데이터
// (routines/slots/presets/favorites/diaries/date_memos/videos/categories 등)가
// 전부 함께 삭제된다. 단, routine-photos 스토리지 파일은 DB cascade 대상이 아니라
// 별도로 지워줘야 한다.
// 서비스 역할 키(SUPABASE_SERVICE_ROLE_KEY)는 Supabase secret에만 있고,
// 앱/클라이언트에는 절대 노출되지 않는다.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "POST만 허용됩니다." }, 405);

  if (!SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: "서버에 서비스 키가 설정되지 않았습니다." }, 500);
  }

  try {
    // 1) 로그인 확인 — 앱이 보낸 유저 토큰으로 본인 확인 (본인 계정만 삭제 가능)
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError) {
      console.error("getUser 실패:", userError);
      return json({ error: `본인 확인 실패: ${userError.message}` }, 401);
    }
    const userId = userData?.user?.id;
    if (!userId) return json({ error: "로그인이 필요합니다." }, 401);

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // 2) 루틴 첨부 사진 삭제 (내 폴더 전체) — DB cascade로는 안 지워지는 스토리지 파일
    const { data: files, error: listError } = await admin.storage.from("routine-photos").list(userId);
    if (listError) {
      console.error("스토리지 목록 조회 실패:", listError);
      return json({ error: `스토리지 목록 조회 실패: ${listError.message}` }, 500);
    }
    if (files && files.length > 0) {
      const { error: removeError } = await admin.storage
        .from("routine-photos")
        .remove(files.map((f) => `${userId}/${f.name}`));
      if (removeError) {
        console.error("스토리지 파일 삭제 실패:", removeError);
        return json({ error: `스토리지 파일 삭제 실패: ${removeError.message}` }, 500);
      }
    }

    // 3) 계정 삭제 — public.users 이하 모든 데이터가 on delete cascade로 함께 삭제된다
    const { error: deleteError } = await admin.auth.admin.deleteUser(userId);
    if (deleteError) {
      console.error("계정 삭제 실패:", deleteError);
      return json({ error: `계정 삭제 실패: ${deleteError.message}` }, 500);
    }

    return json({ success: true });
  } catch (e) {
    console.error("delete-account 예외:", e);
    return json({ error: `서버 예외: ${e instanceof Error ? e.message : String(e)}` }, 500);
  }
});
