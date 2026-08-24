# LLM 자연어 루틴 추가 — 정리 노트 (복습용)

> 로드맵 7단계에서 만든 "말로 루틴 추가하기" 기능이 **실제로 어떻게 돌아가는지** 나중에 다시 봐도 이해되게 정리한 노트.
> 상세 결정 배경은 `docs/study.md` 2026-08-11 섹션, 화면/파일 위치는 `CLAUDE.md` 참고.

---

## 0. 한 줄 요약

자유 문장("매일 아침 7시에 물 8잔 마시기") → 구조화된 루틴 데이터로 바꾸는 기능.
**규칙(정규식)으로 먼저 시도 → 애매하면 AI(Claude) 호출**하는 하이브리드 구조. 결과는 완성이 아니라 **초안**으로 루틴 폼에 미리 채워준다.

```
"매일 아침 7시에 물 8잔 마시기"
        ↓
{ title: "물 마시기", repeatType: "daily", scheduledTime: "07:00",
  blockType: "tracking", trackingUnit: "잔" }
```

---

## 1. 개념 정리 (쉬운 말)

| 용어 | 쉬운 설명 |
|---|---|
| 왜 API 키를 앱에 못 넣나 | 앱은 뜯어보면 내부 문자열이 다 보임. 키가 새면 남이 내 요금으로 AI를 부름 → 키는 **서버에만** 둔다 |
| Edge Function | Supabase가 주는 작은 서버 함수. 앱 → Edge Function → Claude 순으로 요청이 지나감. 키를 쥐고 AI를 **대신 호출**해주는 중계소 |
| Supabase secret | 서버 실행 중에만 읽히는 값 보관소. 코드·git에 키가 안 남음 |
| 하이브리드 파싱 | ① 정규식 규칙표로 먼저(무료·즉시) → ② 규칙에 안 걸리는 것만 AI(유료). "매일 아침 물마시기"는 AI 안 부름 |
| 원자적(atomic) 차감 | 여러 요청이 동시에 와도 횟수가 딱 1씩만 깎이게 하는 것. DB의 조건부 update로 보장 |
| 초안(draft) 방식 | AI 결과를 바로 저장하지 않고 폼에 채워만 줌. 틀리면 사용자가 고침 → AI가 완벽할 필요 없음 |
| 국외 이전 고지 | 데이터가 해외 서버(Supabase·Anthropic)로 감 → 개인정보처리방침에 이전 사실을 밝혀야 함 |

---

## 2. 전체 흐름 (이게 핵심)

```
[앱] 문장 입력 (app/llm-input.tsx)
   │
   ├─ (정규식으로 반복·시간·필수·트래킹 다 잡힘)
   │        → AI 호출 없이 즉시 미리보기, 횟수 안 깎임
   │
   └─ (아무것도 못 잡은 애매한 문장 = needsLlmFallback)
              ↓
        [Edge Function: parse-routine]
              1) 로그인 확인 (아니면 401)
              2) 100자 넘으면 거절 (비용 방어)
              3) 남은 횟수 조회 (0이면 중단 — 아직 안 깎음)
              4) Claude 호출 → JSON 초안 받기
              5) 성공했을 때만 횟수 1 차감
              ↓
        [앱] 루틴 추가 폼(routine-form)에 초안 미리 채움
              ↓
        사용자가 확인·수정 후 저장
```

**중요 포인트**
- 횟수는 **AI 호출 성공 뒤에** 깎는다. 실패한 호출로 아까운 횟수 날리지 않게. (먼저 조회만 하고, 성공 후 차감)
- 미리보기는 새 화면이 아니라 **기존 루틴 폼을 재사용**(파라미터로 프리필). 그래서 사용자는 늘 쓰던 폼에서 수정·저장.

---

## 3. 실제 로직 3조각

### (1) 하이브리드 분기 — 언제 AI를 부르나
`lib/parse-routine-input.ts`. 반복·시간·필수·트래킹을 **하나도 못 잡았을 때만** AI로 넘긴다.

```ts
const needsLlmFallback =
  !matchedRepeat && !matchedTime && !isRequired && blockType === 'check';
```

정규식은 이런 걸 잡음: `매일/평일/주말/월수금`(반복), `아침 7시/19:00`(시간), `꼭/반드시`(필수), `물 8잔/30분`(트래킹 단위).

### (2) 서버가 AI에게 시키는 일 — 시스템 프롬프트
`supabase/functions/parse-routine/index.ts`. AI에게 "설명 없이 **이 JSON 형식만** 뱉어라"라고 못박음. 모델은 소형(`claude-haiku-4-5`), `max_tokens: 512`로 출력도 제한.

```
{ "title", "repeatType", "repeatDays", "scheduledTime",
  "isRequired", "blockType", "trackingUnit" }
```

받은 뒤엔 혹시 ```json``` 코드펜스로 감싸져 오면 벗겨내고 `JSON.parse`.

### (3) 횟수 제한 — 서버(DB)가 최종 판정
`supabase/migrations/0012_add_llm_quota.sql`. 앱에서 세면 조작 가능하니 **DB가** 판정.
- 가입 트리거가 순번 매기고 한도 부여: **1~10,000번째 = 10회, 이후 = 5회** (평생, 월 초기화 없음)
- 차감은 조건부 update로 원자적으로:

```sql
update users set llm_call_count = llm_call_count + 1
  where id = uid and llm_call_count < llm_call_limit;
-- 못 깎으면(not found) = 한도 초과
```

RPC 2종: `get_llm_quota`(남은 횟수 조회, 앱 표시용) / `consume_llm_call`(1회 차감).

---

## 4. 비용을 어떻게 묶었나 (3중 상한)

| 상한 | 방법 | 어디서 |
|---|---|---|
| 입력 크기 | 100자 제한 | 앱 입력창 `maxLength` + 서버 재검사 |
| 출력 크기 | `max_tokens: 512` | Edge Function |
| 호출 횟수 | 1인 평생 10회(또는 5회) | DB 트리거 + RPC |
| 모델 비용 | 소형 모델 사용 | `claude-haiku-4-5` |

→ 무의미한 입력이 와도 정규식에 안 걸리면 **그 사람 본인 횟수 1회만** 깎임. 그래서 따로 스팸 방지 로직 없이 횟수 제한만으로 방어됨.

---

## 5. 왜 이렇게 했나 (한 줄씩)

- **키를 서버에**: 앱은 역컴파일로 다 보임. 서버만 알면 앱이 털려도 요금 도용 안 됨.
- **하이브리드**: 대부분 문장은 규칙으로 잡힘. 매번 AI 부르면 비용·무료횟수가 샘.
- **횟수를 서버에서**: 앱 변수는 조작 가능. DB 트리거+RPC로 우회 차단.
- **횟수 제한만으로 충분**: 요청당 비용은 프롬프트+출력상한으로 이미 작게 고정. 남는 리스크는 "많이 부르는 것"뿐인데 그건 횟수로 막힘.
- **초안 방식**: 사용자가 어차피 확인·수정하니 AI가 100% 정확할 필요 없음.

---

## 6. 관련 파일 지도

| 역할 | 파일 |
|---|---|
| 앱 입력 화면 | `app/llm-input.tsx` |
| 정규식 파서 + 하이브리드 판정 | `lib/parse-routine-input.ts` |
| 앱→서버 호출 래퍼 | `lib/llm.ts` |
| 서버(AI 중계 + 검증) | `supabase/functions/parse-routine/index.ts` |
| 횟수 한도 DB | `supabase/migrations/0012_add_llm_quota.sql` |
| 개인정보처리방침 | `docs/privacy-policy.md` (공개 URL은 GitHub Pages) |

---

## 7. 아직 안 한 것

- [ ] 폰 실기 테스트 (서버는 curl/Node로 확인 완료, 앱 화면은 아직)
- [ ] 마이그레이션 `0012`를 Supabase에서 실제 실행했는지 확인
- [ ] 영상 큐레이션 콘텐츠 채우기
