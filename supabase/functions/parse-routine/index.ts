// Edge Function: 자연어 문장 → 구조화된 루틴 초안(JSON)
// 정규식으로 못 잡는 애매한 표현만 앱에서 이 함수를 호출한다(하이브리드 구조).
// 키(ANTHROPIC_API_KEY)는 Supabase secret에만 있고, 앱/클라이언트에는 절대 노출되지 않는다.
// 로그인한 유저만 호출 가능하며, 가입 순번 기반 평생 한도를 서버에서 강제한다.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const MODEL = "claude-haiku-4-5"; // 기획서: 비용 최적화용 소형 모델

const SYSTEM_PROMPT = `너는 한국어 루틴 문장을 구조화된 JSON으로 바꾸는 파서다.
사용자가 자유롭게 적은 한 문장을 받아 루틴 1개의 초안으로 변환한다.

반드시 아래 JSON 형식 하나만 출력한다. 설명·마크다운·코드펜스 없이 순수 JSON 객체만 출력한다.

{
  "title": string,              // 루틴 제목(짧게. 시간/반복 표현은 빼고 핵심 행동만)
  "repeatType": "daily" | "weekday" | "weekend" | "custom" | "once",
  "repeatDays": number[] | null, // repeatType이 "custom"일 때만 요일 배열(일=0 ... 토=6), 아니면 null
  "scheduledTime": string | null, // "HH:MM" 24시간제. 시간 표현 없으면 null
  "isRequired": boolean,        // "꼭/반드시/무조건" 등 강조가 있으면 true
  "blockType": "check" | "tracking", // 숫자+단위(잔/개/페이지/km/분 등)가 있으면 "tracking"
  "trackingUnit": string | null  // tracking일 때 단위, 아니면 null
}

규칙:
- "매일"→daily, "평일/주중"→weekday, "주말"→weekend, "월수금" 같은 요일 조합→custom+repeatDays
- 시간: "아침/오전 7시"→"07:00", "저녁/오후 7시"→"19:00", "밤 8시"→"20:00", "7시 30분"→"07:30"
- 시간대 단어의 실제 뜻: 새벽=00~05시, 아침/오전=06~11시, 정오/한낮=12:00, 오후=12~17시, 저녁=18~19시, 밤=20~23시, 자정/한밤중=00:00.
  숫자 뒤에 시간대 단어가 붙으면(예: "밤 8시") 반드시 그 시간대 기준으로 24시간제 변환한다(밤 8시→20:00, 절대 08:00 아님).
- "해질녘/노을질때/해질때쯤" 같은 서술적 시간 표현은 저녁 무렵인 "18:00"으로 해석한다
- 시간 표현이 전혀 없으면 scheduledTime은 null (슬롯은 사용자가 나중에 직접 고른다)
- blockType: 숫자+단위(잔/개/페이지/km/분 등)가 있으면 "tracking". 구체적 숫자가 없어도 "갯수/개수/횟수/몇 번/몇 개/얼마나 했는지" 등 횟수·개수를 세고 확인하고 싶다는 의도가 보이면 "tracking"으로 보고 trackingUnit은 "회"로 둔다
- 확신이 없는 값은 null 또는 기본값(repeatType "once", isRequired false, blockType "check")으로 둔다
- title 추출은 최대한 적극적으로 한다: "추천해줘/추가해줘/할까/좋을까" 같은 요청·질문 표현이 섞여 있어도,
  문장 안에 구체적인 행동/활동 단어(예: "운동", "수영", "책 읽기")가 하나라도 있으면 반드시 그 단어를 title로 뽑아내고,
  시간·반복 등 다른 필드도 있는 대로 채운다. "포기"는 정말 최후의 수단이다.
- 절대 설명·질문·거절 문장을 출력하지 않는다. 문장 전체를 봐도 구체적 행동/활동 단어를 단 하나도 찾을 수 없을 때만
  (예: "오늘 하면 좋을 습관 추천해줘"처럼 "무엇을 할지"조차 안 정해진 경우), title에 입력 문장을 그대로 넣고 나머지 필드는 기본값으로 채운다.
  이때도 절대 JSON 형식을 벗어나지 않는다. (title을 사용자가 직접 고칠 초안일 뿐이니, 완벽하지 않아도 괜찮다)

예시:
입력: "매일 아침 7시에 물 8잔 마시기"
출력: {"title":"물 마시기","repeatType":"daily","repeatDays":null,"scheduledTime":"07:00","isRequired":false,"blockType":"tracking","trackingUnit":"잔"}

입력: "평일마다 출근 전에 꼭 영양제 챙겨먹기"
출력: {"title":"영양제 챙겨먹기","repeatType":"weekday","repeatDays":null,"scheduledTime":null,"isRequired":true,"blockType":"check","trackingUnit":null}

입력: "월수금 저녁에 30분씩 러닝"
출력: {"title":"러닝","repeatType":"custom","repeatDays":[1,3,5],"scheduledTime":"19:00","isRequired":false,"blockType":"tracking","trackingUnit":"분"}

입력: "매일 턱걸이 운동 갯수 확인 밤 8시"
출력: {"title":"턱걸이 운동","repeatType":"daily","repeatDays":null,"scheduledTime":"20:00","isRequired":false,"blockType":"tracking","trackingUnit":"회"}

입력: "오늘 운동추천해줘7시"
출력: {"title":"운동","repeatType":"once","repeatDays":null,"scheduledTime":"07:00","isRequired":false,"blockType":"check","trackingUnit":null}

입력: "오늘 하면 좋을 건강한 습관 추천해줘"
출력: {"title":"오늘 하면 좋을 건강한 습관 추천해줘","repeatType":"once","repeatDays":null,"scheduledTime":null,"isRequired":false,"blockType":"check","trackingUnit":null}`;

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

  if (!ANTHROPIC_API_KEY) {
    return json({ error: "서버에 API 키가 설정되지 않았습니다." }, 500);
  }

  // 1) 로그인 확인 — 앱이 보낸 유저 토큰으로 본인 확인
  const authHeader = req.headers.get("Authorization") ?? "";
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData } = await supabase.auth.getUser();
  if (!userData?.user) return json({ error: "로그인이 필요합니다." }, 401);

  // 2) 입력 파싱
  let text: string;
  try {
    const body = await req.json();
    text = (body?.text ?? "").toString().trim();
  } catch {
    return json({ error: "요청 본문(JSON)이 올바르지 않습니다." }, 400);
  }
  if (!text) return json({ error: "text가 비어 있습니다." }, 400);
  // 루틴 한 문장 기준. 앱을 우회한 긴 입력(비용 낭비/악용) 방어
  if (text.length > 100) return json({ error: "입력은 100자 이내로 해주세요." }, 400);

  // 3) 한도 확인 (소진 전) — 실패한 LLM 호출에는 횟수를 차감하지 않기 위해 먼저 조회만
  const { data: quota } = await supabase.rpc("get_llm_quota");
  if (!quota || quota.remaining <= 0) {
    return json({ quotaExceeded: true, limit: quota?.limit ?? 0 }, 200);
  }

  // 4) Anthropic Messages API 직접 호출
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 512,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: text }],
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    return json({ error: "LLM 호출 실패", status: res.status, detail }, 502);
  }

  const data = await res.json();
  const raw: string = data?.content?.[0]?.text ?? "";

  // 혹시 코드펜스로 감싸져 오면 벗겨내고 JSON만 파싱
  const cleaned = raw.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  let draft: unknown;
  try {
    draft = JSON.parse(cleaned);
  } catch {
    return json({ error: "LLM이 JSON을 반환하지 않음", raw }, 502);
  }

  // 5) 성공했으니 1회 소진 (원자적)
  const { data: consumed } = await supabase.rpc("consume_llm_call");
  const remaining =
    consumed?.allowed ? consumed.remaining : Math.max((quota.remaining ?? 1) - 1, 0);

  return json({ draft, quota: { remaining, limit: quota.limit } });
});
