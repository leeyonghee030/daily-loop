-- 스트릭 이모지 컨셉 변경: 돌멩이 진화 → 정체불명의 신호를 쫓다 외계 생명체와
-- 만나는 컨셉. 1주 단위로 촘촘하게 시작해서 1년까지 이어짐 (docs/project-spec.md 4-11)

delete from public.streak_emoji_configs;

insert into public.streak_emoji_configs (id, min_days, max_days, emoji, label) values
  (1, 7, 13, '📡', '이상한 신호'),
  (2, 14, 20, '🌌', '낯선 기운'),
  (3, 21, 27, '🛸', 'UFO 접근'),
  (4, 28, 55, '👽', '외계인 조우'),
  (5, 56, 90, '👾', '교신 성공'),
  (6, 91, 181, '🔮', '우주의 비밀'),
  (7, 182, 364, '🪐', '나만의 행성'),
  (8, 365, null, '👑👽', '은하의 전설');
