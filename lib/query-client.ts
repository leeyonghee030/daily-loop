import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { defaultShouldDehydrateQuery, type Query } from '@tanstack/query-core';
import { QueryClient } from '@tanstack/react-query';

// staleTime 0 = "받아온 데이터는 받는 순간부터 오래된 것으로 취급" — 화면에 포커스될 때마다
// 항상 다시 불러오던 기존 방식(useFocusEffect + load())과 동일한 동작을 유지하기 위함.
// 대신 react-query가 "이미 있는 값은 그대로 보여주면서 뒤에서 조용히 새로 받아오는" 처리를
// 알아서 해주므로, 우리가 손으로 만들던 로딩 스피너 가드/캐시 코드가 필요 없어진다.
//
// gcTime을 길게(24시간) 잡은 이유: 아래 persister가 앱을 완전히 껐다 켜도 마지막으로 받은
// 값을 그대로 화면에 먼저 보여주기 위한 용도라, 캐시 자체가 이 시간 안에 메모리에서 지워지면
// 안 된다(react-query-persist-client는 gcTime을 넘긴 캐시는 복원 대상에서 제외함).
//
// retry 0으로 낮춘 이유: 기본값(1번 재시도, 그 사이 대기시간 포함)이라 네트워크가 아예 없을 때
// "불러오지 못했어요" 메시지가 뜨기까지 체감상 오래 걸린다는 피드백이 있었음 — 실패를 더
// 빠르게 알려주는 쪽을 택함(대신 일시적인 네트워크 끊김에는 좀 더 민감해짐)
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 0,
      gcTime: 24 * 60 * 60 * 1000,
      retry: 0,
      refetchOnWindowFocus: false, // RN에는 해당 없음(웹 전용 이벤트) — 화면 포커스는 useRefetchOnFocus로 별도 처리
    },
  },
});

// V2로 올린 이유: today-skips 쿼리가 실수로 디스크에 저장됐던 적이 있어서(Set 직렬화 버그로
// "내 루틴" 탭이 안 열리던 크래시의 원인), 이미 기기에 저장돼 있는 예전 캐시를 통째로 버리고
// 새로 시작하게 하려고 저장 키를 바꿨다. 이후로 비슷한 이유로 캐시를 초기화해야 하면 버전만 올릴 것
const asyncStoragePersister = createAsyncStoragePersister({
  storage: AsyncStorage,
  key: 'DAILYLOOP_QUERY_CACHE_V2',
});

// 캘린더의 month-data/week-data, "내 루틴"의 today-skips 쿼리는 값 안에 Map/Set을 담고
// 있는데, 이 persister는 AsyncStorage에 저장하려고 JSON.stringify를 거친다 — Map/Set은
// JSON으로 직렬화하면 빈 객체 {}가 되어버려서, 앱을 재시작해 복원된 뒤 그 값에 .get()/.has()를
// 부르는 순간 "not a function" 에러로 튕겨 나가는 버그가 있었음(캘린더에서 실제 발생 확인,
// today-skips도 같은 이유로 "내 루틴" 탭이 안 열리는 버그가 있었음).
// 이 쿼리들은 세션 내 메모리 캐시(react-query 기본 동작)만 쓰고, 디스크 저장 대상에서 제외한다.
// 앞으로 값에 Map/Set을 담는 새 쿼리를 추가하면 반드시 여기 목록에 추가할 것
const NO_PERSIST_QUERY_ROOTS = new Set(['month-data', 'week-data', 'today-skips']);

export const persistOptions = {
  persister: asyncStoragePersister,
  maxAge: 24 * 60 * 60 * 1000,
  dehydrateOptions: {
    shouldDehydrateQuery: (query: Query) => {
      const queryKeyRoot = query.queryKey[0];
      if (typeof queryKeyRoot === 'string' && NO_PERSIST_QUERY_ROOTS.has(queryKeyRoot)) return false;
      return defaultShouldDehydrateQuery(query);
    },
  },
};
